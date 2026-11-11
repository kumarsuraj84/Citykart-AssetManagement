"""Companies, and head offices / warehouses, made from the ERP (the guided "Add from the ERP" in Setup).

* Companies: the ERP's company master gives each company's code and name, so nobody types them (or the "ERP company
  code"). The names come from a live read of a 2-row table; when that read is not allowed or the ERP is down, the
  list falls back to the company codes the copy holds (names blank, the owner types them). Nothing is overwritten:
  a company CKAM already has is shown with the ERP's name beside its own.
* Places: the ERP's head offices and warehouses (from the copy of its site list) each become a Place, an Install Point
  (the site itself, "<name> Site") and, by default, a Stock Point for spare stock ("<name> Stock"), the way a store gets
  its two rooms. External sites (suppliers, customers, cross-charge entries) and virtual sites are not places and are
  never offered. A site listed under one company but named for the other (CKVPL-... under CKSPL) is offered but not
  ticked, with a warning.

Read-only towards the ERP; every write is CKAM's own and goes through the same checks as making these by hand."""
import re

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.asset_users.kinds import INSTALL_POINT_PREFIX, STOCK_ROOM_PREFIX
from app.asset_users.models import AssetUser
from app.asset_users.store_rooms import CODE_MAX, room_codes
from app.erp.mirror_models import ErpSiteCopy, ErpSyncRun
from app.erp.source import ErpUnavailable
from app.erp.vendors import company_for_erp
from app.erp.warehouse import WarehouseReader
from app.masters.models import Company, CostCenter, Location

LOCATION_CODE_MAX = 20
COMPANY_CODE_MAX = 20

# ERP site kind -> (group key, title, hint, ticked to start with)
PLACE_GROUPS = {
    "HEAD_OFFICE": ("HEAD_OFFICE", "Head offices", "Offices of the company.", True),
    "WAREHOUSE": ("WAREHOUSE", "Warehouses", "The company's warehouses.", True),
    "WAREHOUSE_OTHER": ("OTHER_WAREHOUSE", "Other warehouses", "Other warehouse sites in the ERP: add the ones you really use.", False),
    "WAREHOUSE_LEGACY": ("OLD_WAREHOUSE", "Old warehouses", "Marked as old in the ERP: add one only if it still holds assets.", False),
}


def tidy_company_name(name: str | None) -> str | None:
    """The ERP writes company names in capitals ("CITYKART STORES PVT. LTD."): shown as "Citykart Stores Pvt. Ltd."."""
    text = (name or "").strip()
    if not text:
        return None
    return text.title() if text == text.upper() else text


# ---------------------------------------------------------------- companies

async def list_erp_companies(session: AsyncSession, reader: WarehouseReader) -> dict:
    """The companies the ERP has, each with whether CKAM already has it (matched on code or ERP company code, also
    when it is switched off) and the ERP's name beside CKAM's own when they differ."""
    note = None
    erp_rows: list[tuple[str, str | None]] = []
    try:
        erp_rows = [(c.company_code, c.company_name) for c in await reader.companies()]
    except ErpUnavailable as exc:
        note = (f"The ERP's company names could not be read ({exc}) so only the company codes are shown: "
                "type the name yourself.")
    if not erp_rows:
        codes = (await session.execute(select(ErpSiteCopy.company_code).distinct().order_by(ErpSiteCopy.company_code))).scalars().all()
        erp_rows = [(code, None) for code in codes]
        if note is None and erp_rows:
            note = "The ERP's company names are not available, so only the company codes are shown: type the name yourself."
    copied = (await session.execute(select(ErpSyncRun.id).where(ErpSyncRun.status == "success").limit(1))).first() is not None
    have = (await session.execute(select(Company))).scalars().all()
    rows = []
    for code, erp_name in erp_rows:
        code = code.strip()
        match = next((c for c in have if c.erp_code.lower() == code.lower() or (c.code or "").lower() == code.lower()), None)
        suggested = tidy_company_name(erp_name)
        rows.append({
            "code": code, "erp_name": erp_name, "suggested_name": suggested or code,
            "exists": match is not None, "company_id": match.id if match else None,
            "is_active": match.is_active if match else None, "ckam_name": match.name if match else None,
            "name_differs": bool(match and suggested and match.name.strip().lower() != suggested.strip().lower()),
            "selectable": match is None and len(code) <= COMPANY_CODE_MAX,
            "reason": (None if match is None else
                       ("This company is already here." if match.is_active else
                        "This company is here but switched off: switch it on again under Settings › Organisation › Companies.")
                       ) if len(code) <= COMPANY_CODE_MAX else f"The ERP code {code} is longer than {COMPANY_CODE_MAX} characters.",
        })
    return {"copied": copied, "names_known": note is None, "note": note, "companies": rows}


async def create_erp_companies(session: AsyncSession, actor: AssetUser, reader: WarehouseReader, picks: list) -> dict:
    """Makes each ticked company (code = the ERP's company code, which goes into every asset code) and, unless asked
    not to, one cost centre with the same code. A company that cannot be made is reported with the reason; the others
    are still made."""
    listing = await list_erp_companies(session, reader)
    rows = {r["code"].upper(): r for r in listing["companies"]}
    created: list[str] = []
    skipped: list[dict] = []
    cost_centres = 0
    seen: set[str] = set()
    for pick in picks:
        key = pick.code.strip().upper()
        if not key or key in seen:
            continue
        seen.add(key)
        row = rows.get(key)
        if row is None:
            skipped.append({"code": pick.code, "reason": "This is not a company of the ERP."})
            continue
        if not row["selectable"]:
            skipped.append({"code": row["code"], "reason": row["reason"] or "This company cannot be made."})
            continue
        name = ((pick.name or "").strip() or row["suggested_name"])[:200]
        clash = (await session.execute(
            select(Company.name).where(Company.is_active.is_(True), func.lower(func.trim(Company.name)) == name.lower()).limit(1)
        )).scalar_one_or_none()
        if clash is not None:
            skipped.append({"code": row["code"], "reason": f"A company called {clash} is already switched on: choose another name."})
            continue
        try:
            async with session.begin_nested():
                company = Company(code=row["code"], name=name, created_by=actor.id, updated_by=actor.id)
                session.add(company)
                await session.flush()
                if pick.with_cost_centre:
                    session.add(CostCenter(company_id=company.id, code=row["code"][:20], name=name, created_by=actor.id, updated_by=actor.id))
                    await session.flush()
                    cost_centres += 1
        except IntegrityError:
            skipped.append({"code": row["code"], "reason": "A company with this code already exists."})
            continue
        created.append(row["code"])
    return {"created": created, "skipped": skipped, "cost_centres_created": cost_centres}


# ---------------------------------------------------------------- head offices and warehouses

async def list_erp_places(session: AsyncSession, company_id: int) -> dict:
    """The head offices and warehouses of one company's ERP, each marked with whether it can be made here."""
    company = await company_for_erp(session, company_id)
    copied = (await session.execute(select(ErpSyncRun.id).where(ErpSyncRun.status == "success").limit(1))).first() is not None
    sites = (await session.execute(
        select(ErpSiteCopy).where(
            ErpSiteCopy.company_code == company.erp_code, ErpSiteCopy.site_kind.in_(list(PLACE_GROUPS)),
            ErpSiteCopy.is_present.is_(True),
        ).order_by(ErpSiteCopy.site_kind, ErpSiteCopy.short_name, ErpSiteCopy.site_code)
    )).scalars().all()
    # the other companies' ERP codes (a site named CKVPL-... under CKSPL is probably the other company's)
    others = {c.upper() for c in (await session.execute(select(ErpSiteCopy.company_code).distinct())).scalars().all()}
    others |= {c.erp_code.upper() for c in (await session.execute(select(Company))).scalars().all()}
    others.discard(company.erp_code.upper())
    locations = (await session.execute(select(Location).where(Location.company_id == company.id))).scalars().all()
    by_code = {(loc.code or "").strip().upper(): loc for loc in locations}

    rows = []
    summary = {key: 0 for key, *_ in PLACE_GROUPS.values()}
    summary["ALREADY_CREATED"] = 0
    for s in sites:
        code = (s.short_name or "").strip()
        group, _title, _hint, ticked = PLACE_GROUPS[s.site_kind]
        existing = by_code.get(code.upper())
        prefix = re.split(r"[-_ ]", code, maxsplit=1)[0].upper() if code else ""
        foreign = prefix in others
        reason = note = None
        if existing is not None:
            reason = "A place with this code already exists." + ("" if existing.is_active else " (switched off)")
            summary["ALREADY_CREATED"] += 1
        else:
            summary[group] += 1
            if not code:
                reason = "This site has no short name in the ERP."
            elif len(code) > LOCATION_CODE_MAX:
                reason = f"The ERP code is longer than {LOCATION_CODE_MAX} characters, so it cannot be a place code."
            elif foreign:
                note = f"Named for {prefix} but listed under {company.erp_code} in the ERP: check before adding."
        selectable = existing is None and reason is None
        rows.append({
            "site_code": s.site_code, "code": code, "name": (s.store_name or s.site_name or code).strip(), "kind": s.site_kind,
            "group": group, "city": s.city, "state": s.state, "active": bool(s.is_active_site), "exists": existing is not None,
            "location_id": existing.id if existing else None, "selectable": selectable,
            "selected_by_default": selectable and ticked and bool(s.is_active_site) and not foreign,
            "reason": reason, "note": note,
        })
    return {"company_id": company.id, "copied": copied, "summary": summary, "places": rows,
            "groups": [{"key": k, "title": t, "hint": h} for k, t, h, _ in PLACE_GROUPS.values()]}


async def create_erp_places(session: AsyncSession, actor: AssetUser, company_id: int, codes: list[str], with_stock_point: bool) -> dict:
    """A Place (reusing an active one with the same code), its Install Point and, by default, its Stock Point, for each
    ticked site. A site that cannot be made is reported with the reason; the others are still made."""
    company = await company_for_erp(session, company_id)
    listing = await list_erp_places(session, company_id)
    rows = {r["code"].upper(): r for r in listing["places"]}
    known = await room_codes(session, [company.id])
    created: list[str] = []
    skipped: list[dict] = []
    out_places: list[dict] = []
    seen: set[str] = set()
    ip_made = sp_made = 0

    for raw in codes:
        key = (raw or "").strip().upper()
        if not key or key in seen:
            continue
        seen.add(key)
        row = rows.get(key)
        if row is None:
            skipped.append({"code": raw, "reason": "This is not a head office or warehouse of this company in the ERP."})
            continue
        if not row["selectable"]:
            skipped.append({"code": row["code"], "reason": row["reason"] or "This site cannot be made."})
            continue
        problems: list[str] = []
        made = {"install_point": False, "stock_point": False}
        try:
            async with session.begin_nested():
                location = (await session.execute(
                    select(Location).where(Location.company_id == company.id, func.upper(Location.code) == key, Location.is_active.is_(True))
                )).scalars().first()
                if location is None:
                    address = ", ".join(p for p in (row["city"], row["state"]) if p) or None
                    location = Location(company_id=company.id, code=row["code"].upper(), name=row["name"][:200], address=address,
                                        created_by=actor.id, updated_by=actor.id)
                    session.add(location)
                    await session.flush()
                wanted = [("install_point", INSTALL_POINT_PREFIX, "INSTALLED", "Site", "install point")]
                if with_stock_point:
                    wanted.append(("stock_point", STOCK_ROOM_PREFIX, "STOCK_POINT", "Stock", "stock point"))
                for kind, prefix, type_, suffix, label in wanted:
                    code = f"{prefix}{key}"
                    if len(code) > CODE_MAX:
                        problems.append(f"The code {code} would be too long for the {label}.")
                        continue
                    existing = known.get((company.id, code))
                    if existing is not None:
                        if not (existing.asset_user_type == type_ and existing.is_active):
                            problems.append(f"The code {code} is already used by {existing.name}, so the {label} was not made.")
                        continue
                    place = AssetUser(
                        company_id=company.id, code=code, name=f"{row['name']} {suffix}"[:200], asset_user_type=type_,
                        location_id=location.id, role="SELF_SERVICE", login_enabled=False, created_by=actor.id, updated_by=actor.id,
                    )
                    session.add(place)
                    await session.flush()
                    known[(company.id, code)] = place
                    made[kind] = True
        except IntegrityError:
            skipped.append({"code": row["code"], "reason": "A place with this code already exists."})
            known = await room_codes(session, [company.id])
            continue
        ip_made += made["install_point"]
        sp_made += made["stock_point"]
        created.append(row["code"].upper())
        out_places.append({"code": row["code"].upper(), "install_point_created": made["install_point"],
                           "stock_point_created": made["stock_point"], "problems": problems})
    return {"created": created, "skipped": skipped, "places": out_places,
            "install_points_created": ip_made, "stock_points_created": sp_made}
