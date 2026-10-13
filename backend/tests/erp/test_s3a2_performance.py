"""S3a-2: the PO picker resolves every open PO in one pass over CKAM's ERP copy -- the number of database
queries does not grow with the number of POs or lines -- and stays quick on a copy the size of the real one
(about 18,000 lines)."""
import time
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import event, insert

from app.core.db import SessionLocal, engine
from app.erp.local_source import LocalErpSource
from app.erp.mirror_models import ErpItemCopy, ErpPoLineCopy, ErpSyncRun, ErpVendorCopy
from app.erp.source import get_erp_source
from app.items.models import ItemMap
from app.main import app
from app.masters.models import VendorErpLink
from tests.erp.test_erp_api import _headers, _setup

NOW = datetime(2026, 10, 13, 5, 44, tzinfo=timezone.utc)
ARTICLES = 40
CODES_PER_ARTICLE = 10
SUPPLIERS = 40


class NoLive:
    """The live ERP must not be asked: the copy exists."""
    def __getattr__(self, name):
        raise AssertionError(f"the live ERP was asked for {name}")


@pytest.fixture
def local_source():
    source = LocalErpSource(live=NoLive(), session_factory=SessionLocal)
    app.dependency_overrides[get_erp_source] = lambda: source
    yield source
    app.dependency_overrides.pop(get_erp_source, None)


def _icode(n: int) -> str:
    return f"CT{n:06d}"


async def _seed_masters():
    async with SessionLocal() as s:
        await s.execute(insert(ErpSyncRun), [{"status": "success", "trigger": "manual", "started_at": NOW, "finished_at": NOW, "source_stamp": NOW}])
        await s.execute(insert(ErpItemCopy), [{
            "icode": _icode(a * CODES_PER_ARTICLE + c), "company_code": "CKSPL", "article_name": f"ARTICLE {a:02d}",
            "section": "SECTION", "department": f"DEPT {a % 7}", "division": "FIXED ASSETS", "cat1": f"PRODUCT {a}-{c % 3}",
            "row_hash": "x", "first_seen_at": NOW, "last_seen_at": NOW, "is_present": True,
        } for a in range(ARTICLES) for c in range(CODES_PER_ARTICLE)])
        await s.execute(insert(ErpVendorCopy), [{
            "company_code": "CKSPL", "vendor_code": f"S{v}", "name": f"SUPPLIER {v}", "gstin": None,
            "row_hash": "x", "first_seen_at": NOW, "last_seen_at": NOW, "is_present": True} for v in range(SUPPLIERS)])
        await s.commit()


async def _seed_pos(first_po: int, open_pos: int, lines_per_po: int, closed_pos: int = 0, closed_lines: int = 0):
    rows = []

    def add(po_code, n_lines, status):
        for i in range(n_lines):
            code = _icode((po_code * 7 + i) % (ARTICLES * CODES_PER_ARTICLE))
            rows.append({
                "company_code": "CKSPL", "po_line_key": f"{po_code}-{i}", "po_code": po_code, "po_number": f"SPO/{po_code}",
                "po_date": date(2026, 9, 1), "line_status": status, "delivery_location": "CKSPL-WH-TAJNAGAR",
                "supplier_code": f"S{po_code % SUPPLIERS}", "supplier_name": f"SUPPLIER {po_code % SUPPLIERS}", "icode": code,
                "item_description": "THING", "ordqty": 5, "rate": 100, "tax_percent": 18, "line_netamt": 500,
                "rcqty": 0, "cnlqty": 0, "hdr_netamt": 590 * n_lines, "hdr_chgamt": 0,
                "row_hash": "x", "first_seen_at": NOW, "last_seen_at": NOW, "is_present": True,
            })
    for p in range(open_pos):
        add(first_po + p, lines_per_po, "OPEN")
    for p in range(closed_pos):
        add(first_po + open_pos + p, closed_lines, "CLOSED")
    async with SessionLocal() as s:
        for start in range(0, len(rows), 2000):
            await s.execute(insert(ErpPoLineCopy), rows[start:start + 2000])
        await s.commit()


async def _rules_and_links(ids):
    async with SessionLocal() as s:
        # half the suppliers linked; a third of the Articles linked to an Item, one Department not tracked
        s.add_all([VendorErpLink(vendor_id=ids["vansh"], company_id=ids["spl"], erp_vendor_code=f"S{v}") for v in range(0, SUPPLIERS, 2)])
        s.add_all([ItemMap(match_type="ARTICLE", article_key=f"ARTICLE {a:02d}", item_id=ids["item_cable"], company_id=ids["spl"])
                   for a in range(0, ARTICLES, 3)])
        s.add(ItemMap(match_type="DEPARTMENT", level_key="DEPT 1", not_tracked=True, company_id=ids["spl"]))
        await s.commit()


class QueryCounter:
    def __init__(self):
        self.count = 0

    def __call__(self, *args, **kwargs):
        self.count += 1

    def __enter__(self):
        event.listen(engine.sync_engine, "before_cursor_execute", self)
        return self

    def __exit__(self, *exc):
        event.remove(engine.sync_engine, "before_cursor_execute", self)


async def _list(client, h):
    with QueryCounter() as counter:
        resp = await client.get("/api/erp/pos", params={"envelope": "true"}, headers=h)
    assert resp.status_code == 200, resp.text
    return resp.json(), counter.count


async def test_the_number_of_queries_does_not_grow_with_the_number_of_pos(client, local_source):
    ids = await _setup()
    await _seed_masters()
    await _rules_and_links(ids)
    await _seed_pos(10_000, open_pos=3, lines_per_po=2)
    h = await _headers(client, "OPR")
    small, small_queries = await _list(client, h)
    await _seed_pos(20_000, open_pos=150, lines_per_po=12, closed_pos=50, closed_lines=5)
    large, large_queries = await _list(client, h)
    assert 1 <= small["counts"]["all"] <= 3 and large["counts"]["all"] > 100       # a PO of only "not tracked" codes is left out
    assert large_queries == small_queries, (small_queries, large_queries)
    # and the answer is right: linked suppliers' POs whose every code is decided are READY
    for row in large["pos"]:
        assert row["vendor_linked"] == (int(row["erp_vendor_code"][1:]) % 2 == 0)
        assert (row["readiness"] == "READY") == (row["vendor_linked"] and row["undecided_item_count"] == 0)


async def test_open_pos_with_lines_and_article_names_from_the_copy(local_source):
    await _seed_masters()
    await _seed_pos(10_000, open_pos=2, lines_per_po=3, closed_pos=1, closed_lines=2)
    async with SessionLocal() as s:          # one PO with an open and a closed line is still open, with both lines
        await s.execute(insert(ErpPoLineCopy), [{
            "company_code": "CKSPL", "po_line_key": "10000-x", "po_code": 10_000, "po_number": "SPO/10000", "po_date": date(2026, 9, 1),
            "line_status": "CLOSED", "supplier_code": "S0", "icode": _icode(1), "ordqty": 1, "rate": 1, "line_netamt": 1, "rcqty": 1,
            "cnlqty": 0, "hdr_netamt": 1, "hdr_chgamt": 0, "row_hash": "x", "first_seen_at": NOW, "last_seen_at": NOW, "is_present": True}])
        await s.commit()
    pos = {p.po_code: p for p in await local_source.open_pos_with_lines(["CKSPL"])}
    assert set(pos) == {10_000, 10_001} and len(pos[10_000].lines) == 4
    assert await local_source.open_pos_with_lines(["CKVPL"]) == [] and await local_source.open_pos_with_lines([]) == []
    names = await local_source.article_product_names(["ARTICLE 00", "ARTICLE 39", "NOPE"], "CKSPL")
    assert names["NOPE"] == set() and all(n.startswith("product") for n in names["ARTICLE 00"])


async def test_a_copy_the_size_of_the_real_one_is_listed_quickly(client, local_source, capsys):
    ids = await _setup()
    await _seed_masters()
    await _rules_and_links(ids)
    # about the real dev copy: 18,000 lines, 120 open POs (30 lines each) among 1,440 closed POs
    await _seed_pos(30_000, open_pos=120, lines_per_po=30, closed_pos=1440, closed_lines=10)
    h = await _headers(client, "OPR")
    started = time.perf_counter()
    body, queries = await _list(client, h)
    took = time.perf_counter() - started
    owner = await _headers(client)
    started = time.perf_counter()
    resp = await client.get("/api/erp/inbox", params={"company_id": ids["spl"]}, headers=owner)
    inbox_took = time.perf_counter() - started
    assert resp.status_code == 200 and body["counts"]["all"] == 120
    with capsys.disabled():
        print(f"\n[S3a-2 timing] 18,000-line copy, 120 open POs: list {took * 1000:.0f} ms ({queries} queries), "
              f"inbox {inbox_took * 1000:.0f} ms")
    assert took < 5 and inbox_took < 5
