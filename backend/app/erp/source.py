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


class ErpSource(Protocol):
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
        rows = await self._fetch(
            f"select supplier_code, supplier_name, gstin, contact_name, phone, email, is_active from {VIEW_VENDOR} order by supplier_name")
        return self._remember("vendors", [
            ErpVendor(code=str(r["supplier_code"]), name=(r["supplier_name"] or "").strip(), gstin=r["gstin"],
                      contact_name=r["contact_name"], phone=r["phone"], email=r["email"],
                      is_active=True if r["is_active"] is None else bool(r["is_active"]))
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
