"""Copies the ERP data CKAM needs into CKAM's own tables (app.erp.mirror_models).

The warehouse is loaded from the ERP daily; this copies the fixed-asset POs of both companies, the
suppliers and the items they use. Nothing is ever deleted: a row the warehouse stops returning is
marked `is_present = false` (and comes back if it returns). A row's `row_hash` covers the business
fields only (not the warehouse's load time), so a plain reload is not a "change"."""
import asyncio
import hashlib
import logging
import time
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select, text

from app.core.config import settings
from app.erp.mirror_models import ErpItemCopy, ErpPoLineCopy, ErpSiteCopy, ErpSyncRun, ErpVendorCopy
from app.erp.source import ErpUnavailable
from app.erp.warehouse import WarehouseReader, WhItem, WhPoLine, WhSite, WhVendor
from app.observability import context as obs_context
from app.observability import writer as obs_writer

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


def site_hash(s: WhSite) -> str:
    return _digest(s.short_name, s.site_name, s.store_name, s.site_kind, s.store_type, s.store_status, s.is_active_site, s.state, s.city)


def item_hash(i: WhItem) -> str:
    return _digest(i.company_code, i.article_name, i.section, i.department, i.division, i.cat1, i.cat2, i.cat3, i.cat4, i.cat5, i.cat6, i.hsn, i.unit)


LINE_FIELDS = ("po_code", "po_number", "po_date", "line_status", "delivery_location", "delivery_site_kind", "supplier_code", "supplier_name",
               "icode", "item_description", "group_code", "hsn", "unit", "ordqty", "rate", "tax_percent", "line_netamt", "rcqty", "cnlqty",
               "hdr_netamt", "hdr_chgamt", "erp_loaded_at")
VENDOR_FIELDS = ("name", "gstin", "city", "is_extinct")
SITE_FIELDS = ("short_name", "site_name", "store_name", "site_kind", "store_type", "store_status", "is_active_site", "state", "city")
ITEM_FIELDS = ("company_code", "article_name", "section", "department", "division", "cat1", "cat2", "cat3", "cat4", "cat5", "cat6", "hsn", "unit")


async def last_runs(session) -> tuple[ErpSyncRun | None, ErpSyncRun | None]:
    """(the latest run of any kind, the latest successful run)."""
    last = (await session.execute(select(ErpSyncRun).order_by(ErpSyncRun.id.desc()).limit(1))).scalar_one_or_none()
    ok = (await session.execute(
        select(ErpSyncRun).where(ErpSyncRun.status == "success").order_by(ErpSyncRun.id.desc()).limit(1))).scalar_one_or_none()
    return last, ok


async def latest_run(session_factory) -> ErpSyncRun | None:
    async with session_factory() as session:
        return (await last_runs(session))[0]


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
    """S8: every copy is also a system_event (started; success / failed / skipped with its counts or its
    error), carrying the request id of a manual copy or the job id of a scheduled one. erp_sync_run is
    unchanged."""
    await obs_writer.system("erp_sync", "sync_started", f"Copying the ERP data ({trigger}).", details={"trigger": trigger})
    run = await _run_sync(session_factory, reader, trigger)
    details = {"trigger": trigger, "status": run.status, "po_lines_new": run.po_lines_new or 0,
               "po_lines_changed": run.po_lines_changed or 0, "po_lines_gone": run.po_lines_gone or 0,
               "vendors": run.vendors or 0, "items": run.items or 0,
               "source_stamp": run.source_stamp.isoformat() if run.source_stamp else None,
               "seconds": round(((run.finished_at or run.started_at) - run.started_at).total_seconds(), 1)
               if run.started_at else None,
               "message": run.message}
    if run.status == "success":
        await obs_writer.system("erp_sync", "sync_success",
                                f"ERP data copied: {details['po_lines_new']} new, {details['po_lines_changed']} changed, "
                                f"{details['po_lines_gone']} gone PO lines; {details['vendors']} vendors, "
                                f"{details['items']} items.", details=details)
    elif run.status == "skipped":
        await obs_writer.system("erp_sync", "sync_skipped", run.message or "The ERP copy was skipped.", details=details)
    else:
        await obs_writer.system("erp_sync", "sync_failed", f"The ERP copy failed: {run.message or 'no reason given'}",
                                level="ERROR", details=details)
    return run


async def _run_sync(session_factory, reader: WarehouseReader, trigger: str) -> ErpSyncRun:
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
        ctx = obs_context.current()
        await obs_writer.exception(exc, source="api" if ctx is not None and ctx.source == "api" else "job")
        return await _record_failure(session_factory, trigger, started, f"The copy failed unexpectedly ({type(exc).__name__}).")


async def _record_failure(session_factory, trigger: str, started: datetime, message: str) -> ErpSyncRun:
    async with session_factory() as session:
        run = ErpSyncRun(started_at=started, finished_at=datetime.now(timezone.utc), status="failed", trigger=trigger, message=message[:1000])
        session.add(run)
        await session.commit()
        return run


async def _copy(session, reader: WarehouseReader, trigger: str, started: datetime) -> ErpSyncRun:
    now = datetime.now(timezone.utc)
    clock = time.monotonic()
    since = date.today() - timedelta(days=HISTORY_DAYS)
    stamp = await reader.source_stamp()                 # taken first: a load that lands while we read makes the next check copy again

    existing = {(l.company_code, l.po_line_key): l for l in (await session.execute(select(ErpPoLineCopy))).scalars().all()}
    still_open = frozenset(l.po_code for l in existing.values() if l.is_present and l.line_status == "OPEN" and l.po_date < since)
    logger.info("ERP copy: %d lines held; reading the warehouse (%.1fs)", len(existing), time.monotonic() - clock)
    incoming = await reader.po_lines(since, still_open)
    logger.info("ERP copy: %d PO lines read (%.1fs)", len(incoming), time.monotonic() - clock)

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

    logger.info("ERP copy: lines compared: %d new, %d changed, %d gone (%.1fs)", new, changed, gone, time.monotonic() - clock)
    vendors = await _copy_vendors(session, reader, incoming, now)
    logger.info("ERP copy: %d vendors (%.1fs)", vendors, time.monotonic() - clock)
    items = await _copy_items(session, reader, incoming, now)
    logger.info("ERP copy: %d items (%.1fs)", items, time.monotonic() - clock)
    sites = await _copy_sites(session, reader, now)
    logger.info("ERP copy: %d sites (%.1fs)", sites, time.monotonic() - clock)
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


async def _copy_sites(session, reader: WarehouseReader, now: datetime) -> int:
    """All sites of both companies. A site the warehouse stops returning is marked not present, never deleted."""
    found = await reader.sites()
    have = {(s.company_code, s.site_code): s for s in (await session.execute(select(ErpSiteCopy))).scalars().all()}
    seen: set[tuple[str, int]] = set()
    for s in found:
        key = (s.company_code, s.site_code)
        seen.add(key)
        digest = site_hash(s)
        row = have.get(key)
        if row is None:
            session.add(ErpSiteCopy(company_code=s.company_code, site_code=s.site_code, row_hash=digest, first_seen_at=now,
                                    last_seen_at=now, is_present=True, **{f: getattr(s, f) for f in SITE_FIELDS}))
            continue
        if row.row_hash != digest:
            for f in SITE_FIELDS:
                setattr(row, f, getattr(s, f))
            row.row_hash = digest
        row.last_seen_at, row.is_present = now, True
    for key, row in have.items():
        if key not in seen:
            row.is_present = False
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
        # S8: each check is a job with its own id (in every log line, system event and error row it writes).
        with obs_context.job("erp_sync"):
            try:
                if await needs_sync(session_factory, reader):
                    await run_sync(session_factory, reader, "startup" if first else "schedule")
            except ErpUnavailable as exc:
                logger.warning("ERP check skipped: %s", exc)
                await obs_writer.system("erp_sync", "check_skipped", f"ERP check skipped: {exc}", level="WARNING")
            except Exception as exc:
                logger.exception("ERP check failed")
                await obs_writer.exception(exc, source="job")
                await obs_writer.system("scheduler", "loop_error",
                                        f"The ERP background check failed ({type(exc).__name__}); it tries again later.",
                                        level="ERROR")
        first = False
        try:
            await asyncio.wait_for(stop.wait(), timeout=settings.erp_sync_check_minutes * 60)
        except asyncio.TimeoutError:
            pass
