"""Read-only access to the ERP data warehouse (PostgreSQL, a different server).

CKAM only ever SELECTs from a few views in the `gold_ckam` schema; every
connection is opened with default_transaction_read_only so a mistake here
cannot write to the ERP. The rest of CKAM talks to the small `ErpSource`
interface below, never to asyncpg, so tests swap in a stand-in
(`app.erp.deps.get_erp_source` is a FastAPI dependency)."""
import time
from dataclasses import dataclass, field
from datetime import date
from typing import Protocol

import asyncpg

from app.core.config import settings

# The views this module reads. Names live here so they are changed in one place.
VIEW_PO_LINE = "gold_ckam.po_line"
VIEW_VENDOR = "gold_ckam.vendor"
VIEW_RECEIPT = "gold_ckam.po_receipt_line"
VIEW_INVOICE = "gold_ckam.po_invoice"
# The item master. `gold_ckam.item` is the view we asked the ERP team for (it
# carries the stable article_code, vendor, unit, HSN and extinct flags); until it
# exists the readable warehouse table is used, which has the same hierarchy and
# CAT1..CAT6 text but no article_code, so the article NAME is the key then.
VIEW_ITEM = "gold_ckam.item"
FALLBACK_ITEM = """(select icode, null::text as article_code, article_name, section, department, division,
        cat1, cat2, cat3, cat4, cat5, cat6, null::text as item_name, null::text as vendor_name,
        null::text as unit_name, null::text as hsn_code, false as item_extinct, false as article_extinct
    from silver.dim_item)"""
PLACEHOLDER_NAMES = {"", "-", "undefined", "na", "n/a", "1", "0"}

CONNECT_TIMEOUT_SECONDS = 10
CACHE_SECONDS = 60


class ErpUnavailable(Exception):
    """The ERP link is off, unreachable, or the view is not there / not readable.
    The message is written for the user."""


@dataclass
class ErpVendor:
    code: str
    name: str
    gstin: str | None = None
    contact_name: str | None = None
    phone: str | None = None
    email: str | None = None
    is_active: bool = True


@dataclass
class ErpPoLine:
    po_line_key: int
    item_code: str
    description: str
    group_code: str | None
    hsn: str | None
    unit: str | None
    qty: float
    rate: float
    tax_percent: float | None
    line_net: float
    received_qty: float = 0
    cancelled_qty: float = 0


@dataclass
class ErpPo:
    po_code: int
    po_number: str
    po_date: date
    status: str
    company_code: str
    company_name: str
    delivery_location: str
    supplier_code: str
    supplier_name: str
    header_net: float = 0
    header_charges: float = 0
    line_count: int = 0
    lines: list[ErpPoLine] = field(default_factory=list)


@dataclass
class ErpReceipt:
    """Goods received (a GRC line) against a PO item."""
    po_code: int
    item_code: str
    grc_no: str | None
    grc_date: date | None
    received_qty: float


@dataclass
class ErpInvoice:
    """A purchase invoice (PI) booked against a PO, with the vendor's own
    invoice number it was booked from."""
    po_code: int
    vendor_invoice_no: str | None
    vendor_invoice_date: date | None
    pi_number: str | None
    pi_date: date | None
    pi_amount: float | None


def clean_name(value: str | None) -> str:
    """An ERP product-name field, or '' when it is one of the placeholders the
    ERP uses for 'nothing here' ('-', UNDEFINED, 1 ...)."""
    text = (value or "").strip()
    return "" if text.lower() in PLACEHOLDER_NAMES else text


@dataclass
class ErpItem:
    """One ERP item code with where it sits (Division > Section > Department >
    Article) and the descriptive text users typed (CAT1..CAT6). The code is a
    purchasing code (item + vendor + spec); it is not what an asset IS."""
    icode: str
    article_key: str           # article_code when the ERP view has it, else the article name
    article_name: str
    section: str
    department: str
    division: str = "FIXED ASSETS"
    cats: list[str] = field(default_factory=list)   # CAT1..CAT6, placeholders removed
    vendor_name: str | None = None
    unit: str | None = None
    hsn: str | None = None
    extinct: bool = False

    @property
    def name(self) -> str:
        """CAT1: the product's own name."""
        return self.cats[0] if self.cats else ""

    @property
    def description(self) -> str:
        """All the descriptive text, to show beside the code."""
        return " · ".join(self.cats)


@dataclass
class ErpArticle:
    """An Article that has been bought, with how much, for the mapping screen."""
    article_key: str
    article_name: str
    section: str
    department: str
    codes: int
    units: float
    lines: int
    samples: list[str] = field(default_factory=list)


@dataclass
class ErpArticleCode:
    icode: str
    name: str
    description: str
    units: float
    lines: int


class ErpSource(Protocol):
    async def items(self, codes: list[str]) -> list[ErpItem]: ...
    async def bought_articles(self, company_code: str | None = None) -> list[ErpArticle]: ...
    async def article_codes(self, article_key: str, company_code: str | None = None) -> list[ErpArticleCode]: ...
    async def receipts(self, po_codes: list[int]) -> list[ErpReceipt]: ...
    async def invoices(self, po_codes: list[int]) -> list[ErpInvoice]: ...
    async def vendors(self) -> list[ErpVendor]: ...
    async def open_pos(self, supplier_codes: list[str]) -> list[ErpPo]:
        """Headers only (no lines) of the OPEN POs of these suppliers, newest first."""
    async def po(self, po_code: int) -> ErpPo | None:
        """One PO with all its lines."""


def is_configured() -> bool:
    return bool(settings.po_source_host and settings.po_source_db and settings.po_source_user and settings.po_source_password)


def _f(value) -> float | None:
    return None if value is None else float(value)


class PgErpSource:
    def __init__(self):
        self._cache: dict[str, tuple[float, object]] = {}

    async def _connect(self) -> asyncpg.Connection:
        if not is_configured():
            raise ErpUnavailable("The ERP connection is not set up on this server.")
        try:
            return await asyncpg.connect(
                host=settings.po_source_host, port=settings.po_source_port, database=settings.po_source_db,
                user=settings.po_source_user, password=settings.po_source_password,
                timeout=CONNECT_TIMEOUT_SECONDS, server_settings={"default_transaction_read_only": "on"},
            )
        except (OSError, TimeoutError, asyncpg.PostgresError) as exc:
            raise ErpUnavailable(f"The ERP database could not be reached ({type(exc).__name__}).") from exc

    async def _fetch(self, sql: str, *args) -> list[asyncpg.Record]:
        conn = await self._connect()
        try:
            return await conn.fetch(sql, *args)
        except asyncpg.UndefinedTableError as exc:
            raise ErpUnavailable("The ERP view this screen reads does not exist yet.") from exc
        except asyncpg.InsufficientPrivilegeError as exc:
            raise ErpUnavailable("CKAM is not allowed to read the ERP view (a database grant is missing).") from exc
        except asyncpg.PostgresError as exc:
            raise ErpUnavailable(f"The ERP database refused the request ({type(exc).__name__}).") from exc
        finally:
            await conn.close()

    def _cached(self, key: str):
        hit = self._cache.get(key)
        return hit[1] if hit and time.monotonic() - hit[0] < CACHE_SECONDS else None

    def _remember(self, key: str, value):
        self._cache[key] = (time.monotonic(), value)
        return value

    async def vendors(self) -> list[ErpVendor]:
        cached = self._cached("vendors")
        if cached is not None:
            return cached
        try:
            rows = await self._fetch(
                f"select supplier_code, supplier_name, gstin, contact_name, phone, email, is_active from {VIEW_VENDOR} order by supplier_name")
        except ErpUnavailable:
            # The vendor view has not been created (or is not readable) yet: use the
            # suppliers that appear on Fixed Assets POs. Same codes and names, just no
            # GSTIN / contact details until the real vendor view exists.
            rows = await self._fetch(
                f"""select supplier_code, max(supplier_name) supplier_name, null::text gstin, null::text contact_name,
                           null::text phone, null::text email, true as is_active
                    from {VIEW_PO_LINE} group by supplier_code order by max(supplier_name)""")
        return self._remember("vendors", [
            ErpVendor(code=str(r["supplier_code"]), name=(r["supplier_name"] or "").strip(), gstin=r["gstin"],
                      contact_name=r["contact_name"], phone=r["phone"], email=r["email"],
                      is_active=True if r["is_active"] is None else bool(r["is_active"]))
            for r in rows
        ])

    async def _item_relation(self) -> str:
        """`gold_ckam.item` when it exists and is readable, else the fallback."""
        cached = self._cached("item_relation")
        if cached is not None:
            return cached
        try:
            await self._fetch(f"select 1 from {VIEW_ITEM} limit 1")
            relation = VIEW_ITEM
        except ErpUnavailable:
            relation = FALLBACK_ITEM
        return self._remember("item_relation", relation)

    @staticmethod
    def _erp_item(r) -> ErpItem:
        article_name = (r["article_name"] or "").strip()
        article_key = str(r["article_code"]).strip() if r["article_code"] is not None else article_name
        cats = [c for c in (clean_name(r[f"cat{n}"]) for n in range(1, 7)) if c]
        return ErpItem(
            icode=r["icode"], article_key=article_key, article_name=article_name, section=(r["section"] or "").strip(),
            department=(r["department"] or "").strip(), division=(r["division"] or "").strip(), cats=cats,
            vendor_name=clean_name(r["vendor_name"]) or None, unit=clean_name(r["unit_name"]) or None,
            hsn=clean_name(None if r["hsn_code"] is None else str(r["hsn_code"])) or None,
            extinct=bool(r["item_extinct"] or r["article_extinct"]),
        )

    async def items(self, codes: list[str]) -> list[ErpItem]:
        if not codes:
            return []
        rel = await self._item_relation()
        rows = await self._fetch(
            f"""select icode, article_code, article_name, section, department, division, cat1, cat2, cat3, cat4, cat5, cat6,
                       vendor_name, unit_name, hsn_code, item_extinct, article_extinct
                from {rel} i where icode = any($1::text[])""", codes)
        return [self._erp_item(r) for r in rows]

    async def bought_articles(self, company_code: str | None = None) -> list[ErpArticle]:
        key = f"bought_articles:{company_code}"
        cached = self._cached(key)
        if cached is not None:
            return cached
        rel = await self._item_relation()
        rows = await self._fetch(
            f"""select coalesce(i.article_code::text, i.article_name) article_key, max(i.article_name) article_name,
                       max(i.section) section, max(i.department) department, count(distinct l.icode) codes,
                       sum(l.ordqty) units, count(*) lines,
                       (array_agg(distinct left(i.cat1, 40)) filter (where i.cat1 is not null))[1:4] samples
                from {VIEW_PO_LINE} l join {rel} i on i.icode = l.icode
                where ($1::text is null or l.company_code = $1)
                group by 1 order by sum(l.line_netamt) desc""", company_code)
        return self._remember(key, [
            ErpArticle(article_key=r["article_key"], article_name=(r["article_name"] or "").strip(), section=(r["section"] or "").strip(),
                       department=(r["department"] or "").strip(), codes=int(r["codes"]), units=float(r["units"] or 0),
                       lines=int(r["lines"]), samples=[s for s in (clean_name(x) for x in (r["samples"] or [])) if s])
            for r in rows
        ])

    async def article_codes(self, article_key: str, company_code: str | None = None) -> list[ErpArticleCode]:
        rel = await self._item_relation()
        rows = await self._fetch(
            f"""select i.icode, i.cat1, i.cat2, i.cat3, i.cat4, i.cat5, i.cat6, coalesce(sum(l.ordqty), 0) units, count(l.icode) lines
                from {rel} i left join {VIEW_PO_LINE} l on l.icode = i.icode and ($2::text is null or l.company_code = $2)
                where coalesce(i.article_code::text, i.article_name) = $1
                group by i.icode, i.cat1, i.cat2, i.cat3, i.cat4, i.cat5, i.cat6
                having count(l.icode) > 0 order by sum(l.ordqty) desc""", article_key, company_code)
        out = []
        for r in rows:
            cats = [c for c in (clean_name(r[f"cat{n}"]) for n in range(1, 7)) if c]
            out.append(ErpArticleCode(icode=r["icode"], name=cats[0] if cats else "", description=" · ".join(cats),
                                      units=float(r["units"] or 0), lines=int(r["lines"])))
        return out

    async def receipts(self, po_codes: list[int]) -> list[ErpReceipt]:
        if not po_codes:
            return []
        key = f"receipts:{sorted(po_codes)}"
        cached = self._cached(key)
        if cached is not None:
            return cached
        rows = await self._fetch(
            f"select po_code, icode, grc_no, grc_date, received_qty from {VIEW_RECEIPT} where po_code = any($1::bigint[])",
            po_codes)
        return self._remember(key, [
            ErpReceipt(po_code=r["po_code"], item_code=r["icode"], grc_no=None if r["grc_no"] is None else str(r["grc_no"]),
                       grc_date=r["grc_date"], received_qty=float(r["received_qty"] or 0))
            for r in rows
        ])

    async def invoices(self, po_codes: list[int]) -> list[ErpInvoice]:
        if not po_codes:
            return []
        key = f"invoices:{sorted(po_codes)}"
        cached = self._cached(key)
        if cached is not None:
            return cached
        rows = await self._fetch(
            f"""select po_code, vendor_invoice_no, vendor_invoice_date, pi_number, pi_date, pi_amount
                from {VIEW_INVOICE} where po_code = any($1::bigint[])""", po_codes)
        return self._remember(key, [
            ErpInvoice(po_code=r["po_code"], vendor_invoice_no=None if r["vendor_invoice_no"] is None else str(r["vendor_invoice_no"]).strip(),
                       vendor_invoice_date=r["vendor_invoice_date"],
                       pi_number=None if r["pi_number"] is None else str(r["pi_number"]).strip(),
                       pi_date=r["pi_date"], pi_amount=_f(r["pi_amount"]))
            for r in rows
        ])

    async def open_pos(self, supplier_codes: list[str]) -> list[ErpPo]:
        if not supplier_codes:
            return []
        rows = await self._fetch(
            f"""select po_code, max(po_number) po_number, max(po_date) po_date, max(po_status) po_status,
                       max(company_code) company_code, max(company_name) company_name,
                       max(delivery_location) delivery_location, max(supplier_code) supplier_code,
                       max(supplier_name) supplier_name, max(hdr_netamt) hdr_netamt, max(hdr_chgamt) hdr_chgamt,
                       count(*) line_count
                from {VIEW_PO_LINE}
                where po_status = 'OPEN' and supplier_code::text = any($1::text[])
                group by po_code order by max(po_date) desc, po_code desc""",
            supplier_codes)
        return [self._header(r) for r in rows]

    async def po(self, po_code: int) -> ErpPo | None:
        rows = await self._fetch(
            f"""select po_line_key, po_code, po_number, po_date, po_status, company_code, company_name,
                       delivery_location, supplier_code, supplier_name, icode, item_description, group_code, hsn,
                       unit, ordqty, rate, tax_percent, line_netamt, rcqty, cnlqty, hdr_netamt, hdr_chgamt
                from {VIEW_PO_LINE} where po_code = $1 order by po_line_key""", po_code)
        if not rows:
            return None
        po = self._header(rows[0])
        po.line_count = len(rows)
        po.lines = [
            ErpPoLine(po_line_key=r["po_line_key"], item_code=r["icode"], description=(r["item_description"] or "").strip(),
                      group_code=r["group_code"], hsn=r["hsn"], unit=r["unit"], qty=float(r["ordqty"] or 0),
                      rate=float(r["rate"] or 0), tax_percent=_f(r["tax_percent"]), line_net=float(r["line_netamt"] or 0),
                      received_qty=float(r["rcqty"] or 0), cancelled_qty=float(r["cnlqty"] or 0))
            for r in rows
        ]
        return po

    @staticmethod
    def _header(r) -> ErpPo:
        return ErpPo(
            po_code=r["po_code"], po_number=r["po_number"], po_date=r["po_date"], status=r["po_status"],
            company_code=r["company_code"], company_name=r["company_name"], delivery_location=r["delivery_location"],
            supplier_code=str(r["supplier_code"]), supplier_name=(r["supplier_name"] or "").strip(),
            header_net=float(r["hdr_netamt"] or 0), header_charges=float(r["hdr_chgamt"] or 0),
            line_count=int(r["line_count"]) if "line_count" in r.keys() else 0,
        )


_source = PgErpSource()


def get_erp_source() -> ErpSource:
    """FastAPI dependency; tests override it with a stand-in."""
    return _source
