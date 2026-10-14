"""Small helpers the routers use to write their explicit audit rows in one line (plain sentences, counts,
ids). In-transaction rows go through app.observability.audit.record; rows that must survive or that
describe a read (exports, previews, downloads) through app.observability.writer."""
from __future__ import annotations

from app.observability import audit, context, writer

ids_preview = writer.ids_preview


def who() -> str:
    ctx = context.current()
    return (ctx.actor_name if ctx and ctx.actor_name else None) or "Someone"


def plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n:,} {one if n == 1 else (many or one + 's')}"


async def exported(what: str, rows: int | None, filters: dict | None = None) -> None:
    """EXPORT row: who exported what, with which filters, how many rows."""
    clean = {k: v for k, v in (filters or {}).items() if v not in (None, "", False)}
    count = f"{rows:,} rows" if rows is not None else "rows"
    await writer.audit_now("EXPORT", "EXPORT", f"{who()} exported {what} ({count}).",
                           changes={"what": what, "rows": rows, "filters": clean or None})


async def import_previewed(what: str, valid: int, errors: int, file_name: str | None = None, size: int | None = None) -> None:
    await writer.audit_now("IMPORT", "IMPORT_PREVIEW",
                           f"{who()} checked an import file of {what}: {plural(valid, 'row')} ready, "
                           f"{plural(errors, 'problem')}.",
                           changes={"what": what, "valid_rows": valid, "errors": errors, "file": file_name,
                                    "size_bytes": size})


def import_committed(session, what: str, counts: dict, *, entity: str | None = None, ids=None,
                     file_name: str | None = None, company_id: int | None = None) -> None:
    """IMPORT_COMMIT row in the import's own transaction."""
    parts = [f"{k.replace('_', ' ')} {v:,}" for k, v in counts.items() if isinstance(v, int)]
    changes = {"what": what, **{k: v for k, v in counts.items() if v is not None}, "file": file_name}
    if ids is not None:
        changes.update(ids_preview(ids))
    audit.record(session, "IMPORT", "IMPORT_COMMIT",
                 f"{who()} imported {what}: {', '.join(parts) if parts else 'nothing'}.",
                 entity=entity, changes=changes, company_id=company_id)


ASSET_SNAPSHOT_FIELDS = (
    "asset_code", "description", "company_id", "category_id", "subcategory_id", "item_id", "erp_item_code",
    "brand_id", "model", "serial_number", "serial_pending", "vendor_id", "po_number", "invoice_number",
    "purchase_cost", "tax_percent", "total_cost", "purchase_date", "warranty_years", "asset_domain",
    "current_asset_user_id", "status",
)


def asset_snapshot(asset) -> dict:
    """The key columns of a new asset (the CREATE row of a single asset)."""
    out = {}
    for name in ASSET_SNAPSHOT_FIELDS:
        value = getattr(asset, name, None) if not isinstance(asset, dict) else asset.get(name)
        if value not in (None, "", False):
            out[name] = value
    return out


EVENT_WORDS = {
    "MOVED": "moved", "SENT_FOR_REPAIR": "sent for repair", "RECEIVED_FROM_REPAIR": "received back from repair",
    "DISPOSED": "disposed of", "SOLD": "sold", "SCRAPPED": "scrapped", "LOST": "reported lost",
    "FOUND": "reported found", "CORRECTION": "added a correction note to", "PROCURED": "received",
    "IMPORTED": "imported",
}


async def place_name(session, asset_user_id: int | None) -> str | None:
    if asset_user_id is None:
        return None
    from app.asset_users.models import AssetUser
    place = await session.get(AssetUser, asset_user_id)
    return place.name if place is not None else f"#{asset_user_id}"


async def lifecycle_summary(session, action: str, event_type: str, asset_ids, failed: list[dict],
                            to_asset_user_id: int | None, reference_no: str | None = None, *,
                            company_id: int | None = None, asset_code: str | None = None) -> None:
    """ONE LIFECYCLE row for a movement of one or many assets (the ledger asset_event has the per-asset rows)."""
    wanted = list(dict.fromkeys(asset_ids))
    failed_ids = {f.get("asset_id") for f in failed or []}
    done = [i for i in wanted if i not in failed_ids]
    dest = await place_name(session, to_asset_user_id)
    verb = EVENT_WORDS.get(event_type, event_type.lower().replace("_", " "))
    what = f"asset '{asset_code}'" if asset_code and len(done) == 1 else plural(len(done), "asset")
    if event_type == "MOVED":
        text = f"{who()} moved {what}" + (f" to {dest}" if dest else "")
    elif event_type == "CORRECTION":
        text = f"{who()} added a correction note to {what}"
    else:
        text = f"{who()} recorded {what} as {verb}" + (f" (to {dest})" if dest else "")
    if failed:
        text += f"; {plural(len(failed), 'asset')} could not be"
    changes = {"event_type": event_type, "to_asset_user_id": to_asset_user_id, "to": dest,
               "reference_no": reference_no, **ids_preview(done)}
    if failed:
        changes["failed"] = failed[:50]
        changes["failed_total"] = len(failed)
    audit.record(session, "LIFECYCLE", action, text + ".", entity="asset",
                 entity_id=done[0] if len(done) == 1 else None, changes=changes, company_id=company_id,
                 outcome="OK" if done else "FAILED")


async def import_refused(what: str, reason: str) -> None:
    await writer.audit_now("IMPORT", "IMPORT_COMMIT", f"{who()} tried to import {what}; nothing was saved: {reason}",
                           outcome="FAILED", changes={"what": what, "reason": reason})
