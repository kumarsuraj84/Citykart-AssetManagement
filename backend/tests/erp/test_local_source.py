"""The ERP screens read CKAM's own copy: companies stay apart, statuses come from the lines, and
before the first copy everything still works through the live source."""
from datetime import date

import pytest_asyncio

from app.core.db import SessionLocal
from app.erp.local_source import LocalErpSource
from app.erp.sync import run_sync
from tests.erp.fake_warehouse import FakeWarehouse, wh_item, wh_line, wh_vendor


class Live:
    """Stands in for the live ERP source; records what it was asked."""
    def __init__(self):
        self.calls = []

    def __getattr__(self, name):
        async def call(*args, **kwargs):
            self.calls.append(name)
            return f"live:{name}"
        return call


def warehouse() -> FakeWarehouse:
    wh = FakeWarehouse()
    wh.lines = [
        wh_line("CKSPL", "S1", po_code=1001, po_number="GPO/000001/26-27", po_date=date(2026, 10, 3)),
        wh_line("CKSPL", "S2", po_code=1001, po_number="GPO/000001/26-27", po_date=date(2026, 10, 3), icode="CT2", ordqty=4.0, rate=100.0,
                line_netamt=400.0, rcqty=1.0, cnlqty=1.0),
        wh_line("CKSPL", "S3", po_code=1002, po_number="GPO/000002/26-27", po_date=date(2026, 9, 1), line_status="CLOSED", rcqty=10.0),
        wh_line("CKSPL", "S4", po_code=1003, po_number="GPO/000003/26-27", po_date=date(2026, 8, 1), line_status="CANCELLED", cnlqty=10.0),
        # the other company has a supplier with the SAME code and a different vendor behind it
        wh_line("CKVPL", "V1", po_code=2001, po_number="PO/00000060/26-27", po_date=date(2026, 10, 9), icode="CV1911",
                delivery_location="CKVPL-WH-KHETAWAS", supplier_name="HARSHIT INFOSOLUTION"),
        wh_line("CKVPL", "V2", po_code=2002, po_number="PO/00000061/26-27", po_date=date(2026, 10, 9), supplier_code="61", icode="CV1911"),
    ]
    wh.vendor_list = [wh_vendor("CKSPL", "4431", "TRAANS GLOBAL"), wh_vendor("CKVPL", "4431", "HARSHIT INFOSOLUTION", gstin=None), wh_vendor("CKVPL", "61", "JS TECHNOLOGY")]
    wh.item_list = [
        wh_item("CT371487"), wh_item("CT2", cat1="MOUSE", cat2="DELL", cat3="-", article_name="01-MOUSE[IT-01]", department="FA_IT_MOUSE"),
        wh_item("CV1911", "CKVPL", article_name="FA_IT_UPS", section="IT EQUIPMENTS", department="FA_IT_UPS", cat1="APC BX600C-IN UPS", cat2=None, cat3=None),
    ]
    return wh


@pytest_asyncio.fixture(loop_scope="session")
async def source():
    await run_sync(SessionLocal, warehouse(), "manual")
    return LocalErpSource(live=Live(), session_factory=SessionLocal)


async def test_open_pos_stay_inside_their_company(source):
    spl = await source.open_pos(["4431"], "CKSPL")
    assert [p.po_code for p in spl] == [1001]
    vpl = await source.open_pos(["4431"], "CKVPL")
    assert [p.po_code for p in vpl] == [2001]
    both = await source.open_pos(["4431"])
    assert [p.po_code for p in both] == [2001, 1001]                  # newest first
    assert spl[0].company_code == "CKSPL" and spl[0].line_count == 2 and spl[0].status == "OPEN"
    assert spl[0].supplier_name == "TRAANS GLOBAL" and spl[0].po_number == "GPO/000001/26-27" and spl[0].lines == []


async def test_closed_and_cancelled_pos_are_not_offered(source):
    assert 1002 not in [p.po_code for p in await source.open_pos(["4431"], "CKSPL")]
    assert 1003 not in [p.po_code for p in await source.open_pos(["4431"], "CKSPL")]


async def test_a_po_comes_with_its_lines_quantities_and_status(source):
    po = await source.po(1001)
    assert (po.company_code, po.status, po.delivery_location, po.supplier_code, po.header_net) == ("CKSPL", "OPEN", "CKSPL-WH-TAJNAGAR", "4431", 5310.0)
    assert po.loaded_at is not None and po.line_count == 2
    first, second = po.lines
    assert (first.po_line_key, first.item_code, first.qty, first.rate, first.tax_percent) == ("S1", "CT371487", 10.0, 450.0, 18.0)
    assert (second.item_code, second.qty, second.received_qty, second.cancelled_qty) == ("CT2", 4.0, 1.0, 1.0)
    assert first.description == "-|TRAANS GLOBAL|6000 K|60 WATT" and first.hsn == "9405" and first.unit == "PCS"
    assert (await source.po(1002)).status == "CLOSED"
    assert (await source.po(1003)).status == "CANCELLED"
    assert await source.po(999) is None


async def test_pos_with_lines_returns_only_the_ones_asked_for(source):
    pos = await source.pos_with_lines([1001, 2001, 999])
    assert sorted(p.po_code for p in pos) == [1001, 2001]
    assert await source.pos_with_lines([]) == []


async def test_a_line_the_erp_dropped_is_not_part_of_the_po_any_more():
    wh = warehouse()
    await run_sync(SessionLocal, wh, "manual")
    wh.lines = [l for l in wh.lines if l.po_line_key != "S2"]
    await run_sync(SessionLocal, wh, "schedule")
    source = LocalErpSource(live=Live(), session_factory=SessionLocal)
    po = await source.po(1001)
    assert [l.po_line_key for l in po.lines] == ["S1"] and po.line_count == 1


async def test_a_po_whose_lines_are_all_gone_is_not_found():
    wh = warehouse()
    await run_sync(SessionLocal, wh, "manual")
    wh.lines = [l for l in wh.lines if l.po_code != 1001]
    await run_sync(SessionLocal, wh, "schedule")
    source = LocalErpSource(live=Live(), session_factory=SessionLocal)
    assert await source.po(1001) is None


async def test_vendors_are_listed_per_company(source):
    vpl = await source.vendors("CKVPL")
    assert sorted((v.company_code, v.code, v.name) for v in vpl) == [("CKVPL", "4431", "HARSHIT INFOSOLUTION"), ("CKVPL", "61", "JS TECHNOLOGY")]
    spl = await source.vendors("CKSPL")
    assert [(v.code, v.name, v.gstin) for v in spl] == [("4431", "TRAANS GLOBAL", "07AAAAA0000A1Z5")]
    assert len(await source.vendors()) == 3


async def test_items_come_with_their_hierarchy_and_clean_descriptive_text(source):
    items = {i.icode: i for i in await source.items(["CT371487", "CV1911", "NOPE"])}
    assert set(items) == {"CT371487", "CV1911"}
    desk = items["CT371487"]
    assert (desk.article_key, desk.article_name, desk.section, desk.department, desk.division) == (
        "FA_EF_LINEAR LIGHT", "FA_EF_LINEAR LIGHT", "ELECTRICAL FITTING", "FA_EF_LIGHTS", "FIXED ASSETS")
    assert desk.cats == ["TRAANS GLOBAL", "6000 K"]            # the "-" placeholder is dropped
    assert items["CV1911"].name == "APC BX600C-IN UPS"
    assert await source.items([]) == []


async def test_bought_articles_are_counted_per_company(source):
    spl = {a.article_key: a for a in await source.bought_articles("CKSPL")}
    assert set(spl) == {"FA_EF_LINEAR LIGHT", "01-MOUSE[IT-01]"}
    mouse = spl["01-MOUSE[IT-01]"]
    assert (mouse.codes, mouse.units, mouse.lines, mouse.icodes, mouse.names) == (1, 4.0, 1, ["CT2"], ["MOUSE"])   # names = the product's own name (CAT1)
    vpl = {a.article_key: a for a in await source.bought_articles("CKVPL")}
    assert set(vpl) == {"FA_IT_UPS"} and vpl["FA_IT_UPS"].lines == 2
    assert set(a.article_key for a in await source.bought_articles()) == {"FA_EF_LINEAR LIGHT", "01-MOUSE[IT-01]", "FA_IT_UPS"}


async def test_the_codes_of_an_article_are_listed_with_their_use(source):
    [code] = await source.article_codes("01-MOUSE[IT-01]", "CKSPL")
    assert (code.icode, code.name, code.units, code.lines) == ("CT2", "MOUSE", 4.0, 1)
    assert await source.article_codes("01-MOUSE[IT-01]", "CKVPL") == []


async def test_a_tax_the_warehouse_does_not_store_is_worked_out_from_the_po_total_and_marked_as_such():
    wh = FakeWarehouse()
    wh.lines = [
        wh_line("CKSPL", "T1", po_code=3001, tax_percent=None, line_netamt=4500.0, hdr_netamt=5310.0),     # 4500 + 18% = 5310
        wh_line("CKSPL", "T2", po_code=3002, tax_percent=None, line_netamt=4500.0, hdr_netamt=4500.0),     # no tax on top: cannot be worked out
        wh_line("CKSPL", "T3", po_code=3003, tax_percent=12.0, line_netamt=4500.0, hdr_netamt=5310.0),     # a stored tax is kept as it is
    ]
    await run_sync(SessionLocal, wh, "manual")
    source = LocalErpSource(live=Live(), session_factory=SessionLocal)
    [t1] = (await source.po(3001)).lines
    [t2] = (await source.po(3002)).lines
    [t3] = (await source.po(3003)).lines
    assert (t1.tax_percent, t1.tax_derived) == (18.0, True)
    assert (t2.tax_percent, t2.tax_derived) == (None, False)
    assert (t3.tax_percent, t3.tax_derived) == (12.0, False)


async def test_receipts_and_invoices_still_come_from_the_live_source(source):
    assert await source.receipts([1001]) == "live:receipts"
    assert await source.invoices([1001]) == "live:invoices"


async def test_before_the_first_copy_everything_goes_to_the_live_source():
    live = Live()
    source = LocalErpSource(live=live, session_factory=SessionLocal)
    assert await source.open_pos(["4431"], "CKSPL") == "live:open_pos"
    assert await source.po(1001) == "live:po"
    assert await source.pos_with_lines([1001]) == "live:pos_with_lines"
    assert await source.vendors("CKSPL") == "live:vendors"
    assert await source.items(["CT1"]) == "live:items"
    assert await source.bought_articles("CKSPL") == "live:bought_articles"
    assert await source.article_codes("A", "CKSPL") == "live:article_codes"


async def test_a_failed_copy_alone_does_not_switch_to_the_copy():
    wh = FakeWarehouse()
    wh.down = "The ERP database could not be reached (OSError)."
    await run_sync(SessionLocal, wh, "manual")
    live = Live()
    source = LocalErpSource(live=live, session_factory=SessionLocal)
    assert await source.po(1) == "live:po"
