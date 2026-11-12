"""Is this ERP Barcode right for this Item? The one check behind the live message on the entry screens and the
server's refusal (whatever a client sends).

When something is added by hand the person types the ERP code (CT123456) of what they are adding. CKAM knows which
ERP codes belong to which Item (the links of each Item, per company) and has a copy of the ERP item list, so it can
say whether the code is right for the Item chosen:

  OK           a code linked to this Item                                   accepted ("OK: Dell Desktop i3")
  OTHER_ITEM   a code linked to a different Item                            refused ("CT1 is Mouse, not Desktop")
  UNLINKED     a real ERP code no Item has been linked to yet               refused ("link it to the Item first")
  NOT_TRACKED  a code CKAM is told not to track                             refused
  NOT_ERP      not an ERP code (or not this company's)                      refused
  LOCAL        the word LOCAL, for something bought locally                 accepted
  BLANK        nothing typed                                                refused ("type the code, or LOCAL")
  UNCHECKED    no ERP copy exists yet (a fresh install): nothing to check   accepted, said so

Only entry by hand is checked. A PO picked from the ERP already carries its ERP code; the Excel imports of old data are
not checked (their sheets are the owner's)."""
from dataclasses import asdict, dataclass

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.erp.local_source import _erp_item
from app.erp.mirror_models import ErpItemCopy, ErpSyncRun
from app.items.models import Item
from app.items.service import resolve_items
from app.masters.models import Company

LOCAL_WORD = "LOCAL"
WHERE_TO_LINK = "Settings › Catalogue › Items › ERP codes"
REFRESH_HINT = "If it is a new ERP code, ask the head-office admin to use Refresh now in Settings › ERP Data Sync."


@dataclass
class Verdict:
    state: str
    ok: bool
    message: str
    erp_name: str | None = None
    item_name: str | None = None

    def out(self) -> dict:
        return asdict(self)


def _names(items: list[Item]) -> str:
    return " / ".join(sorted({i.name for i in items}))


async def check_erp_code(session: AsyncSession, code: str | None, company_id: int | None, items: list[Item]) -> Verdict:
    """The verdict for `code` typed against the Item(s) chosen (several only for a set: the Items that share it)."""
    typed = (code or "").strip()
    if not typed:
        return Verdict("BLANK", False, "Type the ERP code, or LOCAL if it was bought locally.")
    if typed.upper() == LOCAL_WORD:
        return Verdict("LOCAL", True, "Bought locally.")
    has_copy = (await session.execute(select(ErpSyncRun.id).where(ErpSyncRun.status == "success").limit(1))).first() is not None
    if not has_copy:
        return Verdict("UNCHECKED", True, "The ERP data has not been copied yet, so this code was not checked.")
    row = (await session.execute(
        select(ErpItemCopy).where(func.upper(ErpItemCopy.icode) == typed.upper(), ErpItemCopy.is_present.is_(True)).limit(1)
    )).scalar_one_or_none()
    if row is None:
        return Verdict("NOT_ERP", False, f"{typed} is not an ERP code. Check it, or type LOCAL if this was bought locally. {REFRESH_HINT}")
    company = await session.get(Company, company_id) if company_id is not None else None
    if company is not None and (row.company_code or "").strip().lower() != company.erp_code.lower():
        return Verdict("NOT_ERP", False, f"{row.icode} belongs to the ERP company {row.company_code}, not {company.erp_code}.")
    erp = _erp_item(row)
    name = erp.name or erp.article_name or None
    resolution = (await resolve_items(session, [erp], company_id))[erp.icode]
    if resolution.not_tracked:
        return Verdict("NOT_TRACKED", False, f"{row.icode} ({name}) is marked not tracked in CKAM, so it is not used for assets.", erp_name=name)
    if resolution.item is None:
        return Verdict("UNLINKED", False, f"{row.icode} is an ERP code ({name}) that is not linked to any Item yet. Please link it first ({WHERE_TO_LINK}).", erp_name=name)
    if resolution.item.id in {i.id for i in items}:
        return Verdict("OK", True, f"OK: {resolution.item.name}" + (f" ({name})" if name else ""), erp_name=name, item_name=resolution.item.name)
    return Verdict("OTHER_ITEM", False, f"{row.icode} is {resolution.item.name}, not {_names(items)}.", erp_name=name, item_name=resolution.item.name)


async def items_for(session: AsyncSession, item_id: int | None = None, bundle_id: int | None = None) -> list[Item]:
    """The Item(s) a code is checked against: the chosen Item, or for a set (a bundle) every active Item that is it."""
    if item_id is not None:
        item = await session.get(Item, item_id)
        return [item] if item is not None else []
    if bundle_id is not None:
        return list((await session.execute(
            select(Item).where(Item.bundle_id == bundle_id, Item.is_active.is_(True)).order_by(Item.name)
        )).scalars().all())
    return []


async def ensure_erp_code(
    session: AsyncSession, code: str | None, company_id: int | None, *, item_id: int | None = None,
    bundle_id: int | None = None, label: str | None = None,
) -> None:
    """Raises ValueError with the sentence (the routers turn it into a 422) when the code is not right for the Item.
    Nothing is checked when there is no Item to check it against (an old line made from a category alone)."""
    items = await items_for(session, item_id, bundle_id)
    if not items:
        return
    verdict = await check_erp_code(session, code, company_id, items)
    if not verdict.ok:
        raise ValueError(f"{label}: ERP Barcode: {verdict.message}" if label else f"ERP Barcode: {verdict.message}")
