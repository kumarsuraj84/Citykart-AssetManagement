"""Reading both companies' purchasing data from the warehouse's gold_ckpost tables."""
from datetime import date, datetime, timezone

import pytest

from app.erp.source import ErpUnavailable
from app.erp.warehouse import PgWarehouseReader, WhPoLine, derive_po_status

LOADED = datetime(2026, 10, 13, 5, 44, tzinfo=timezone.utc)


@pytest.mark.parametrize("statuses, expected", [
    (["CANCELLED", "CANCELLED"], "CANCELLED"),
    (["CLOSED", "CANCELLED"], "CLOSED"),
    (["CLOSED", "CLOSED"], "CLOSED"),
    (["CLOSED", "OPEN"], "OPEN"),
    (["OPEN"], "OPEN"),
    ([], "OPEN"),
])
def test_a_pos_status_comes_from_its_lines(statuses, expected):
    assert derive_po_status(statuses) == expected


def row(company, key, **over):
    base = {
        "company": company, "po_line_key": key, "po_code": 1134078554, "po_number": "GPO/001503/26-27", "po_date": date(2026, 10, 1),
        "line_status": "OPEN", "delivery_location": "BWR", "delivery_site_kind": "STORE", "supplier_code": "4431",
        "supplier_name": "TRAANS GLOBAL  ", "icode": "CT371487", "item_name": "-|TRAANS GLOBAL|6000 K|60 WATT  ",
        "article_name": "FA_EF_LINEAR LIGHT", "hsn_code": "9405", "unit": "PCS", "ordqty": 105, "rate": 450, "tax_percent": 18,
        "line_netamt": 55755, "rcqty": 0, "cnlqty": 0, "hdr_netamt": 55755, "hdr_chgamt": 0, "_loaded_at": LOADED,
    }
    base.update(over)
    return base


async def test_po_lines_of_both_companies_are_read_from_the_gold_layer():
    reader = PgWarehouseReader()
    calls = []

    async def fake_fetch(sql, *args):
        calls.append((sql, args))
        return [row("CKSPL", "1217282"), row("CKVPL", "CV-77", supplier_code="61", delivery_location="CKVPL-WH-FARUKHNAGAR", delivery_site_kind="WAREHOUSE")]

    reader._fetch = fake_fetch
    lines = await reader.po_lines(date(2025, 4, 1))
    sql, args = calls[0]
    assert "gold_ckpost.po_line" in sql and "gold_ckpost.site" in sql and "'FIXED ASSETS'" in sql
    assert args == (date(2025, 4, 1),)
    assert [(l.company_code, l.po_line_key, l.supplier_code) for l in lines] == [("CKSPL", "1217282", "4431"), ("CKVPL", "CV-77", "61")]
    first = lines[0]
    assert isinstance(first, WhPoLine)
    assert first.item_description == "-|TRAANS GLOBAL|6000 K|60 WATT"          # stripped
    assert first.supplier_name == "TRAANS GLOBAL"
    assert first.group_code == "FA_EF_LINEAR LIGHT" and first.hsn == "9405"
    assert (first.ordqty, first.rate, first.tax_percent) == (105.0, 450.0, 18.0)
    assert lines[1].delivery_location == "CKVPL-WH-FARUKHNAGAR" and lines[1].delivery_site_kind == "WAREHOUSE"
    assert first.erp_loaded_at == LOADED


async def test_a_missing_tax_percent_stays_missing():
    reader = PgWarehouseReader()

    async def fake_fetch(sql, *args):
        return [row("CKSPL", "1", tax_percent=None)]

    reader._fetch = fake_fetch
    [line] = await reader.po_lines(date(2025, 4, 1))
    assert line.tax_percent is None


async def test_vendors_are_asked_for_by_company_and_code():
    reader = PgWarehouseReader()
    calls = []

    async def fake_fetch(sql, *args):
        calls.append((sql, args))
        return [
            {"company": "CKSPL", "vendor_code": "2470", "vendor_name": "JS TECHNOLOGY ", "gstin": " 07AAAAA0000A1Z5 ", "city": "DELHI", "is_extinct": False},
            {"company": "CKVPL", "vendor_code": "61", "vendor_name": "JS TECHNOLOGY", "gstin": "", "city": None, "is_extinct": None},
        ]

    reader._fetch = fake_fetch
    vendors = await reader.vendors({"CKSPL": {"2470"}, "CKVPL": {"61"}})
    sql, args = calls[0]
    assert "gold_ckpost.vendor" in sql
    assert sorted(zip(args[0], args[1])) == [("CKSPL", "2470"), ("CKVPL", "61")]
    assert [(v.company_code, v.vendor_code, v.name, v.gstin, v.is_extinct) for v in vendors] == [
        ("CKSPL", "2470", "JS TECHNOLOGY", "07AAAAA0000A1Z5", False), ("CKVPL", "61", "JS TECHNOLOGY", None, False)]


async def test_nothing_is_asked_when_there_is_nothing_to_look_up():
    reader = PgWarehouseReader()

    async def boom(sql, *args):
        raise AssertionError("no query expected")

    reader._fetch = boom
    assert await reader.vendors({}) == []
    assert await reader.items(set()) == []


async def test_items_come_from_the_article_table():
    reader = PgWarehouseReader()
    calls = []

    async def fake_fetch(sql, *args):
        calls.append((sql, args))
        return [{"icode": "CT371487", "company": "CKSPL", "article_name": "FA_EF_LINEAR LIGHT", "section": "ELECTRICAL FITTING", "department": "FA_EF_LIGHTS",
                 "division": "FIXED ASSETS", "cat1": "-", "cat2": "TRAANS GLOBAL", "cat3": None, "cat4": None, "cat5": None, "cat6": None,
                 "hsn_code": "9405", "unit": "PCS"}]

    reader._fetch = fake_fetch
    [item] = await reader.items({"CT371487"})
    assert "gold_ckpost.article" in calls[0][0] and calls[0][1] == (["CT371487"],)
    assert (item.icode, item.company_code, item.article_name, item.cat2, item.hsn) == ("CT371487", "CKSPL", "FA_EF_LINEAR LIGHT", "TRAANS GLOBAL", "9405")


async def test_the_warehouses_own_load_time_is_the_source_stamp():
    reader = PgWarehouseReader()
    calls = []

    async def fake_fetch(sql, *args):
        calls.append(sql)
        return [{"stamp": LOADED}]

    reader._fetch = fake_fetch
    assert await reader.source_stamp() == LOADED
    assert "meta.v_freshness" in calls[0] and "gold_ckpost.po_line" in calls[0]


async def test_a_warehouse_problem_reaches_the_caller_unchanged():
    reader = PgWarehouseReader()

    async def fake_fetch(sql, *args):
        raise ErpUnavailable("The ERP database could not be reached (OSError).")

    reader._fetch = fake_fetch
    with pytest.raises(ErpUnavailable, match="could not be reached"):
        await reader.po_lines(date(2025, 4, 1))
