"""S3a-2: the head-office admin's ERP inbox -- only what is actually waiting for a decision.

* New items: ERP item codes on OPEN ERP POs (not created in CKAM yet; lines not fully cancelled) that have
  NO decision at all in their company (no Item rule and no "not tracked" rule at any level), grouped by ERP
  Article. A code that was never on an open PO is never listed.
* New vendors: ERP suppliers with such open POs that are not linked to a CKAM vendor in that company,
  grouped by PAN (the registrations of one business), with the unlinked registrations of the same PAN that
  have no open PO beside them (so they can be linked in the same go), and a suggested vendor.
* Stores: ERP stores that are ready (ACTIVE, a normal store code) and not created yet (app.erp.stores).

Resolving reuses the existing writers only: the item rule upsert (app.items.service.upsert_map), Item
creation (create_item), and the vendor link / create functions (app.erp.vendors). Each entry is its own
transaction, so one bad entry never blocks the rest."""
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.asset_users.models import AssetUser
from app.erp import stores as erp_stores
from app.erp.readiness import article_names, live_lines, open_erp_pos, suggested_scope
from app.erp.service import _index_items, created_erp_po_codes, links_of_companies
from app.erp.source import ErpItem, ErpSource, ErpVendor
from app.erp.vendors import (
    REASON_ORDER, _active_vendors, create_vendor_for_codes, group_key, known_gstins, link_codes, pan_of, suggest_vendors,
)
from app.items.models import Item
from app.items.service import ItemMatcher, active_rule_sets, create_item, norm, suggest_item_full, upsert_map
from app.masters.models import AssetSubcategory, Company

NO_ARTICLE = ""


async def _companies(session: AsyncSession, company_id: int | None) -> list[Company]:
    stmt = select(Company).where(Company.is_active.is_(True)).order_by(Company.id)
    if company_id is not None:
        stmt = stmt.where(Company.id == company_id)
    companies = list((await session.execute(stmt)).scalars().all())
    if company_id is not None and not companies:
        raise LookupError("This company was not found.")
    return companies


async def _open_state(session: AsyncSession, source: ErpSource, companies: list[Company]) -> dict:
    """What both the inbox and its counts start from: the open ERP POs of these companies not created here
    yet, their ERP items, the item rules and the vendor links -- each read once."""
    by_erp: dict[str, Company] = {}
    for c in companies:
        by_erp.setdefault(c.erp_code.lower(), c)
    created = await created_erp_po_codes(session)
    links = await links_of_companies(session, [c.id for c in companies])
    pos = [p for p in await open_erp_pos(source, [c.erp_code for c in companies])
           if p.po_code not in created and (p.company_code or "").lower() in by_erp]
    codes = sorted({ln.item_code for p in pos for ln in live_lines(p) if ln.item_code})
    erp_items = _index_items(await source.items(codes)) if codes else {}
    rules = await active_rule_sets(session, [c.id for c in companies])
    return {"by_erp": by_erp, "links": links, "pos": pos, "erp_items": erp_items, "rules": rules}


def _undecided_groups(state: dict) -> dict[tuple[int, str], dict]:
    """Undecided codes on open POs, grouped by Article (per company)."""
    by_erp, pos, erp_items, rules = state["by_erp"], state["pos"], state["erp_items"], state["rules"]
    groups: dict[tuple[int, str], dict] = {}
    for p in pos:
        company = by_erp[p.company_code.lower()]
        engine = rules[company.id]
        for ln in live_lines(p):
            erp = erp_items.get(ln.item_code) or erp_items.get((ln.item_code or "").upper())
            res = engine.resolve(erp) if erp is not None else None
            if res is not None and (res.item is not None or res.not_tracked):
                continue
            key = (company.id, erp.article_key if erp is not None else NO_ARTICLE)
            g = groups.setdefault(key, {"company": company, "erp": erp, "codes": {}})
            code = (ln.item_code or "").strip()
            entry = g["codes"].setdefault(code.upper(), {
                "icode": code, "name": (erp.name if erp is not None else "") or ln.description[:200],
                "units": 0.0, "po_numbers": set(), "erp": erp})
            entry["units"] += ln.qty - ln.cancelled_qty
            entry["po_numbers"].add(p.po_number)
    return groups


def _unlinked_open_suppliers(state: dict) -> dict[tuple[int, str], int]:
    """(company id, ERP supplier code) -> open POs, for suppliers not linked to a CKAM vendor."""
    out: dict[tuple[int, str], int] = {}
    for p in state["pos"]:
        company = state["by_erp"][p.company_code.lower()]
        if (company.id, p.supplier_code) not in state["links"]:
            out[(company.id, p.supplier_code)] = out.get((company.id, p.supplier_code), 0) + 1
    return out


async def _ready_store_count(session: AsyncSession, companies: list[Company]) -> int:
    total = 0
    for company in companies:
        listing = await erp_stores.list_erp_stores(session, company.id)
        total += sum(1 for s in listing["stores"] if s["group"] == erp_stores.READY and s["selectable"])
    return total


async def inbox_counts(session: AsyncSession, source: ErpSource, company_id: int | None = None) -> dict:
    """S5: just the three numbers for Home -- Article groups of undecided items, PAN groups of unmatched
    suppliers, stores ready to create -- the same rules as build_inbox without its suggestions and lists."""
    companies = await _companies(session, company_id)
    state = await _open_state(session, source, companies)
    groups = _undecided_groups(state)
    open_by_supplier = _unlinked_open_suppliers(state)
    vendor_groups = 0
    for company in companies:
        wanted = {code for (cid, code) in open_by_supplier if cid == company.id}
        if not wanted:
            continue
        known = {s.code: s for s in await source.vendors(company.erp_code)}
        vendor_groups += len({group_key(company.erp_code, code, known[code].gstin if code in known else None)
                              for code in wanted})
    return {"items": len(groups), "vendors": vendor_groups, "stores": await _ready_store_count(session, companies)}


async def build_inbox(session: AsyncSession, source: ErpSource, company_id: int | None = None) -> dict:
    companies = await _companies(session, company_id)
    state = await _open_state(session, source, companies)
    by_erp, links, pos = state["by_erp"], state["links"], state["pos"]
    active_items = list((await session.execute(select(Item).where(Item.is_active.is_(True)))).scalars().all())
    matcher = ItemMatcher(active_items)          # S7 (P1-3): the one suggestion scoring, built once

    # ---- items: undecided codes on open POs, grouped by Article (per company) ----
    groups = _undecided_groups(state)
    names_cache: dict[int, dict[str, set[str]]] = {}
    for company in companies:
        keys = [k for (cid, k) in groups if cid == company.id and k]
        names_cache[company.id] = await article_names(source, keys, company.erp_code) if keys else {}
    items_out = []
    for (cid, article_key), g in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        erp: ErpItem | None = g["erp"]
        code_rows = sorted(g["codes"].values(), key=lambda c: c["icode"])
        texts = ([erp.article_name, erp.department] if erp is not None else []) + [c["name"] for c in code_rows]
        suggestion = suggest_item_full(matcher, texts)
        seen = sorted({n for c in code_rows for n in c["po_numbers"]})
        items_out.append({
            "company_id": cid, "company_code": g["company"].code,
            "article_key": article_key or None, "article_name": erp.article_name if erp is not None and article_key else None,
            "department": erp.department if erp is not None and article_key else None,
            "section": erp.section if erp is not None and article_key else None,
            "division": erp.division if erp is not None and article_key else None,
            "suggested_scope": suggested_scope(erp, names_cache.get(cid, {})) if article_key else "CODE",
            "codes": [{"icode": c["icode"], "name": c["name"], "units": c["units"], "po_numbers": sorted(c["po_numbers"]),
                       "scopes": _scopes(c["erp"])} for c in code_rows],
            # S7: + suggestion_reason ("same name" / "similar name") and suggestion_reason_code (additive)
            **suggestion,
            "seen_on_pos": seen, "po_count": len(seen),
        })

    # ---- vendors: unlinked suppliers with open POs, grouped by PAN (per company) ----
    open_by_supplier = _unlinked_open_suppliers(state)
    vendors_out = []
    if open_by_supplier:
        ckam = await _active_vendors(session)
        gstins = await known_gstins(session, ckam)
        by_id = {v.id: v for v in ckam}
        for company in companies:
            wanted = {code for (cid, code) in open_by_supplier if cid == company.id}
            if not wanted:
                continue
            suppliers = await source.vendors(company.erp_code)
            known = {s.code: s for s in suppliers}
            pan_groups: dict[str, list[ErpVendor]] = {}
            for s in suppliers:
                pan_groups.setdefault(group_key(company.erp_code, s.code, s.gstin), []).append(s)
            done: set[str] = set()
            for code in sorted(wanted):
                me = known.get(code)
                if me is None:          # a supplier on a PO that the ERP's supplier list does not have
                    name = next((p.supplier_name for p in pos if p.supplier_code == code and by_erp[p.company_code.lower()] is company), code)
                    me = ErpVendor(code, name)
                key = group_key(company.erp_code, me.code, me.gstin)
                if key in done:
                    continue
                done.add(key)
                members = [s for s in pan_groups.get(key, [me]) if (company.id, s.code) not in links]
                members.sort(key=lambda s: (-open_by_supplier.get((company.id, s.code), 0), s.code))
                sibling_vendor_ids = {links[(company.id, s.code)].id for s in pan_groups.get(key, []) if (company.id, s.code) in links}
                best = None
                if len(sibling_vendor_ids) == 1 and next(iter(sibling_vendor_ids)) in by_id:
                    best = (by_id[next(iter(sibling_vendor_ids))], "PAN")
                else:
                    for s in members:
                        found = suggest_vendors(s, ckam, gstins)
                        if found and (best is None or REASON_ORDER.index(found[0][1]) < REASON_ORDER.index(best[1])):
                            best = found[0]
                vendors_out.append({
                    "company_id": company.id, "company_code": company.code, "group_key": key, "pan": pan_of(me.gstin),
                    "name": members[0].name if members else me.name,
                    "registrations": [{"erp_code": s.code, "name": s.name, "gstin": s.gstin,
                                       "open_pos": open_by_supplier.get((company.id, s.code), 0)} for s in members],
                    "suggested_vendor_id": best[0].id if best else None,
                    "suggested_vendor_name": best[0].name if best else None,
                    "suggestion_reason": best[1] if best else None,
                })

    # ---- stores: ready in the ERP and not created yet ----
    stores_out = []
    for company in companies:
        listing = await erp_stores.list_erp_stores(session, company.id)
        stores_out.extend({**s, "company_id": company.id, "company_code": company.code}
                          for s in listing["stores"] if s["group"] == erp_stores.READY and s["selectable"])

    return {
        "counts": {"items": len(items_out), "vendors": len(vendors_out), "stores": len(stores_out),
                   "item_codes": sum(len(i["codes"]) for i in items_out),
                   "vendor_registrations": sum(len(v["registrations"]) for v in vendors_out)},
        "items": items_out, "vendors": vendors_out, "stores": stores_out,
    }


def _scopes(erp: ErpItem | None) -> list[str]:
    """The reaches a decision on this code can have."""
    if erp is None or not erp.article_key:
        return ["CODE"]
    return ["CODE", "NAME", "ARTICLE"] if norm(erp.name) else ["CODE", "ARTICLE"]


# ------------------------------------------------------------------ resolving

SERIAL_MODES = {"HAS_SERIAL": (True, False), "NO_SERIAL": (False, False), "SERIAL_LATER": (True, True)}


async def _erp_item_for(source: ErpSource, company: Company, entry: dict) -> ErpItem | None:
    """The ERP item a decision is about: the code's own record, or (for an Article) one code of it."""
    if entry.get("icode"):
        code = entry["icode"].strip()
        return next((e for e in await source.items([code]) if e.icode.upper() == code.upper()), None)
    codes = await source.article_codes(entry["article_key"], company.erp_code)
    if not codes:
        return None
    return next(iter(await source.items([codes[0].icode])), None)


async def _resolve_item_entry(session: AsyncSession, actor: AssetUser, source: ErpSource, entry: dict) -> dict:
    company = await session.get(Company, entry["company_id"])
    if company is None or not company.is_active:
        raise ValueError("The company you chose does not exist or is no longer active.")
    choices = [entry.get("item_id") is not None, bool(entry.get("not_tracked")), entry.get("create_item") is not None]
    if sum(choices) != 1:
        raise ValueError("Choose one: an Item, a new Item, or not tracked.")
    if not entry.get("icode") and not entry.get("article_key"):
        raise ValueError("Say which ERP code or Article this decision is for.")
    scope = entry["scope"]
    if entry.get("article_key") and not entry.get("icode") and scope != "ARTICLE":
        raise ValueError("A decision for a product name or a single code needs the ERP code.")
    erp = await _erp_item_for(source, company, entry)
    if erp is None and scope != "CODE":
        raise ValueError("The ERP item master has no record of this, so only a single code can be decided.")
    if scope == "NAME" and not norm(erp.name):
        raise ValueError("This code has no product name in the ERP; decide the code or the whole Article.")
    item = None
    if entry.get("create_item") is not None:
        new = entry["create_item"]
        sub = await session.get(AssetSubcategory, new["subcategory_id"])
        if sub is None:
            raise ValueError("The sub-category you chose does not exist.")
        serial_required, serial_later = SERIAL_MODES[new.get("serial_mode") or "HAS_SERIAL"]
        item = await create_item(session, {"name": new["name"], "category_id": sub.category_id, "subcategory_id": sub.id,
                                           "serial_required": serial_required, "serial_later": serial_later}, actor)
    elif entry.get("item_id") is not None:
        item = await session.get(Item, entry["item_id"])
        if item is None or not item.is_active:
            raise ValueError("The Item you chose does not exist or is no longer active.")
    article_key = erp.article_key if erp is not None else None
    rule = await upsert_map(session, actor, {
        "match_type": scope, "company_id": company.id, "not_tracked": bool(entry.get("not_tracked")),
        "item_id": item.id if item else None,
        "erp_item_code": (entry.get("icode") or "").strip() or None, "article_key": article_key,
        "name_key": erp.name if erp is not None else None, "section": erp.section if erp else None,
        "department": erp.department if erp else None, "article_name": erp.article_name if erp else None,
        "note": "Decided in the ERP inbox",
    })
    what = {"ARTICLE": f"Every code of the Article {erp.article_name if erp else entry.get('article_key')}",
            "NAME": f"The product {erp.name if erp else ''} (Article {erp.article_name if erp else ''})",
            "CODE": f"The ERP code {(entry.get('icode') or '').strip()}"}[scope]
    outcome = "not tracked" if entry.get("not_tracked") else item.name
    message = f"{what} is now {outcome}."
    return {"ok": True, "message": message, "map_id": rule.id, "item_id": item.id if item else None}


async def _undo(session: AsyncSession, actor: AssetUser) -> None:
    """Rolls one entry back; the login row is read again (a rollback expires it) for the next entry."""
    await session.rollback()
    await session.refresh(actor)


async def resolve_items_batch(session: AsyncSession, actor: AssetUser, source: ErpSource, entries: list[dict]) -> list[dict]:
    """One transaction per entry (commit on success, roll back on a refusal), so one bad entry never blocks
    the rest. Returns one result per entry, in order."""
    out = []
    for entry in entries:
        try:
            result = await _resolve_item_entry(session, actor, source, entry)
            await session.commit()
            out.append(result)
        except (ValueError, LookupError) as exc:
            await _undo(session, actor)
            out.append({"ok": False, "message": str(exc)})
        except IntegrityError:
            await _undo(session, actor)
            out.append({"ok": False, "message": "This could not be saved because the same record already exists."})
    return out


async def resolve_vendors_batch(session: AsyncSession, actor: AssetUser, source: ErpSource, entries: list[dict]) -> list[dict]:
    out = []
    for entry in entries:
        try:
            if entry["action"] == "LINK":
                if entry.get("vendor_id") is None:
                    raise ValueError("Choose the vendor to link to.")
                done = await link_codes(session, actor, source, entry["vendor_id"], entry["company_id"], entry["erp_vendor_codes"])
                vendor = done["vendor"]
                message = f"Linked {len(done['linked'])} ERP supplier{'s' if len(done['linked']) != 1 else ''} to {vendor.name}."
            else:
                vendor = await create_vendor_for_codes(session, actor, source, entry["company_id"], entry["erp_vendor_codes"], entry.get("name"))
                message = f"Vendor {vendor.name} created and linked to {len(vendor.erp_links)} ERP supplier{'s' if len(vendor.erp_links) != 1 else ''}."
            vendor_id = vendor.id
            await session.commit()
            out.append({"ok": True, "message": message, "vendor_id": vendor_id})
        except (ValueError, LookupError) as exc:
            await _undo(session, actor)
            out.append({"ok": False, "message": str(exc)})
        except IntegrityError:
            await _undo(session, actor)
            out.append({"ok": False, "message": "That ERP supplier is already linked."})
    return out
