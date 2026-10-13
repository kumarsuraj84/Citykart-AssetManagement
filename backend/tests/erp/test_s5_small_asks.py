"""S5: the small additive asks of the screens -- with-lines `problems`, ERP inbox counts, optional barcode on
ERP create, a suggested vendor on the ERP PO list, a paged ERP supplier list, an Items work-area filter, the
stock-room `created` flag, companies in capabilities, and categories / sub-categories without a typed code."""
from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.items.models import Item
from app.purchase_orders.models import PendingAsset, PurchaseOrder
from tests.erp.s3a2_world import PAN, add_vendor, bs_po, build_s3a2_world, create_body
from tests.erp.test_erp_api import _headers, desktop_po, erp, line  # noqa: F401  (erp is a fixture)
from tests.erp.test_s3a2_inbox import site
from tests.purchase_orders.s4_world import build_s4_world, login


# ---------------------------------------------------------------- (a) with-lines problems

def po_body(w, lines, sets=None, number="PO-S5"):
    return {"company_id": w["co"], "po_number": number, "po_date": "2026-01-01", "vendor_id": w["vendor"],
            "cost_center_id": w["cc"], "lines": lines, "sets": sets or []}


def line_of(w, item, quantity=1):
    return {"item_id": w[f"item_{item}"] if isinstance(item, str) else item, "quantity": quantity, "purchase_cost": 100}


async def po_count() -> int:
    async with SessionLocal() as s:
        return (await s.execute(select(func.count()).select_from(PurchaseOrder))).scalar_one()


async def test_with_lines_lists_every_bad_line_and_set_and_creates_nothing(client):
    w = await build_s4_world()
    async with SessionLocal() as s:
        (await s.get(Item, w["item_ap"])).is_active = False
        await s.commit()
    h = await login(client, w, "admin")
    resp = await client.post("/api/purchase-orders/with-lines", headers=h, json=po_body(
        w, [line_of(w, "camera"), line_of(w, "ap"), line_of(w, "gangbox"), line_of(w, 999999)],
        sets=[{"bundle_id": 999999, "quantity": 1, "price_per_set": 100}]))
    assert resp.status_code == 422, resp.text
    out = resp.json()
    assert out["problems"] == [
        {"line_index": 2, "message": "The Item Access Point is no longer active; choose another."},
        {"line_index": 4, "message": "The Item you chose does not exist."},
        {"set_index": 1, "message": "The set you chose does not exist or is no longer active."},
    ]
    assert out["detail"] == "Nothing was created: 3 problems need fixing. Line 2: The Item Access Point is no longer active; choose another."
    assert out["errors"][2] == "Set 1: The set you chose does not exist or is no longer active."
    assert await po_count() == 0


async def test_with_lines_one_problem_keeps_its_old_sentence_and_header_problems_have_no_position(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    one = await client.post("/api/purchase-orders/with-lines", headers=h, json=po_body(w, [line_of(w, "camera"), line_of(w, 999999)]))
    assert one.json()["detail"] == "Line 2: The Item you chose does not exist."
    assert one.json()["problems"] == [{"line_index": 2, "message": "The Item you chose does not exist."}]
    ok = await client.post("/api/purchase-orders/with-lines", headers=h, json=po_body(w, [line_of(w, "camera", 2)]))
    assert ok.status_code == 201 and ok.json()["lines_created"] == 1 and ok.json()["units_created"] == 2
    again = await client.post("/api/purchase-orders/with-lines", headers=h, json=po_body(w, [line_of(w, "camera")]))
    assert again.status_code == 422 and "problems" in again.json() and "line_index" not in again.json()["problems"][0]
    other_area = await client.post("/api/purchase-orders/with-lines", headers=await login(client, w, "op_it"),
                                   json=po_body(w, [line_of(w, "chair")], number="PO-S5-2"))
    assert other_area.status_code == 403 and other_area.json()["detail"].startswith("Line 1: ")
    assert await po_count() == 1


async def test_with_lines_a_bad_set_alone_is_named_by_its_set_number(client):
    w = await build_s4_world()
    resp = await client.post("/api/purchase-orders/with-lines", headers=await login(client, w, "admin"), json=po_body(
        w, [line_of(w, "camera")], sets=[{"bundle_id": 424242, "quantity": 1, "price_per_set": 10}]))
    assert resp.status_code == 422
    assert resp.json() == {"detail": "Set 1: The set you chose does not exist or is no longer active.",
                           "errors": ["Set 1: The set you chose does not exist or is no longer active."],
                           "problems": [{"set_index": 1, "message": "The set you chose does not exist or is no longer active."}]}
    assert await po_count() == 0


# ---------------------------------------------------------------- (b) ERP inbox counts

async def test_the_inbox_counts_are_the_inboxs_own_numbers(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[5001] = bs_po()
    erp.pos[5002] = bs_po(po_code=5002, supplier="BS1", name="BLUE STAR LIMITED")
    erp.pos[5003] = bs_po(po_code=5003, supplier="2264", name="JAGANNATH ENTERPRISES",
                          lines=[line(1, "CT500002", "6U RACK", 1, 5000)])
    async with SessionLocal() as s:
        s.add_all([site("LAM", site_code=1), site("LAD", site_code=2), site("UPC", "UPCOMING_STORE", site_code=3)])
        await s.commit()
    h = await _headers(client)
    full = (await client.get("/api/erp/inbox", headers=h)).json()["counts"]
    counts = await client.get("/api/erp/inbox/counts", headers=h)
    assert counts.status_code == 200, counts.text
    assert counts.json() == {"items": full["items"], "vendors": full["vendors"], "stores": full["stores"]}
    assert counts.json()["vendors"] == 2 and counts.json()["stores"] == 2
    one = await client.get("/api/erp/inbox/counts", headers=h, params={"company_id": ids["vpl"]})
    assert one.json() == {"items": 0, "vendors": 0, "stores": 0}
    assert (await client.get("/api/erp/inbox/counts", headers=await _headers(client, "ADM"))).status_code == 403
    assert (await client.get("/api/erp/inbox/counts", headers=h, params={"company_id": 99999})).status_code == 404


# ---------------------------------------------------------------- (c) ERP create without a barcode

async def test_erp_create_takes_lines_without_a_barcode(client, erp):
    ids = await build_s3a2_world(erp)
    erp.pos[7001] = desktop_po(po_code=7001, po_number="SPO/7001", lines=[line(1, "CT500001", "48 PORT SWITCH", 2, 9000)])
    h = await _headers(client)
    for code in (7001, 1133610106):           # a plain line, and a Desktop set (one line per part)
        draft = (await client.get(f"/api/erp/pos/{code}/draft", headers=h)).json()
        body = create_body(draft, ids)
        body["lines"][0]["barcode"] = "  " if code == 7001 else None
        resp = await client.post("/api/erp/pos/create", headers=h, json=body)
        assert resp.status_code == 201, resp.text
        async with SessionLocal() as s:
            barcodes = set((await s.execute(select(PendingAsset.barcode).where(
                PendingAsset.purchase_order_id == resp.json()["po_id"]))).scalars().all())
        assert barcodes == {None}
    no_key = (await client.get("/api/erp/pos", headers=h)).json()
    assert all(p["po_code"] not in (7001, 1133610106) for p in no_key)


# ---------------------------------------------------------------- (d) suggested vendor on the ERP PO list

async def test_an_unmatched_supplier_row_carries_the_strongest_suggestion(client, erp):
    await build_s3a2_world(erp)
    erp.pos[5001] = bs_po()
    by_gstin = await add_vendor("Blue Star MP Office", gstin=f"23{PAN}1Z0")
    await add_vendor("Blue Star")
    rows = {p["po_code"]: p for p in (await client.get("/api/erp/pos", headers=await _headers(client))).json()}
    assert rows[5001]["suggested_vendor"] == {"vendor_id": by_gstin, "name": "Blue Star MP Office", "reason": "GSTIN",
                                              "reason_label": "same GSTIN"}
    assert rows[1133610106]["suggested_vendor"] is None                     # linked already
    erp.pos[5004] = bs_po(po_code=5004, supplier="2264", name="JAGANNATH ENTERPRISES")
    rows = {p["po_code"]: p for p in (await client.get("/api/erp/pos", headers=await _headers(client, "OPR"))).json()}
    assert rows[5004]["suggested_vendor"] is None and rows[5004]["vendor_linked"] is False


# ---------------------------------------------------------------- (e) the ERP supplier list in pages

async def test_the_erp_supplier_list_pages_and_searches_but_keeps_its_old_answer(client, erp):
    ids = await build_s3a2_world(erp)
    h = await _headers(client)
    full = await client.get("/api/erp/vendors", headers=h, params={"company_id": ids["spl"]})
    assert full.status_code == 200 and len(full.json()) == 6 and full.headers["X-Total-Count"] == "6"
    page = await client.get("/api/erp/vendors", headers=h, params={"company_id": ids["spl"], "limit": 2, "offset": 1})
    assert page.json() == full.json()[1:3] and page.headers["X-Total-Count"] == "6"
    blue = await client.get("/api/erp/vendors", headers=h, params={"company_id": ids["spl"], "q": "blue star"})
    assert {r["erp_code"] for r in blue.json()} == {"BS1", "BS2", "BS3", "BS4"} and blue.headers["X-Total-Count"] == "4"
    by_gstin = await client.get("/api/erp/vendors", headers=h, params={"company_id": ids["spl"], "q": "07AAAAA"})
    assert [r["erp_code"] for r in by_gstin.json()] == ["11338"]
    assert (await client.get("/api/erp/vendors", headers=h, params={"company_id": ids["spl"], "limit": 0})).status_code == 422


# ---------------------------------------------------------------- (f) Items by work area

async def test_items_can_be_listed_for_one_work_area_or_the_callers_own(client):
    w = await build_s4_world()
    op = await login(client, w, "op_it")
    names = lambda resp: sorted(i["name"] for i in resp.json())          # noqa: E731
    assert names(await client.get("/api/items", headers=op)) == ["Access Point", "Gang Box", "Indoor Camera", "Office Chair"]
    assert names(await client.get("/api/items", headers=op, params={"work_area": "mine"})) == ["Access Point", "Gang Box", "Indoor Camera"]
    assert names(await client.get("/api/items", headers=op, params={"work_area": "non-it"})) == ["Office Chair"]
    both = await login(client, w, "admin")
    assert len((await client.get("/api/items", headers=both, params={"work_area": "MINE"})).json()) == 4
    bad = await client.get("/api/items", headers=op, params={"work_area": "HR"})
    assert bad.status_code == 422 and bad.json()["detail"] == "Choose a work area: IT, Non-IT or mine."


# ---------------------------------------------------------------- (g) stock room `created`, (h) companies

async def test_a_stock_room_answer_says_whether_it_was_created(client):
    w = await build_s4_world()
    h = await login(client, w, "op_it")
    first = await client.post("/api/stock-rooms", headers=h, json={"name": "Back Room", "company_id": w["co"], "location_id": w["loc"]})
    again = await client.post("/api/stock-rooms", headers=h, json={"name": "back room", "company_id": w["co"], "location_id": w["loc"]})
    assert (first.status_code, first.json()["created"]) == (201, True)
    assert (again.status_code, again.json()["created"], again.json()["id"]) == (200, False, first.json()["id"])


async def test_capabilities_name_the_companies(client):
    w = await build_s4_world()
    op = (await client.get("/api/auth/capabilities", headers=await login(client, w, "op_it"))).json()
    assert op["companies"] == [{"id": w["co"], "code": "S0A", "name": "S0 Company A"}] and op["company_ids"] == [w["co"]]
    owner = (await client.get("/api/auth/capabilities", headers=await login(client, w, "owner"))).json()
    assert [c["code"] for c in owner["companies"]] == ["S0A", "S0B"]
    viewer = (await client.get("/api/auth/capabilities", headers=await login(client, w, "viewer_it"))).json()
    assert viewer["companies"] == [{"id": w["co"], "code": "S0A", "name": "S0 Company A"}]


# ---------------------------------------------------------------- (i) category / sub-category without a code

async def test_categories_and_sub_categories_get_a_code_from_their_name(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    first = await client.post("/api/masters/categories", headers=h, json={"name": "Electrical Fittings", "asset_domain": "NON_IT"})
    assert first.status_code == 201, first.text
    assert first.json()["code"] == "ELECTRICALFITTINGS"
    second = await client.post("/api/masters/categories", headers=h, json={"name": "Electrical fittings!", "asset_domain": "NON_IT", "code": None})
    assert second.json()["code"] == "ELECTRICALFITTINGS2"
    sub = await client.post("/api/masters/subcategories", headers=h, json={"category_id": first.json()["id"], "name": "Wires"})
    assert sub.status_code == 201 and sub.json()["code"] == "WIRES"
    sub_other = await client.post("/api/masters/subcategories", headers=h, json={"category_id": second.json()["id"], "name": "Wires"})
    assert sub_other.json()["code"] == "WIRES"                                 # unique inside its own category
    blank = await client.post("/api/masters/categories", headers=h, json={"name": "X", "asset_domain": "IT", "code": " "})
    assert blank.status_code == 422 and blank.json()["detail"] == "Code cannot be blank."
    typed = await client.post("/api/masters/categories", headers=h, json={"name": "Lights", "asset_domain": "NON_IT", "code": "LGT"})
    assert typed.json()["code"] == "LGT"
    it_admin = await client.post("/api/masters/categories", headers=await login(client, w, "admin_it"),
                                 json={"name": "Printers", "asset_domain": "NON_IT"})
    assert it_admin.status_code == 403                                         # the work-area rule still comes first
