"""S3a-2: Pick from ERP lists the open POs of EVERY supplier of the caller's companies, each READY or
NEEDS_INPUT with its problems in plain words, filterable, with how current the ERP data is."""
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from app.core.db import SessionLocal
from app.erp.mirror_models import ErpSyncRun
from app.items.models import ItemMap
from tests.erp.s3a2_world import BS_MP, bs_po, build_s3a2_world
from tests.erp.test_erp_api import _headers, desktop_po, erp, line  # noqa: F401  (erp is a fixture)

READY_PO = "SPO/012994/26-27"


async def rows(client, who="OPR", **params):
    resp = await client.get("/api/erp/pos", params=params, headers=await _headers(client, who))
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_a_po_of_an_unmatched_supplier_is_listed_with_what_it_needs(client, erp):
    await build_s3a2_world(erp)
    erp.pos[5001] = bs_po()
    by = {r["po_number"]: r for r in await rows(client)}
    assert set(by) == {READY_PO, "SPO/BS/5001"}
    bs = by["SPO/BS/5001"]
    assert (bs["vendor_id"], bs["vendor_name"], bs["vendor_linked"]) == (None, "BLUE STAR LTD (MP)", False)
    assert (bs["erp_vendor_code"], bs["erp_vendor_name"]) == (BS_MP, "BLUE STAR LTD (MP)")
    assert bs["readiness"] == "NEEDS_INPUT" and bs["undecided_item_count"] == 1
    assert bs["problems"] == [{"kind": "VENDOR_UNMATCHED", "message": "Vendor needs matching."},
                              {"kind": "ITEMS_UNDECIDED", "count": 1, "message": "1 item needs a decision."}]
    ready = by[READY_PO]
    assert (ready["readiness"], ready["problems"], ready["undecided_item_count"]) == ("READY", [], 0)
    # the existing fields are all still there
    assert {"po_code", "po_date", "company_id", "company_code", "delivery_location", "line_count", "net_amount",
            "tracked_lines", "untracked_lines"} <= set(ready)


async def test_undecided_items_are_counted_per_code_and_not_tracked_lines_are_kept_apart(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[5001] = bs_po(lines=[line(1, "CT500001", "48 PORT SWITCH", 2, 9000), line(2, "CT500001", "48 PORT SWITCH", 1, 9000),
                                 line(3, "CT500002", "6U RACK", 4, 500), line(4, "CT324973", "DELL DESKTOP", 1, 20000),
                                 line(5, "CT777", "UNKNOWN TO THE MASTER", 1, 100), line(6, "CT999001", "LENOVO", 3, 100, cancelled=3)])
    async with SessionLocal() as s:
        s.add(ItemMap(match_type="CODE", erp_item_code="CT500002", not_tracked=True, company_id=ids["spl"]))
        await s.commit()
    [bs] = [r for r in await rows(client) if r["po_code"] == 5001]
    # CT500001 (twice) and CT777 need a decision; the rack is not tracked; the cancelled line does not count
    assert (bs["undecided_item_count"], bs["tracked_line_count"], bs["untracked_line_count"]) == (2, 4, 1)
    assert (bs["tracked_lines"], bs["untracked_lines"]) == (4, 1)
    assert bs["problems"][1]["message"] == "2 items need a decision."


async def test_a_po_made_only_of_untracked_things_still_stays_out(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[5001] = bs_po(lines=[line(1, "CT500002", "6U RACK", 4, 500)])
    async with SessionLocal() as s:
        s.add(ItemMap(match_type="ARTICLE", article_key="FA_IT_OTHERS", not_tracked=True, company_id=ids["spl"]))
        await s.commit()
    assert [r["po_number"] for r in await rows(client)] == [READY_PO]


async def test_readiness_search_and_company_filters(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[5001] = bs_po()
    erp.pos[5002] = bs_po(po_code=5002, supplier="77", name="BLUE STAR LTD", company="CKVPL")
    assert [r["po_number"] for r in await rows(client, "OWN", readiness="ready")] == [READY_PO]
    assert {r["po_number"] for r in await rows(client, "OWN", readiness="NEEDS_INPUT")} == {"SPO/BS/5001", "SPO/BS/5002"}
    assert {r["po_number"] for r in await rows(client, "OWN", q="blue star")} == {"SPO/BS/5001", "SPO/BS/5002"}
    assert [r["po_number"] for r in await rows(client, "OWN", q="vansh")] == [READY_PO]      # the CKAM vendor's name too
    assert [r["po_number"] for r in await rows(client, "OWN", q="012994")] == [READY_PO]
    assert await rows(client, "OWN", q="%") == [] and await rows(client, "OWN", q="_") == []  # literal, not wildcards
    assert [r["po_number"] for r in await rows(client, "OWN", company_id=ids["vpl"])] == ["SPO/BS/5002"]
    bad = await client.get("/api/erp/pos", params={"readiness": "maybe"}, headers=await _headers(client))
    assert bad.status_code == 422 and bad.json()["detail"] == "Choose ready or needs input."


async def test_each_login_sees_only_its_own_companies_pos(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[5002] = bs_po(po_code=5002, supplier="77", name="BLUE STAR LTD", company="CKVPL")
    assert [r["po_number"] for r in await rows(client, "OPR")] == [READY_PO]
    assert [r["po_number"] for r in await rows(client, "OPV")] == ["SPO/BS/5002"]
    assert await rows(client, "OPV", company_id=ids["spl"]) == []                        # another company: nothing
    assert (await client.get("/api/erp/pos", headers=await _headers(client, "VWR"))).status_code == 403


async def test_the_envelope_carries_counts_and_freshness(client, erp):
    await build_s3a2_world(erp)
    erp.pos[5001] = bs_po()
    resp = await client.get("/api/erp/pos", params={"envelope": "true", "readiness": "READY"}, headers=await _headers(client, "OPR"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [p["po_number"] for p in body["pos"]] == [READY_PO]
    assert body["counts"] == {"all": 2, "ready": 1, "needs_input": 1, "other_suppliers": 1}            # counted before the readiness filter
    f = body["freshness"]
    assert (f["available"], f["refresh_failed"], f["message"], f["data_as_of"], f["copied"]) == (True, False, None, None, False)


async def test_only_linked_leaves_out_pos_of_suppliers_not_linked_to_a_vendor_and_counts_them(client, erp):
    """The screen's default: only the POs of vendors that were added / linked; the others are one click away,
    and their number is in `counts.other_suppliers`. Without the option nothing is left out (as before)."""
    await build_s3a2_world(erp)
    erp.pos[5001] = bs_po()                                    # supplier BLUE STAR is not linked to any vendor
    both = await client.get("/api/erp/pos", params={"envelope": "true"}, headers=await _headers(client, "OPR"))
    assert {p["po_number"] for p in both.json()["pos"]} == {READY_PO, "SPO/BS/5001"}
    only = await client.get("/api/erp/pos", params={"envelope": "true", "only_linked": "true"}, headers=await _headers(client, "OPR"))
    assert only.status_code == 200, only.text
    body = only.json()
    assert [p["po_number"] for p in body["pos"]] == [READY_PO] and all(p["vendor_linked"] for p in body["pos"])
    assert body["counts"] == {"all": 1, "ready": 1, "needs_input": 0, "other_suppliers": 1}      # the counts follow the list


async def test_only_linked_works_with_the_filters_and_with_the_bare_list(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[5001] = bs_po()
    erp.pos[5002] = bs_po(po_code=5002, supplier="77", name="BLUE STAR LTD", company="CKVPL")
    # a search for the unlinked supplier finds nothing in the linked-only list, but says how many it left out
    body = (await client.get("/api/erp/pos", params={"envelope": "true", "only_linked": "true", "q": "blue star"}, headers=await _headers(client, "OWN"))).json()
    assert body["pos"] == [] and body["counts"]["other_suppliers"] == 2
    # readiness filter and company filter still apply on top
    assert [r["po_number"] for r in await rows(client, "OWN", only_linked="true", readiness="ready")] == [READY_PO]
    assert await rows(client, "OWN", only_linked="true", readiness="needs_input") == []
    assert await rows(client, "OWN", only_linked="true", company_id=ids["vpl"]) == []
    # the bare list (no envelope) is filtered too, and the default is unchanged
    assert [r["po_number"] for r in await rows(client, "OWN", only_linked="true")] == [READY_PO]
    assert {r["po_number"] for r in await rows(client, "OWN")} == {READY_PO, "SPO/BS/5001", "SPO/BS/5002"}


def _closed_po(po_code=5101, po_date=None, **over):
    """A PO the ERP already CLOSED (goods received there) of the linked supplier, one received desktop line."""
    base = dict(po_code=po_code, po_number=f"GPO/{po_code}/26-27", status="CLOSED",
                po_date=po_date or date.today() - timedelta(days=120),
                lines=[line(1, "CT324973", "DELL DESKTOP", 1, 20000, received=1)])
    base.update(over)
    return desktop_po(**base)


async def test_a_po_the_erp_closed_is_hidden_until_closed_pos_are_asked_for(client, erp):
    await build_s3a2_world(erp)
    erp.pos[5101] = _closed_po()
    assert [r["po_number"] for r in await rows(client)] == [READY_PO]                  # the default is unchanged
    body = (await client.get("/api/erp/pos", params={"envelope": "true", "include_closed": "true"},
                             headers=await _headers(client, "OPR"))).json()
    by = {r["po_number"]: r for r in body["pos"]}
    assert set(by) == {READY_PO, "GPO/5101/26-27"}
    assert (by["GPO/5101/26-27"]["erp_status"], by["GPO/5101/26-27"]["assets_already"]) == ("CLOSED", 0)
    assert by["GPO/5101/26-27"]["readiness"] == "READY"                                 # same readiness rules as any PO
    assert by[READY_PO]["erp_status"] == "OPEN"
    assert body["counts"] == {"all": 2, "ready": 2, "needs_input": 0, "other_suppliers": 0, "closed": 1}
    # no switch, no "closed" count: the answer keeps its old shape
    off = (await client.get("/api/erp/pos", params={"envelope": "true"}, headers=await _headers(client, "OPR"))).json()
    assert "closed" not in off["counts"]


async def test_closed_pos_follow_the_window_the_company_and_the_cancelled_lines(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[5101] = _closed_po()                                                         # 120 days old
    erp.pos[5102] = _closed_po(5102, date.today() - timedelta(days=400))                 # older than any default
    erp.pos[5103] = _closed_po(5103, supplier_code="77", supplier_name="BLUE STAR LTD", company_code="CKVPL")
    erp.pos[5104] = _closed_po(5104, lines=[line(1, "CT324973", "DELL DESKTOP", 1, 20000, cancelled=1)])   # orders nothing
    h = await _headers(client, "OPR")

    async def closed(**params):
        r = await client.get("/api/erp/pos", params={"include_closed": "true", **params}, headers=h)
        assert r.status_code == 200, r.text
        return {p["po_number"] for p in r.json() if p["erp_status"] == "CLOSED"}
    assert await closed() == {"GPO/5101/26-27"}                                           # 180 days by default; CKVPL's is not this login's
    assert await closed(closed_days=60) == set()
    assert await closed(closed_days=500) == {"GPO/5101/26-27", "GPO/5102/26-27"}
    assert (await client.get("/api/erp/pos", params={"include_closed": "true", "closed_days": 0}, headers=h)).status_code == 422


async def test_a_closed_po_says_when_assets_already_carry_its_po_number_and_can_be_created(client, erp):
    from datetime import date as d
    from app.assets.models import Asset
    from app.asset_users.models import AssetUser
    from app.masters.models import AssetCategory, CostCenter
    from tests.erp.s3a2_world import create_body
    ids = await build_s3a2_world(erp)
    erp.pos[5101] = _closed_po()
    async with SessionLocal() as s:
        cat = (await s.execute(select(AssetCategory).where(AssetCategory.code == "COMP"))).scalar_one()
        cc = (await s.execute(select(CostCenter).where(CostCenter.company_id == ids["spl"]))).scalars().first()
        holder = (await s.execute(select(AssetUser).where(AssetUser.code == "OPR"))).scalar_one()
        for n in (1, 2):
            s.add(Asset(asset_code=f"OLD/{n}", company_id=ids["spl"], cost_center_id=cc.id, category_id=cat.id, description="Old desktop",
                        po_number="GPO/5101/26-27", purchase_date=d(2026, 7, 20), status="IN_STOCK", current_asset_user_id=holder.id,
                        status_since=d(2026, 7, 20), asset_domain="IT"))
        await s.commit()
    h = await _headers(client, "OPR")
    [row] = [r for r in await rows(client, include_closed="true") if r["po_number"] == "GPO/5101/26-27"]
    assert row["assets_already"] == 2
    draft = (await client.get("/api/erp/pos/5101/draft", headers=h)).json()
    assert draft["status"] == "CLOSED"
    assert any("closed in the ERP" in w for w in draft["warnings"])
    assert any(w.startswith("2 assets already carry the PO number GPO/5101/26-27") for w in draft["warnings"])
    # a closed PO is not refused: it becomes a CKAM PO like any other, and then leaves the picker
    assert (await client.post("/api/erp/pos/create", headers=h, json=create_body(draft, ids))).status_code == 201
    assert [r for r in await rows(client, include_closed="true") if r["po_number"] == "GPO/5101/26-27"] == []


async def test_a_failed_refresh_is_said_in_plain_words_with_the_time_of_the_data_in_use(client, erp):
    await build_s3a2_world(erp)
    async with SessionLocal() as s:
        s.add(ErpSyncRun(status="success", trigger="schedule", started_at=datetime(2026, 10, 13, 5, 50, tzinfo=timezone.utc),
                         finished_at=datetime(2026, 10, 13, 5, 51, tzinfo=timezone.utc),
                         source_stamp=datetime(2026, 10, 13, 5, 44, tzinfo=timezone.utc)))
        await s.flush()
        s.add(ErpSyncRun(status="failed", trigger="schedule", started_at=datetime(2026, 10, 13, 9, 0, tzinfo=timezone.utc),
                         finished_at=datetime(2026, 10, 13, 9, 0, 5, tzinfo=timezone.utc), message="The ERP database could not be reached (OSError)."))
        await s.commit()
    f = (await client.get("/api/erp/pos", params={"envelope": "true"}, headers=await _headers(client, "OPR"))).json()["freshness"]
    assert f["refresh_failed"] is True and f["data_as_of"].startswith("2026-10-13T05:44")
    assert f["message"] == "ERP data could not refresh. Using data from 13-10-2026 11:14 am."
    assert f["data_as_of_text"] == "13-10-2026 11:14 am"


async def test_an_unreadable_erp_never_blocks_the_enveloped_list(client, erp):
    await build_s3a2_world(erp)
    erp.down = "The ERP database could not be reached (OSError)."
    h = await _headers(client, "OPR")
    body = (await client.get("/api/erp/pos", params={"envelope": "true"}, headers=h)).json()
    assert body["pos"] == [] and body["freshness"]["available"] is False
    assert "could not be reached" in body["freshness"]["message"]
    assert (await client.get("/api/erp/pos", headers=h)).status_code == 503           # the bare list keeps its old answer


async def test_a_created_po_is_no_longer_offered(client, erp):
    from tests.erp.s3a2_world import create_body
    ids = await build_s3a2_world(erp)
    h = await _headers(client, "OPR")
    draft = (await client.get("/api/erp/pos/1133610106/draft", headers=h)).json()
    assert (await client.post("/api/erp/pos/create", headers=h, json=create_body(draft, ids))).status_code == 201
    assert await rows(client) == []


async def test_a_source_without_the_one_read_still_finds_every_suppliers_open_pos(erp):
    # an older ERP source (no open_pos_with_lines): every supplier the ERP lists, then their open POs
    from app.erp.readiness import open_erp_pos
    await build_s3a2_world(erp)
    erp.pos[5001] = bs_po()
    erp.pos[5003] = bs_po(po_code=5003, status="CLOSED")

    class OldSource:
        vendors, open_pos, pos_with_lines = erp.vendors, erp.open_pos, erp.pos_with_lines
    assert {p.po_code for p in await open_erp_pos(OldSource(), ["CKSPL"])} == {1133610106, 5001}
