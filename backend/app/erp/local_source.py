"""The ERP screens' view of the ERP: read from CKAM's own copy (app.erp.mirror_models), not the warehouse.

Implements the same `ErpSource` interface the screens already use, so the PO picker, the draft builder,
the delivery reminders and the PO change check run unchanged. Receipts and invoices are not copied yet
and still come from the live source. Until the first copy has finished, every call goes to the live
source, so a fresh install keeps working.

A PO has no status of its own in the warehouse: it is derived from its lines (`derive_po_status`). Lines
the warehouse stopped returning (`is_present = false`) are not part of the PO any more."""
from collections import defaultdict
from sqlalchemy import select, tuple_

from app.core.db import SessionLocal
from app.erp.mirror_models import ErpItemCopy, ErpPoLineCopy, ErpSyncRun, ErpVendorCopy
from app.erp.source import (
    ErpArticle, ErpArticleCode, ErpInvoice, ErpItem, ErpPo, ErpPoLine, ErpReceipt, ErpSource, ErpVendor, clean_name,
)
from app.erp.warehouse import derive_po_status


def _cats(row) -> list[str]:
    return [c for c in (clean_name(getattr(row, f"cat{n}")) for n in range(1, 7)) if c]


def _erp_item(row: ErpItemCopy) -> ErpItem:
    name = (row.article_name or "").strip()
    return ErpItem(
        icode=row.icode, article_key=name, article_name=name, section=(row.section or "").strip(),
        department=(row.department or "").strip(), division=(row.division or "").strip(), cats=_cats(row),
        unit=clean_name(row.unit) or None, hsn=clean_name(row.hsn) or None,
    )


class LocalErpSource:
    def __init__(self, live: ErpSource, session_factory=SessionLocal):
        self._live = live
        self._sf = session_factory

    async def _has_copy(self) -> bool:
        async with self._sf() as session:
            return (await session.execute(select(ErpSyncRun.id).where(ErpSyncRun.status == "success").limit(1))).first() is not None

    # ---- purchase orders ---------------------------------------------------

    @staticmethod
    def _po(lines: list[ErpPoLineCopy], with_lines: bool) -> ErpPo:
        first = lines[0]
        po = ErpPo(
            po_code=first.po_code, po_number=first.po_number, po_date=first.po_date, status=derive_po_status([l.line_status for l in lines]),
            company_code=first.company_code, company_name=first.company_code, delivery_location=first.delivery_location or "",
            supplier_code=first.supplier_code, supplier_name=(first.supplier_name or "").strip(), header_net=float(first.hdr_netamt or 0),
            header_charges=float(first.hdr_chgamt or 0), line_count=len(lines),
            loaded_at=max((l.erp_loaded_at for l in lines if l.erp_loaded_at), default=None),
        )
        if with_lines:
            po.lines = [
                ErpPoLine(po_line_key=l.po_line_key, item_code=l.icode or "", description=(l.item_description or "").strip(),
                          group_code=l.group_code, hsn=l.hsn, unit=l.unit, qty=float(l.ordqty or 0), rate=float(l.rate or 0),
                          tax_percent=None if l.tax_percent is None else float(l.tax_percent), line_net=float(l.line_netamt or 0),
                          received_qty=float(l.rcqty or 0), cancelled_qty=float(l.cnlqty or 0))
                for l in lines
            ]
        return po

    async def _pos(self, where, with_lines: bool) -> list[ErpPo]:
        async with self._sf() as session:
            rows = (await session.execute(
                select(ErpPoLineCopy).where(ErpPoLineCopy.is_present.is_(True), *where)
                .order_by(ErpPoLineCopy.company_code, ErpPoLineCopy.po_code, ErpPoLineCopy.po_line_key)
            )).scalars().all()
        grouped: dict[tuple[str, int], list[ErpPoLineCopy]] = defaultdict(list)
        for r in rows:
            grouped[(r.company_code, r.po_code)].append(r)
        return [self._po(lines, with_lines) for lines in grouped.values()]

    async def open_pos(self, supplier_codes: list[str], company_code: str | None = None) -> list[ErpPo]:
        if not await self._has_copy():
            return await self._live.open_pos(supplier_codes, company_code)
        if not supplier_codes:
            return []
        async with self._sf() as session:
            stmt = select(ErpPoLineCopy.company_code, ErpPoLineCopy.po_code).where(
                ErpPoLineCopy.is_present.is_(True), ErpPoLineCopy.line_status == "OPEN", ErpPoLineCopy.supplier_code.in_(supplier_codes)).distinct()
            if company_code:
                stmt = stmt.where(ErpPoLineCopy.company_code == company_code)
            pairs = [tuple(p) for p in (await session.execute(stmt)).all()]
        if not pairs:
            return []
        pos = await self._pos([tuple_(ErpPoLineCopy.company_code, ErpPoLineCopy.po_code).in_(pairs)], with_lines=False)
        return sorted((p for p in pos if p.status == "OPEN"), key=lambda p: (p.po_date, p.po_code), reverse=True)

    async def po(self, po_code: int) -> ErpPo | None:
        if not await self._has_copy():
            return await self._live.po(po_code)
        found = await self._pos([ErpPoLineCopy.po_code == po_code], with_lines=True)
        return found[0] if found else None

    async def pos_with_lines(self, po_codes: list[int]) -> list[ErpPo]:
        if not await self._has_copy():
            return await self._live.pos_with_lines(po_codes)
        if not po_codes:
            return []
        return await self._pos([ErpPoLineCopy.po_code.in_(list(po_codes))], with_lines=True)

    # ---- vendors and items -------------------------------------------------

    async def vendors(self, company_code: str | None = None) -> list[ErpVendor]:
        if not await self._has_copy():
            return await self._live.vendors(company_code)
        async with self._sf() as session:
            stmt = select(ErpVendorCopy).where(ErpVendorCopy.is_present.is_(True)).order_by(ErpVendorCopy.name, ErpVendorCopy.company_code)
            if company_code:
                stmt = stmt.where(ErpVendorCopy.company_code == company_code)
            rows = (await session.execute(stmt)).scalars().all()
        return [ErpVendor(code=r.vendor_code, name=r.name, gstin=r.gstin, is_active=not r.is_extinct, company_code=r.company_code) for r in rows]

    async def items(self, codes: list[str]) -> list[ErpItem]:
        if not await self._has_copy():
            return await self._live.items(codes)
        if not codes:
            return []
        async with self._sf() as session:
            rows = (await session.execute(select(ErpItemCopy).where(ErpItemCopy.icode.in_(codes)))).scalars().all()
        return [_erp_item(r) for r in rows]

    async def bought_articles(self, company_code: str | None = None) -> list[ErpArticle]:
        if not await self._has_copy():
            return await self._live.bought_articles(company_code)
        async with self._sf() as session:
            stmt = (select(ErpPoLineCopy.icode, ErpPoLineCopy.ordqty, ErpPoLineCopy.line_netamt, ErpItemCopy)
                    .join(ErpItemCopy, ErpItemCopy.icode == ErpPoLineCopy.icode).where(ErpPoLineCopy.is_present.is_(True)))
            if company_code:
                stmt = stmt.where(ErpPoLineCopy.company_code == company_code)
            rows = (await session.execute(stmt)).all()
        groups: dict[str, dict] = {}
        for icode, ordqty, net, item in rows:
            key = (item.article_name or "").strip()
            g = groups.setdefault(key, {"item": item, "codes": set(), "units": 0.0, "lines": 0, "net": 0.0, "names": set()})
            g["codes"].add(icode)
            g["units"] += float(ordqty or 0)
            g["lines"] += 1
            g["net"] += float(net or 0)
            if clean_name(item.cat1):
                g["names"].add(clean_name(item.cat1))
        ordered = sorted(groups.items(), key=lambda kv: kv[1]["net"], reverse=True)
        return [
            ErpArticle(article_key=key, article_name=key, section=(g["item"].section or "").strip(), department=(g["item"].department or "").strip(),
                       codes=len(g["codes"]), units=g["units"], lines=g["lines"], samples=[n[:40] for n in sorted(g["names"])][:4],
                       icodes=sorted(g["codes"]), names=sorted(g["names"]))
            for key, g in ordered
        ]

    async def article_codes(self, article_key: str, company_code: str | None = None) -> list[ErpArticleCode]:
        if not await self._has_copy():
            return await self._live.article_codes(article_key, company_code)
        async with self._sf() as session:
            stmt = (select(ErpPoLineCopy.icode, ErpPoLineCopy.ordqty, ErpItemCopy)
                    .join(ErpItemCopy, ErpItemCopy.icode == ErpPoLineCopy.icode)
                    .where(ErpPoLineCopy.is_present.is_(True), ErpItemCopy.article_name == article_key))
            if company_code:
                stmt = stmt.where(ErpPoLineCopy.company_code == company_code)
            rows = (await session.execute(stmt)).all()
        codes: dict[str, dict] = {}
        for icode, ordqty, item in rows:
            c = codes.setdefault(icode, {"item": item, "units": 0.0, "lines": 0})
            c["units"] += float(ordqty or 0)
            c["lines"] += 1
        out = []
        for icode, c in sorted(codes.items(), key=lambda kv: kv[1]["units"], reverse=True):
            cats = _cats(c["item"])
            out.append(ErpArticleCode(icode=icode, name=cats[0] if cats else "", description=" · ".join(cats), units=c["units"], lines=c["lines"]))
        return out

    # ---- not copied yet: still live ---------------------------------------

    async def receipts(self, po_codes: list[int]) -> list[ErpReceipt]:
        return await self._live.receipts(po_codes)

    async def invoices(self, po_codes: list[int]) -> list[ErpInvoice]:
        return await self._live.invoices(po_codes)
