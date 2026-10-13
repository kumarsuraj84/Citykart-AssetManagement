"""An in-memory stand-in for the ERP warehouse, for the tests of the sync and of the local copy."""
from datetime import date, datetime, timezone

from app.erp.source import ErpUnavailable
from app.erp.warehouse import WhItem, WhPoLine, WhVendor

LOADED = datetime(2026, 10, 13, 5, 44, tzinfo=timezone.utc)


def wh_line(company="CKSPL", key="L1", po_code=1001, po_number="GPO/000001/26-27", **over) -> WhPoLine:
    base = dict(
        company_code=company, po_line_key=key, po_code=po_code, po_number=po_number, po_date=date(2026, 10, 1), line_status="OPEN",
        delivery_location="CKSPL-WH-TAJNAGAR", delivery_site_kind="WAREHOUSE", supplier_code="4431", supplier_name="TRAANS GLOBAL",
        icode="CT371487", item_description="-|TRAANS GLOBAL|6000 K|60 WATT", group_code="FA_EF_LINEAR LIGHT", hsn="9405", unit="PCS",
        ordqty=10.0, rate=450.0, tax_percent=18.0, line_netamt=4500.0, rcqty=0.0, cnlqty=0.0, hdr_netamt=5310.0, hdr_chgamt=810.0,
        erp_loaded_at=LOADED,
    )
    base.update(over)
    return WhPoLine(**base)


def wh_vendor(company="CKSPL", code="4431", name="TRAANS GLOBAL", gstin="07AAAAA0000A1Z5", **over) -> WhVendor:
    base = dict(company_code=company, vendor_code=code, name=name, gstin=gstin, city="DELHI", is_extinct=False)
    base.update(over)
    return WhVendor(**base)


def wh_item(icode="CT371487", company="CKSPL", **over) -> WhItem:
    base = dict(icode=icode, company_code=company, article_name="FA_EF_LINEAR LIGHT", section="ELECTRICAL FITTING", department="FA_EF_LIGHTS",
                division="FIXED ASSETS", cat1="-", cat2="TRAANS GLOBAL", cat3="6000 K", cat4=None, cat5=None, cat6=None, hsn="9405", unit="PCS")
    base.update(over)
    return WhItem(**base)


class FakeWarehouse:
    """Implements WarehouseReader. Set `lines`, `vendor_list`, `item_list`, `stamp`; `down` makes every call fail."""

    def __init__(self):
        self.lines: list[WhPoLine] = []
        self.vendor_list: list[WhVendor] = []
        self.item_list: list[WhItem] = []
        self.stamp: datetime | None = LOADED
        self.down: str | None = None
        self.asked_since: date | None = None
        self.asked_also: frozenset[int] = frozenset()

    def _check(self):
        if self.down:
            raise ErpUnavailable(self.down)

    async def po_lines(self, since, also_po_codes=frozenset()):
        self._check()
        self.asked_since, self.asked_also = since, also_po_codes
        return list(self.lines)

    async def vendors(self, codes):
        self._check()
        return [v for v in self.vendor_list if v.vendor_code in codes.get(v.company_code, set())]

    async def items(self, icodes):
        self._check()
        return [i for i in self.item_list if i.icode in icodes]

    async def source_stamp(self):
        self._check()
        return self.stamp
