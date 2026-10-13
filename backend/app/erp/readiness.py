"""S3a-2: what still stands between an ERP purchase order and a CKAM purchase order, in plain words.

An ERP PO is READY when its supplier is matched to a CKAM vendor (in the PO's company) and every ERP item
code on its live lines has a decision: an Item, or "not tracked". Otherwise it NEEDS_INPUT, and `problems`
says what, in a sentence ("Vendor needs matching.", "2 items need a decision."). Nothing is hidden for
being unmatched: a PO of a supplier nobody has linked yet is listed with VENDOR_UNMATCHED (only a PO made
ONLY of things CKAM does not track stays out, as before).

The decisions themselves come from the one rule engine (app.items.service: CODE > NAME > ARTICLE >
DEPARTMENT > SECTION > DIVISION, a company's own rule beating an every-company rule, an Item rule beating a
broader "not tracked"); this module only reads them, never decides anything itself."""
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.erp.source import ErpItem, ErpPo, ErpSource, is_configured
from app.erp.sync import last_runs
from app.items.service import Resolution, norm

# "Remember for the whole Article" is offered as the default when the Article is a coherent group: at most
# this many different product names among the codes the company has bought in it (an Article such as
# FA_IT_OTHERS holds 100+ unrelated products, so there the default is the product name).
COHERENT_ARTICLE_NAMES = 5

INDIA_TIME = timezone(timedelta(hours=5, minutes=30))


def live_lines(po: ErpPo) -> list:
    """The lines that still order something (ordered minus cancelled above zero)."""
    return [ln for ln in po.lines if ln.qty - ln.cancelled_qty > 0]


def resolution_of(res: Resolution | None) -> dict:
    """A line's decision for the screens: MATCHED (to an Item, and by which rule), NOT_TRACKED, or NEEDS_ITEM."""
    if res is not None and res.item is not None:
        return {"state": "MATCHED", "item_id": res.item.id, "item_name": res.item.name, "via": res.matched_by}
    if res is not None and res.not_tracked:
        return {"state": "NOT_TRACKED", "item_id": None, "item_name": None, "via": res.matched_by, "why": res.why_not_tracked}
    return {"state": "NEEDS_ITEM", "item_id": None, "item_name": None, "via": None}


def suggested_scope(erp: ErpItem | None, names_by_article: dict[str, set[str]]) -> str:
    """What "remember this choice" covers by default for one code: the whole ARTICLE when the Article is a
    coherent group (at most COHERENT_ARTICLE_NAMES product names among the codes bought in it), else the
    product NAME inside the Article; a code without a product name can only be remembered by its CODE, and
    so can a code the ERP item master does not know."""
    if erp is None or not erp.article_key:
        return "CODE"
    names = set(names_by_article.get(erp.article_key, set()))
    if norm(erp.name):
        names.add(norm(erp.name))
    if len(names) <= COHERENT_ARTICLE_NAMES:
        return "ARTICLE"
    return "NAME" if norm(erp.name) else "CODE"


def problems_for(vendor_linked: bool, undecided: int) -> list[dict]:
    out = []
    if not vendor_linked:
        out.append({"kind": "VENDOR_UNMATCHED", "message": "Vendor needs matching."})
    if undecided:
        out.append({"kind": "ITEMS_UNDECIDED", "count": undecided,
                    "message": "1 item needs a decision." if undecided == 1 else f"{undecided} items need a decision."})
    return out


async def open_erp_pos(source: ErpSource, company_codes: list[str]) -> list[ErpPo]:
    """Every OPEN ERP PO of these companies, of every supplier, with its lines. One read when the source
    can (CKAM's ERP copy); otherwise the older calls (every supplier the ERP lists, then their POs)."""
    reader = getattr(source, "open_pos_with_lines", None)
    if reader is not None:
        return list(await reader(company_codes))
    out: list[ErpPo] = []
    for code in company_codes:
        suppliers = [v.code for v in await source.vendors(code)]
        heads = await source.open_pos(suppliers, code) if suppliers else []
        out.extend(await source.pos_with_lines([p.po_code for p in heads]))
    return [p for p in out if p.status == "OPEN"]


async def article_names(source: ErpSource, article_keys, company_code: str | None) -> dict[str, set[str]]:
    keys = sorted({k for k in article_keys if k})
    if not keys:
        return {}
    reader = getattr(source, "article_product_names", None)
    if reader is not None:
        return await reader(keys, company_code)
    wanted = set(keys)
    return {a.article_key: {norm(n) for n in (a.names or a.samples) if norm(n)}
            for a in await source.bought_articles(company_code) if a.article_key in wanted}


def _when(moment: datetime | None) -> str | None:
    if moment is None:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(INDIA_TIME).strftime("%d-%m-%Y %I:%M %p").replace("AM", "am").replace("PM", "pm")


async def freshness(session: AsyncSession) -> dict:
    """How current the ERP data on screen is, from the sync runs (GET /api/erp/sync has the same facts):
    `data_as_of` = when the warehouse had loaded the data of the last good copy; `refresh_failed` when the
    latest copy attempt failed after it, with the plain sentence to show. Times in words are India time."""
    last, ok = await last_runs(session)
    as_of = (ok.source_stamp or ok.finished_at or ok.started_at) if ok is not None else None
    failed = last is not None and last.status == "failed" and (ok is None or last.id > ok.id)
    message = None
    if failed:
        message = f"ERP data could not refresh. Using data from {_when(as_of)}." if as_of else "ERP data could not refresh."
    return {
        "configured": is_configured(), "copied": ok is not None,
        "data_as_of": as_of.isoformat() if as_of else None, "data_as_of_text": _when(as_of),
        "last_attempt_at": (last.finished_at or last.started_at).isoformat() if last is not None else None,
        "refresh_failed": failed, "message": message,
    }
