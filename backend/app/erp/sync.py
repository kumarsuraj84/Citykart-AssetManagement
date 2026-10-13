"""Copies the ERP data CKAM needs into CKAM's own tables (app.erp.mirror_models).

The warehouse is loaded from the ERP daily; this copies the fixed-asset POs of both companies, the
suppliers and the items they use. Nothing is ever deleted: a row the warehouse stops returning is
marked `is_present = false` (and comes back if it returns). A row's `row_hash` covers the business
fields only (not the warehouse's load time), so a plain reload is not a "change"."""
import asyncio
import hashlib
import logging
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select, text

from app.core.config import settings
from app.erp.mirror_models import ErpItemCopy, ErpPoLineCopy, ErpSyncRun, ErpVendorCopy
from app.erp.source import ErpUnavailable
from app.erp.warehouse import WarehouseReader, WhItem, WhPoLine, WhVendor

logger = logging.getLogger("ckam.erp.sync")

HISTORY_DAYS = 548                      # about 18 months of POs, plus every PO that is still open
LOCK_KEY = 7731001                      # pg advisory lock: one copy at a time
RENEW_AFTER = timedelta(hours=24)       # used when the warehouse cannot say when it last loaded


def _digest(*parts) -> str:
    def one(p):
        if p is None:
            return ""
        if isinstance(p, float):
            return f"{p:.4f}"
        return str(p)
    return hashlib.sha256("\x1f".join(one(p) for p in parts).encode()).hexdigest()


def line_hash(l: WhPoLine) -> str:
    return _digest(l.po_code, l.po_number, l.po_date, l.line_status, l.delivery_location, l.delivery_site_kind, l.supplier_code,
                   l.supplier_name, l.icode, l.item_description, l.group_code, l.hsn, l.unit, l.ordqty, l.rate, l.tax_percent,
                   l.line_netamt, l.rcqty, l.cnlqty, l.hdr_netamt, l.hdr_chgamt)


def vendor_hash(v: WhVendor) -> str:
    return _digest(v.name, v.gstin, v.city, v.is_extinct)


def item_hash(i: WhItem) -> str:
    return _digest(i.company_code, i.article_name, i.section, i.department, i.division, i.cat1, i.cat2, i.cat3, i.cat4, i.cat5, i.cat6, i.hsn, i.unit)


LINE_FIELDS = ("po_code", "po_number", "po_date", "line_status", "delivery_location", "delivery_site_kind", "supplier_code", "supplier_name",
               "icode", "item_description", "group_code", "hsn", "unit", "ordqty", "rate", "tax_percent", "line_netamt", "rcqty", "cnlqty",
               "hdr_netamt", "hdr_chgamt", "erp_loaded_at")
VENDOR_FIELDS = ("name", "gstin", "city", "is_extinct")
ITEM_FIELDS = ("company_code", "article_name", "section", "department", "division", "cat1", "cat2", "cat3", "cat4", "cat5", "cat6", "hsn", "unit")


async def latest_run(session_factory) -> ErpSyncRun | None:
    async with session_factory() as session:
        return (await session.execute(select(ErpSyncRun).order_by(ErpSyncRun.id.desc()).limit(1))).scalar_one_or_none()


async def needs_sync(session_factory, reader: WarehouseReader) -> bool:
    """True when nothing has been copied yet, or the warehouse has loaded newer data since the last good copy."""
    async with session_factory() as session:
        last = (await session.execute(
            select(ErpSyncRun).where(ErpSyncRun.status == "success").order_by(ErpSyncRun.id.desc()).limit(1)
        )).scalar_one_or_none()
    if last is None:
        return True
    stamp = await reader.source_stamp()
    if stamp is None:
        return datetime.now(timezone.utc) - (last.finished_at or last.started_at) >= RENEW_AFTER
    return last.source_stamp is None or stamp > last.source_stamp


async def run_sync(session_factory, reader: WarehouseReader, trigger: str) -> ErpSyncRun:
    started = datetime.now(timezone.utc)
    try:
        async with session_factory() as session:
            got = (await session.execute(text("select pg_try_advisory_xact_lock(:k)"), {"k": LOCK_KEY})).scalar_one()
            if not got:
                return ErpSyncRun(started_at=started, finished_at=started, status="skipped", trigger=trigger,
                                  message="Another copy of the ERP data is already running.")
            run = await _copy(session, reader, trigger, started)
            session.add(run)
            await session.commit()
            return run
    except ErpUnavailable as exc:
        return await _record_failure(session_factory, trigger, started, str(exc))
    except Exception as exc:                       # the background loop must survive anything
        logger.exception("ERP copy failed")
        return await _record_failure(session_factory, trigger, started, f"The copy failed unexpectedly ({type(exc).__name__}).")


async def _record_failure(session_factory, trigger: str, started: datetime, message: str) -> ErpSyncRun:
    async with session_factory() as session:
        run = ErpSyncRun(started_at=started, finished_at=datetime.now(timezone.utc), status="failed", trigger=trigger, message=message[:1000])
        session.add(run)
        await session.commit()
        return run


async def _copy(session, reader: WarehouseReader, trigger: str, started: datetime) -> ErpSyncRun:
    now = datetime.now(timezone.utc)
    since = date.today() - timedelta(days=HISTORY_DAYS)
    stamp = await reader.source_stamp()                 # taken first: a load that lands while we read makes the next check copy again

    existing = {(l.company_code, l.po_line_key): l for l in (await session.execute(select(ErpPoLineCopy))).scalars().all()}
    still_open = frozenset(l.po_code for l in existing.values() if l.is_present and l.line_status == "OPEN" and l.po_date < since)
    incoming = await reader.po_lines(since, still_open)

    new = changed = 0
    seen_keys: set[tuple[str, str]] = set()
    for l in incoming:
        key = (l.company_code, l.po_line_key)
        seen_keys.add(key)
        digest = line_hash(l)
        row = existing.get(key)
        if row is None:
            session.add(ErpPoLineCopy(
                company_code=l.company_code, po_line_key=l.po_line_key, row_hash=digest, first_seen_at=now, last_seen_at=now,
                is_present=True, **{f: getattr(l, f) for f in LINE_FIELDS}))
            new += 1
            continue
        if row.row_hash != digest:
            for f in LINE_FIELDS:
                setattr(row, f, getattr(l, f))
            row.row_hash = digest
            changed += 1
        row.last_seen_at = now
        row.is_present = True

    gone = 0
    for key, row in existing.items():
        if key in seen_keys or not row.is_present:
            continue
        if row.po_date >= since or row.po_code in still_open:
            row.is_present = False
            gone += 1

    vendors = await _copy_vendors(session, reader, incoming, now)
    items = await _copy_items(session, reader, incoming, now)
    return ErpSyncRun(started_at=started, finished_at=datetime.now(timezone.utc), status="success", trigger=trigger, source_stamp=stamp,
                      po_lines_new=new, po_lines_changed=changed, po_lines_gone=gone, vendors=vendors, items=items)


async def _copy_vendors(session, reader: WarehouseReader, lines: list[WhPoLine], now: datetime) -> int:
    wanted: dict[str, set[str]] = {}
    for l in lines:
        wanted.setdefault(l.company_code, set()).add(l.supplier_code)
    found = await reader.vendors(wanted)
    have = {(v.company_code, v.vendor_code): v for v in (await session.execute(select(ErpVendorCopy))).scalars().all()}
    for v in found:
        digest = vendor_hash(v)
        row = have.get((v.company_code, v.vendor_code))
        if row is None:
            session.add(ErpVendorCopy(company_code=v.company_code, vendor_code=v.vendor_code, row_hash=digest, first_seen_at=now,
                                      last_seen_at=now, is_present=True, **{f: getattr(v, f) for f in VENDOR_FIELDS}))
            continue
        if row.row_hash != digest:
            for f in VENDOR_FIELDS:
                setattr(row, f, getattr(v, f))
            row.row_hash = digest
        row.last_seen_at, row.is_present = now, True
    return len(found)


async def _copy_items(session, reader: WarehouseReader, lines: list[WhPoLine], now: datetime) -> int:
    found = await reader.items({l.icode for l in lines if l.icode})
    have = {i.icode: i for i in (await session.execute(select(ErpItemCopy))).scalars().all()}
    for it in found:
        digest = item_hash(it)
        row = have.get(it.icode)
        if row is None:
            session.add(ErpItemCopy(icode=it.icode, row_hash=digest, first_seen_at=now, last_seen_at=now, is_present=True,
                                    **{f: getattr(it, f) for f in ITEM_FIELDS}))
            continue
        if row.row_hash != digest:
            for f in ITEM_FIELDS:
                setattr(row, f, getattr(it, f))
            row.row_hash = digest
        row.last_seen_at, row.is_present = now, True
    return len(found)


async def sync_loop(session_factory, reader: WarehouseReader, stop: asyncio.Event) -> None:
    """Copies once at start when needed, then checks every `erp_sync_check_minutes`. Never raises."""
    first = True
    while not stop.is_set():
        try:
            if await needs_sync(session_factory, reader):
                await run_sync(session_factory, reader, "startup" if first else "schedule")
        except ErpUnavailable as exc:
            logger.warning("ERP check skipped: %s", exc)
        except Exception:
            logger.exception("ERP check failed")
        first = False
        try:
            await asyncio.wait_for(stop.wait(), timeout=settings.erp_sync_check_minutes * 60)
        except asyncio.TimeoutError:
            pass
