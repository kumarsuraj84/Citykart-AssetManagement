"""S5: POST /api/assets/batch -- add N assets of one Item in one go, all or nothing, through the one asset
engine (procure_units -> apply_events), each with its own PROCURED event."""
import time
from datetime import date

import pytest
from sqlalchemy import func, select

import app.assets.batch as batch_module
from app.assets.models import Asset
from app.core.db import SessionLocal
from app.items.models import Item
from app.lifecycle.models import AssetEvent
from app.masters.models import CustomField
from app.numbering.models import CodeCounter
from tests.purchase_orders.s4_world import Statements, build_s4_world, login, serials


def body(w, item="camera", quantity=1, **over) -> dict:
    out = {"item_id": w[f"item_{item}"], "quantity": quantity, "received_into_asset_user_id": w["stock"],
           "cost_center_id": w["cc"]}
    out.update(over)
    return out


async def add(client, h, payload):
    return await client.post("/api/assets/batch", headers=h, json=payload)


async def assets_of(**where) -> list[Asset]:
    async with SessionLocal() as s:
        stmt = select(Asset).order_by(Asset.id)
        for k, v in where.items():
            stmt = stmt.where(getattr(Asset, k) == v)
        return list((await s.execute(stmt)).scalars().all())


async def counts() -> tuple[int, int, int]:
    async with SessionLocal() as s:
        return ((await s.execute(select(func.count()).select_from(Asset))).scalar_one(),
                (await s.execute(select(func.count()).select_from(AssetEvent))).scalar_one(),
                (await s.execute(select(func.count()).select_from(CodeCounter))).scalar_one())


async def test_serial_items_with_pasted_serials_become_assets_with_their_own_procured_event(client):
    w = await build_s4_world()
    h = await login(client, w, "op_it")
    typed = serials("CAM", 5)
    resp = await add(client, h, body(w, quantity=5, serial_numbers=typed, vendor_id=w["vendor"], po_number="PO-77",
                                     invoice_number="INV-9", invoice_date="2026-02-01", invoice_amount=5900,
                                     purchase_cost=1000, tax_percent=18))
    assert resp.status_code == 201, resp.text
    out = resp.json()
    assert out["assets_created"] == 5 and out["serial_pending"] == 0
    assert [a["serial_number"] for a in out["assets"]] == typed
    assert [a["asset_code"] for a in out["assets"]] == [f"S0/S0IT/{n:03d}" for n in range(1, 6)]
    assert out["label_asset_ids"] == [a["asset_id"] for a in out["assets"]]
    rows = await assets_of()
    assert len(rows) == 5
    for a in rows:
        assert (a.item_id, a.category_id, a.subcategory_id, a.company_id, a.asset_domain) == (
            w["item_camera"], w["it"], w["lap"], w["co"], "IT")
        assert (a.status, a.current_asset_user_id, a.vendor_id, a.po_number, a.invoice_number) == (
            "IN_STOCK", w["stock"], w["vendor"], "PO-77", "INV-9")
        assert a.purchase_date == date(2026, 2, 1) and float(a.total_cost) == 1180.0
        assert a.description == "Indoor Camera"
    async with SessionLocal() as s:
        events = (await s.execute(select(AssetEvent).order_by(AssetEvent.id))).scalars().all()
    assert len(events) == 5 and {e.event_type for e in events} == {"PROCURED"}
    assert {e.to_asset_user_name_snapshot for e in events} == {"Main Stock"} and {e.status_after for e in events} == {"IN_STOCK"}
    assert sorted(e.asset_id for e in events) == sorted(a.id for a in rows)


async def test_fifty_items_without_a_serial_are_saved_as_n_a(client):
    w = await build_s4_world()
    resp = await add(client, await login(client, w, "admin"), body(w, "gangbox", 50))
    assert resp.status_code == 201, resp.text
    assert resp.json()["assets_created"] == 50
    rows = await assets_of(item_id=w["item_gangbox"])
    assert len(rows) == 50 and {a.serial_number for a in rows} == {"N/A"} and not any(a.serial_pending for a in rows)


async def test_ten_serial_later_items_wait_on_the_serial_pending_list(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    resp = await add(client, h, body(w, "ap", 10))
    assert resp.status_code == 201, resp.text
    assert resp.json()["serial_pending"] == 10 and all(a["serial_number"] is None for a in resp.json()["assets"])
    listed = await client.get("/api/assets", headers=h, params={"serial_pending": "true"})
    assert listed.json()["total"] == 10


async def test_brand_warranty_description_and_company_come_from_the_item_and_cost_centre(client):
    w = await build_s4_world()
    async with SessionLocal() as s:
        item = await s.get(Item, w["item_camera"])
        item.default_brand_id, item.default_warranty_years = w["brand"], 3
        await s.commit()
    h = await login(client, w, "admin")
    resp = await add(client, h, body(w, quantity=1, serial_numbers=["D-1"], model="Latitude", invoice_date="2026-01-10"))
    assert resp.status_code == 201, resp.text
    a = (await assets_of())[0]
    assert (a.brand_id, a.warranty_years, a.description, a.company_id) == (w["brand"], 3, "Indoor Camera Dell Latitude", w["co"])
    assert a.warranty_upto == date(2029, 1, 9) and a.purchase_date == date(2026, 1, 10)
    # what is typed wins; a retired default brand is just not used
    async with SessionLocal() as s:
        item = await s.get(Item, w["item_camera"])
        item.default_brand_id = w["dead_brand"]
        await s.commit()
    resp = await add(client, h, body(w, quantity=1, serial_numbers=["D-2"], description="Lobby camera", warranty_years=0))
    a = (await assets_of(serial_number="D-2"))[0]
    assert (a.brand_id, a.warranty_years, a.description) == (None, 0, "Lobby camera")
    assert a.purchase_date == date.today()


async def test_the_serial_rule_can_be_chosen_for_the_batch(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    resp = await add(client, h, body(w, quantity=2, serial_mode="no_serial"))
    assert resp.status_code == 201, resp.text
    assert {a["serial_number"] for a in resp.json()["assets"]} == {"N/A"}
    bad = await add(client, h, body(w, quantity=1, serial_mode="MAYBE"))
    assert bad.status_code == 422 and bad.json()["detail"].startswith("Choose the serial rule")


async def test_serials_typed_twice_are_listed_with_their_units_and_nothing_is_written(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    resp = await add(client, h, body(w, quantity=4, serial_numbers=["A-1", "B-1", " a-1 ", "N/A", "", None]))
    # blanks are ignored -> 4 typed, one of them a repeat of the first (any case); N/A never repeats
    assert resp.status_code == 422, resp.text
    out = resp.json()
    assert out["problems"] == [{"unit_index": 3, "serial": "a-1", "message": "Serial number a-1 is typed more than once (units 1 and 3)."}]
    assert out["detail"] == "Unit 3: Serial number a-1 is typed more than once (units 1 and 3)."
    assert await counts() == (0, 0, 0)


async def test_serials_already_in_ckam_are_named_or_masked_outside_the_callers_scope(client):
    w = await build_s4_world()
    admin = await login(client, w, "admin")
    assert (await add(client, admin, body(w, quantity=1, serial_numbers=["OLD-1"]))).status_code == 201
    other = await add(client, admin, body(w, quantity=1, serial_numbers=["OLD-2"], cost_center_id=w["cc_b"],
                                          received_into_asset_user_id=w["stock_b"]))
    assert other.status_code == 201, other.text
    resp = await add(client, await login(client, w, "op_it"), body(w, quantity=2, serial_numbers=["old-1", "OLD-2"]))
    assert resp.status_code == 422
    messages = [p["message"] for p in resp.json()["problems"]]
    assert messages == ["Serial number old-1 is already used by asset S0/S0IT/001.",
                        "Serial number OLD-2 is already used by an asset outside your companies or work area."]
    assert [p["unit_index"] for p in resp.json()["problems"]] == [1, 2]


async def test_the_number_of_serials_must_match_and_no_serial_items_take_none(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    short = await add(client, h, body(w, quantity=3, serial_numbers=["S-1", "S-2"]))
    assert short.status_code == 422 and short.json()["detail"] == "3 serial numbers are needed, 2 were typed."
    typed_on_no_serial = await add(client, h, body(w, "gangbox", 2, serial_numbers=["X", "Y"]))
    assert typed_on_no_serial.status_code == 422
    assert typed_on_no_serial.json()["detail"].startswith("These assets are set to no serial number")
    assert await counts() == (0, 0, 0)


async def test_every_problem_is_listed_at_once(client):
    w = await build_s4_world()
    resp = await add(client, await login(client, w, "admin"), body(
        w, quantity=2, serial_numbers=["Z-1"], vendor_id=w["dead_vendor"], received_into_asset_user_id=w["dead_stock"],
        invoice_date="2026-01-01", po_date="2026-02-01", legacy_asset_code="OLD-77"))
    assert resp.status_code == 422
    messages = resp.json()["errors"]
    assert "The invoice date cannot be before the PO date (01-02-2026)." in messages
    assert "An old asset code can only be given when adding one asset." in messages
    assert "2 serial numbers are needed, 1 was typed." in messages
    assert "The vendor Closed Vendor is no longer active; choose another." in messages
    assert resp.json()["detail"].startswith("Nothing was added: ")


async def test_a_late_failure_rolls_everything_back_and_leaves_no_code_gap(client, monkeypatch):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    real = batch_module.procure_units

    async def written_then_failing(*args, **kwargs):
        await real(*args, **kwargs)
        raise ValueError("Something went wrong after writing.")
    monkeypatch.setattr(batch_module, "procure_units", written_then_failing)
    resp = await add(client, h, body(w, "gangbox", 3))
    assert resp.status_code == 422 and resp.json()["detail"] == "Something went wrong after writing."
    assert await counts() == (0, 0, 0)
    monkeypatch.setattr(batch_module, "procure_units", real)
    again = await add(client, h, body(w, "gangbox", 3))
    assert [a["asset_code"] for a in again.json()["assets"]] == ["S0/S0IT/001", "S0/S0IT/002", "S0/S0IT/003"]


async def test_work_area_company_scope_and_roles(client):
    w = await build_s4_world()
    other_area = await add(client, await login(client, w, "op_it"), body(w, "chair", 1))
    assert other_area.status_code == 403 and "Non-IT work" in other_area.json()["detail"]
    other_company = await add(client, await login(client, w, "op_it"), body(
        w, "gangbox", 1, cost_center_id=w["cc_b"], received_into_asset_user_id=w["stock_b"]))
    assert other_company.status_code == 403 and other_company.json()["detail"].startswith("You can only add assets for your own companies")
    viewer = await add(client, await login(client, w, "viewer_it"), body(w, "gangbox", 1))
    assert viewer.status_code == 403
    nonit = await add(client, await login(client, w, "op_nonit"), body(w, "chair", 2))
    assert nonit.status_code == 201
    assert await counts() == (2, 2, 1)


async def test_inactive_and_missing_records_are_refused_in_words(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    async with SessionLocal() as s:
        (await s.get(Item, w["item_gangbox"])).is_active = False
        await s.commit()
    gone = await add(client, h, body(w, "gangbox", 1))
    assert gone.status_code == 422 and gone.json()["detail"] == "The Item Gang Box is no longer active; choose another."
    nope = await add(client, h, {**body(w, "camera", 1), "item_id": 999999})
    assert nope.json()["detail"] == "The Item you chose does not exist."
    cc = await add(client, h, body(w, "ap", 1, cost_center_id=w["dead_cc"]))
    assert cc.json()["detail"] == "The cost centre Closed office is no longer active; choose another."
    place = await add(client, h, body(w, "ap", 1, received_into_asset_user_id=w["dead_stock"]))
    assert place.json()["detail"] == "Closed Stock is no longer active, so assets cannot be received there."
    mismatch = await add(client, h, body(w, "ap", 1, company_id=w["co_b"]))
    assert mismatch.json()["detail"] == "The cost centre must belong to the company you chose."
    wrong_place = await add(client, h, body(w, "ap", 1, received_into_asset_user_id=w["stock_b"]))
    assert wrong_place.json()["detail"] == "The place the asset is received into must belong to the same company as the asset."
    future = await add(client, h, body(w, "ap", 1, invoice_date="2999-01-01"))
    assert future.json()["detail"] == "Invoice date cannot be in the future."
    assert await counts() == (0, 0, 0)


async def test_required_extra_fields_per_batch_and_per_unit(client):
    w = await build_s4_world()
    async with SessionLocal() as s:
        s.add(CustomField(field_key="warranty_card", label="Warranty card number", field_type="text", is_required=True))
        s.add(CustomField(field_key="ram_gb", label="RAM (GB)", field_type="number"))
        await s.commit()
    h = await login(client, w, "admin")
    missing = await add(client, h, body(w, "gangbox", 3))
    assert missing.status_code == 422
    assert missing.json()["problems"] == [{"message": "Warranty card number is required."}]       # once, not 3 times
    partly = await add(client, h, body(w, "gangbox", 3, unit_custom_fields=[{"warranty_card": "W1"}, None, {"ram_gb": "x"}]))
    assert {(p.get("unit_index"), p["message"]) for p in partly.json()["problems"]} == {
        (2, "Warranty card number is required."), (3, "Warranty card number is required."), (3, "RAM (GB) must be a number.")}
    too_many = await add(client, h, body(w, "gangbox", 1, custom_fields={"warranty_card": "W"}, unit_custom_fields=[{}, {}]))
    assert "Extra-field values were given for 2 units, but 1 is being added." in too_many.json()["errors"]
    ok = await add(client, h, body(w, "gangbox", 2, custom_fields={"warranty_card": "ALL"},
                                   unit_custom_fields=[None, {"warranty_card": "W2", "ram_gb": 8}]))
    assert ok.status_code == 201, ok.text
    rows = await assets_of(item_id=w["item_gangbox"])
    assert [a.custom_fields for a in rows] == [{"warranty_card": "ALL"}, {"warranty_card": "W2", "ram_gb": 8}]


async def test_one_asset_by_batch_equals_one_asset_by_add_asset(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    common = {"cost_center_id": w["cc"], "vendor_id": w["vendor"], "brand_id": w["brand"], "model": "M1",
              "po_number": "PO-EQ", "po_date": "2026-01-01", "invoice_number": "INV-EQ", "invoice_date": "2026-01-15",
              "invoice_amount": 1180, "purchase_cost": 1000, "tax_percent": 18, "warranty_years": 2,
              "description": "Camera at gate", "barcode": "BC-1"}
    single = await client.post("/api/assets", headers=h, json={
        **common, "company_id": w["co"], "item_id": w["item_camera"], "serial_number": "EQ-1",
        "initial_asset_user_id": w["employee"]})
    assert single.status_code == 201, single.text
    batched = await add(client, h, {**common, "item_id": w["item_camera"], "quantity": 1, "serial_numbers": ["EQ-2"],
                                    "received_into_asset_user_id": w["employee"]})
    assert batched.status_code == 201, batched.text
    one, two = await assets_of()
    skip = {"id", "asset_code", "serial_number", "created_at", "updated_at"}
    columns = [c.key for c in Asset.__table__.columns if c.key not in skip]
    assert {c: getattr(one, c) for c in columns} == {c: getattr(two, c) for c in columns}
    assert one.status == "ALLOTTED" and one.current_asset_user_id == w["employee"]      # straight to a person, through the ledger
    async with SessionLocal() as s:
        events = (await s.execute(select(AssetEvent).order_by(AssetEvent.id))).scalars().all()
    fields = ("event_type", "status_after", "to_asset_user_id", "to_asset_user_name_snapshot", "event_date", "recorded_by")
    assert [getattr(events[0], f) for f in fields] == [getattr(events[1], f) for f in fields]


async def test_blank_barcode_is_stored_as_nothing_and_limits_hold(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    resp = await add(client, h, body(w, "gangbox", 1, barcode="   "))
    assert resp.status_code == 201 and (await assets_of())[0].barcode is None
    assert (await add(client, h, body(w, "gangbox", 0))).status_code == 422
    too_many = await add(client, h, body(w, "gangbox", 1001))
    assert too_many.status_code == 422 and "Quantity must be at most 1,000." in too_many.json()["detail"]


@pytest.mark.parametrize("quantity", [1, 50, 1000])
async def test_the_work_per_batch_does_not_grow_with_its_size(client, quantity):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    with Statements() as st:
        started = time.perf_counter()
        resp = await add(client, h, body(w, "gangbox", quantity))
        elapsed = time.perf_counter() - started
    assert resp.status_code == 201, resp.text
    assert resp.json()["assets_created"] == quantity
    print(f"\n[S5 batch add] {quantity} units: {st.count} statements, {elapsed * 1000:.0f} ms")
    assert st.count <= 30 and elapsed < 30


async def test_serial_items_cost_the_same_number_of_statements_for_1_and_100(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    with Statements() as one:
        assert (await add(client, h, body(w, quantity=1, serial_numbers=["P-0"]))).status_code == 201
    with Statements() as hundred:
        assert (await add(client, h, body(w, quantity=100, serial_numbers=serials("P", 100)))).status_code == 201
    assert hundred.count <= one.count + 2
