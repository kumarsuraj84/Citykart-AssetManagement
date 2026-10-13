"""What the nightly copy reads from the ERP warehouse.

Source: the warehouse's `gold_ckpost` tables (po_line, vendor, article, site), which hold BOTH
companies in one table each, told apart by a `company` column ('CKSPL', 'CKVPL'). Read-only, like
everything that touches the ERP. The rest of CKAM never calls this; `app.erp.sync` does, and the
screens read the copy it makes."""
from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol

from app.erp.source import PgReadOnly

SCHEMA = "gold_ckpost"
FRESHNESS_TARGET = f"{SCHEMA}.po_line"


@dataclass
class WhPoLine:
    company_code: str
    po_line_key: str
    po_code: int
    po_number: str
    po_date: date
    line_status: str
    delivery_location: str | None
    delivery_site_kind: str | None
    supplier_code: str
    supplier_name: str | None
    icode: str | None
    item_description: str | None
    group_code: str | None
    hsn: str | None
    unit: str | None
    ordqty: float
    rate: float
    tax_percent: float | None
    line_netamt: float
    rcqty: float
    cnlqty: float
    hdr_netamt: float
    hdr_chgamt: float
    erp_loaded_at: datetime | None


@dataclass
class WhVendor:
    company_code: str
    vendor_code: str
    name: str
    gstin: str | None
    city: str | None
    is_extinct: bool


@dataclass
class WhItem:
    icode: str
    company_code: str
    article_name: str | None
    section: str | None
    department: str | None
    division: str | None
    cat1: str | None
    cat2: str | None
    cat3: str | None
    cat4: str | None
    cat5: str | None
    cat6: str | None
    hsn: str | None
    unit: str | None


@dataclass
class WhSite:
    company_code: str
    site_code: int
    short_name: str | None
    site_name: str | None
    store_name: str | None
    site_kind: str | None
    store_type: str | None
    store_status: str | None
    is_active_site: bool
    state: str | None
    city: str | None


class WarehouseReader(Protocol):
    async def sites(self) -> list[WhSite]:
        """Every site of both companies (a few hundred rows): stores, warehouses, head offices."""
    async def po_lines(self, since: date, also_po_codes: frozenset[int] = frozenset()) -> list[WhPoLine]:
        """Fixed-asset PO lines of both companies: every line of a PO dated `since` or later, plus every
        line of any PO that still has an open line (however old), plus the POs in `also_po_codes` (the
        ones the copy still holds as open, so a PO that closed today is seen closing)."""
    async def vendors(self, codes: dict[str, set[str]]) -> list[WhVendor]:
        """The suppliers asked for: {company_code: {vendor codes}}."""
    async def items(self, icodes: set[str]) -> list[WhItem]: ...
    async def source_stamp(self) -> datetime | None:
        """When the warehouse last finished loading the PO data (None if it cannot tell)."""


def derive_po_status(line_statuses: list[str]) -> str:
    """A PO has no status of its own in the warehouse, only its lines do: CANCELLED when every line
    is cancelled, CLOSED when every line is closed or cancelled, otherwise OPEN."""
    statuses = [(s or "").strip().upper() for s in line_statuses]
    if statuses and all(s == "CANCELLED" for s in statuses):
        return "CANCELLED"
    if statuses and all(s in ("CLOSED", "CANCELLED") for s in statuses):
        return "CLOSED"
    return "OPEN"


def _text(value) -> str | None:
    text = (str(value).strip() if value is not None else "")
    return text or None


def _f(value) -> float | None:
    return None if value is None else float(value)


class PgWarehouseReader(PgReadOnly):
    statement_timeout_ms = 120_000          # the PO table has about a million rows; this runs at night

    async def po_lines(self, since: date, also_po_codes: frozenset[int] = frozenset()) -> list[WhPoLine]:
        rows = await self._fetch(
            f"""select p.company, p.po_line_key, p.po_code, p.po_number, p.po_date, p.line_status,
                       coalesce(nullif(trim(s.short_name), ''), nullif(trim(s.site_name), ''), nullif(trim(p.site_name), '')) delivery_location,
                       coalesce(s.site_kind, p.site_kind) delivery_site_kind,
                       p.vendor_code::text supplier_code, p.vendor_name supplier_name, p.icode, p.item_name, p.article_name,
                       p.hsn_code, p.unit, p.ordqty, p.rate, p.tax_percent, p.line_netamt, p.rcqty, p.cnlqty,
                       p.hdr_netamt, p.hdr_chgamt, p._loaded_at
                from {SCHEMA}.po_line p
                left join {SCHEMA}.site s on s.company = p.company and s.site_code = p.site_code
                where p.division = 'FIXED ASSETS' and not coalesce(p.is_template, false)
                  and (p.po_date >= $1 or p.po_code = any($2::bigint[]) or p.po_code in (
                        select po_code from {SCHEMA}.po_line where division = 'FIXED ASSETS' and line_status = 'OPEN'))
                order by p.company, p.po_code, p.po_line_key""", since, sorted(also_po_codes))
        return [
            WhPoLine(
                company_code=r["company"], po_line_key=str(r["po_line_key"]), po_code=int(r["po_code"]), po_number=(r["po_number"] or "").strip(),
                po_date=r["po_date"], line_status=(r["line_status"] or "OPEN").strip().upper(),
                delivery_location=_text(r["delivery_location"]), delivery_site_kind=_text(r["delivery_site_kind"]),
                supplier_code=str(r["supplier_code"]), supplier_name=_text(r["supplier_name"]), icode=_text(r["icode"]),
                item_description=_text(r["item_name"]), group_code=_text(r["article_name"]), hsn=_text(r["hsn_code"]), unit=_text(r["unit"]),
                ordqty=float(r["ordqty"] or 0), rate=float(r["rate"] or 0), tax_percent=_f(r["tax_percent"]),
                line_netamt=float(r["line_netamt"] or 0), rcqty=float(r["rcqty"] or 0), cnlqty=float(r["cnlqty"] or 0),
                hdr_netamt=float(r["hdr_netamt"] or 0), hdr_chgamt=float(r["hdr_chgamt"] or 0), erp_loaded_at=r["_loaded_at"],
            )
            for r in rows
        ]

    async def vendors(self, codes: dict[str, set[str]]) -> list[WhVendor]:
        pairs = [(company, code) for company, wanted in codes.items() for code in sorted(wanted)]
        if not pairs:
            return []
        rows = await self._fetch(
            f"""select company, vendor_code::text vendor_code, vendor_name, gstin, city, is_extinct
                from {SCHEMA}.vendor
                where (company, vendor_code::text) in (select * from unnest($1::text[], $2::text[]))""",
            [p[0] for p in pairs], [p[1] for p in pairs])
        return [
            WhVendor(company_code=r["company"], vendor_code=str(r["vendor_code"]), name=(r["vendor_name"] or "").strip(),
                     gstin=_text(r["gstin"]), city=_text(r["city"]), is_extinct=bool(r["is_extinct"]))
            for r in rows
        ]

    async def items(self, icodes: set[str]) -> list[WhItem]:
        if not icodes:
            return []
        rows = await self._fetch(
            f"""select icode, company, article_name, section, department, division, cat1, cat2, cat3, cat4, cat5, cat6, hsn_code, unit
                from {SCHEMA}.article where icode = any($1::text[])""", sorted(icodes))
        return [
            WhItem(icode=r["icode"], company_code=r["company"], article_name=_text(r["article_name"]), section=_text(r["section"]),
                   department=_text(r["department"]), division=_text(r["division"]), cat1=_text(r["cat1"]), cat2=_text(r["cat2"]),
                   cat3=_text(r["cat3"]), cat4=_text(r["cat4"]), cat5=_text(r["cat5"]), cat6=_text(r["cat6"]),
                   hsn=_text(r["hsn_code"]), unit=_text(r["unit"]))
            for r in rows
        ]

    async def sites(self) -> list[WhSite]:
        rows = await self._fetch(
            f"""select company, site_code, short_name, site_name, store_name, site_kind, store_type, store_status, is_active_site, state, city
                from {SCHEMA}.site order by company, site_code""")
        return [
            WhSite(company_code=r["company"], site_code=int(r["site_code"]), short_name=_text(r["short_name"]), site_name=_text(r["site_name"]),
                   store_name=_text(r["store_name"]), site_kind=_text(r["site_kind"]), store_type=_text(r["store_type"]),
                   store_status=_text(r["store_status"]), is_active_site=bool(r["is_active_site"]), state=_text(r["state"]), city=_text(r["city"]))
            for r in rows
        ]

    async def source_stamp(self) -> datetime | None:
        rows = await self._fetch(
            "select max(last_success_at) stamp from meta.v_freshness where target = '" + FRESHNESS_TARGET + "'")
        return rows[0]["stamp"] if rows else None


_reader = PgWarehouseReader()


def get_warehouse_reader() -> WarehouseReader:
    """FastAPI dependency; tests override it with a stand-in."""
    return _reader
