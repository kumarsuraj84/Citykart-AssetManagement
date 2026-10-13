"""S4: POST /api/purchase-orders/{id}/receive -- one receipt by LINE: the common fields once, a quantity
per line (the oldest waiting units are taken), serials only where the line has them; the whole receipt
checked first (every problem listed, nothing written), then written in one transaction."""
from datetime import date, timedelta

import pytest
from sqlalchemy import func, select, update

from app.assets.models import Asset
from app.core.db import SessionLocal
from app.lifecycle.models import AssetEvent
from app.masters.models import CustomField
from app.numbering.models import CodeCounter
from app.purchase_orders.models import PendingAsset
from tests.purchase_orders.s4_world import build_s4_world, groups, login, make_po, receipt, receive, serials


async def _assets(po_number: str | None = None) -> list[Asset]:
    async with SessionLocal() as s:
        stmt = select(Asset).order_by(Asset.id)
        if po_number is not None:
            stmt = stmt.where(Asset.po_number == po_number)
        return list((await s.execute(stmt)).scalars().all())


async def _count(model) -> int:
    async with SessionLocal() as s:
        return (await s.execute(select(func.count()).select_from(model))).scalar_one()


async def _units(po_id: int) -> list[PendingAsset]:
    async with SessionLocal() as s:
        return list((await s.execute(
            select(PendingAsset).where(PendingAsset.purchase_order_id == po_id).order_by(PendingAsset.id)
        )).scalars().all())


# ---- happy paths ------------------------------------------------------------

async def test_one_serial_asset_gets_every_common_field_and_its_ledger_entry(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 1)])
    async with SessionLocal() as s:     # an ERP-made line carries the ERP item code
        await s.execute(update(PendingAsset).where(PendingAsset.purchase_order_id == po["id"]).values(erp_item_code="CT324973"))
        await s.commit()
    resp = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 1, "serial_numbers": ["CAM-1"]}],
                                                       invoice_number=" INV-77 ", invoice_amount=1180.5))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["assets_created"], body["serial_pending"], body["invoice_number"]) == (1, 0, "INV-77")
    [created] = body["assets"]
    assert (created["line_no"], created["serial_number"], created["asset_code"]) == (1, "CAM-1", "S0/S0IT/001")
    assert body["label_asset_ids"] == [created["asset_id"]]
    assert (body["po_status"], body["waiting_units"]) == ("RECEIVED", 0)

    [asset] = await _assets()
    assert asset.id == created["asset_id"]
    assert (asset.vendor_id, asset.po_number, asset.po_date) == (w["vendor"], "PO-S4", date(2026, 1, 1))
    assert (asset.invoice_number, asset.invoice_date, float(asset.invoice_amount)) == ("INV-77", date(2026, 2, 1), 1180.5)
    assert (asset.purchase_date, asset.cost_center_id, asset.company_id) == (date(2026, 2, 1), w["cc"], w["co"])
    assert (asset.asset_domain, asset.item_id, asset.erp_item_code) == ("IT", w["item_camera"], "CT324973")
    assert (asset.category_id, asset.subcategory_id, asset.description) == (w["it"], w["lap"], "Indoor Camera")
    assert (asset.status, asset.current_asset_user_id, asset.status_since) == ("IN_STOCK", w["stock"], date(2026, 2, 1))
    assert (float(asset.purchase_cost), float(asset.tax_amount), float(asset.total_cost)) == (1000.0, 180.0, 1180.0)
    assert (asset.serial_number, asset.serial_pending, asset.created_by) == ("CAM-1", False, w["admin"])

    async with SessionLocal() as s:
        [event] = (await s.execute(select(AssetEvent).where(AssetEvent.asset_id == asset.id))).scalars().all()
    assert (event.event_type, event.status_after, event.to_asset_user_id, event.from_asset_user_id) == (
        "PROCURED", "IN_STOCK", w["stock"], w["stock"])
    assert (event.to_asset_user_name_snapshot, event.from_asset_user_name_snapshot) == ("Main Stock", "Main Stock")
    assert (event.recorded_by, event.event_date.date()) == (w["admin"], date(2026, 2, 1))

    [unit] = await _units(po["id"])
    assert (unit.status, unit.delivered_asset_id, unit.serial_number, unit.invoice_number) == (
        "DELIVERED", asset.id, "CAM-1", "INV-77")
    assert (unit.initial_asset_user_id, unit.delivered_by) == (w["stock"], w["admin"])


async def test_ten_serial_units_take_the_serials_in_order_on_the_oldest_units(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 10)])
    typed = serials("CAM", 10)
    resp = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 10, "serial_numbers": typed}]))
    assert resp.status_code == 200, resp.text
    assert [a["serial_number"] for a in resp.json()["assets"]] == typed
    assert [a["asset_code"] for a in resp.json()["assets"]] == [f"S0/S0IT/{n:03d}" for n in range(1, 11)]
    units = await _units(po["id"])
    by_asset = {a.id: a for a in await _assets()}
    assert [by_asset[u.delivered_asset_id].serial_number for u in units] == typed     # oldest unit -> first serial


async def test_fifty_units_without_serials_are_received_as_n_a_in_one_receipt(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 50)])
    resp = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 50}]))
    assert resp.status_code == 200, resp.text
    assert resp.json()["assets_created"] == 50 and resp.json()["serial_pending"] == 0
    assets = await _assets()
    assert len(assets) == 50 and {a.serial_number for a in assets} == {"N/A"}
    assert not any(a.serial_pending for a in assets)
    assert len({a.asset_code for a in assets}) == 50


async def test_ten_serial_later_units_wait_on_serial_pending(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("ap", 10)])
    resp = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 10}]))
    assert resp.status_code == 200, resp.text
    assert resp.json()["serial_pending"] == 10
    assert all(a["serial_pending"] and a["serial_number"] is None for a in resp.json()["assets"])
    listed = await client.get("/api/assets?serial_pending=true&limit=50", headers=h)
    assert listed.json()["total"] == 10


async def test_a_hundred_unit_po_of_three_lines_is_received_in_one_go(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 30), ("gangbox", 50), ("ap", 20)])
    resp = await receive(client, h, po["id"], receipt(w, [
        {"line_no": 1, "quantity": 30, "serial_numbers": serials("CAM", 30)},
        {"line_no": 2, "quantity": 50},
        {"line_no": 3, "quantity": 20},
    ]))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert (body["assets_created"], body["serial_pending"], body["po_status"]) == (100, 20, "RECEIVED")
    assert [a["line_no"] for a in body["assets"]] == [1] * 30 + [2] * 50 + [3] * 20
    assert {g["waiting"] for g in (await groups(client, h, po["id"])).values()} == {0}
    assert await _count(Asset) == 100 and await _count(AssetEvent) == 100
    # no orphan: every received unit points at its own asset, and every asset came from exactly one unit
    units = await _units(po["id"])
    assert all(u.status == "DELIVERED" for u in units)
    assert len({u.delivered_asset_id for u in units}) == 100 == len({a.id for a in await _assets()})


async def test_each_line_may_override_its_serial_rule(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 2), ("gangbox", 2), ("ap", 2)])
    resp = await receive(client, h, po["id"], receipt(w, [
        {"line_no": 1, "quantity": 2, "serial_mode": "NO_SERIAL"},                       # a camera with no serial
        {"line_no": 2, "quantity": 2, "serial_mode": "has_serial", "serial_numbers": ["GB-1", "GB-2"]},
        {"line_no": 3, "quantity": 2, "serial_mode": "HAS_SERIAL", "serial_numbers": ["AP-1", "AP-2"]},
    ]))
    assert resp.status_code == 200, resp.text
    assert [a["serial_number"] for a in resp.json()["assets"]] == ["N/A", "N/A", "GB-1", "GB-2", "AP-1", "AP-2"]
    assert resp.json()["serial_pending"] == 0


async def test_receiving_part_of_a_line_leaves_the_rest_waiting(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 5)])
    first = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 2, "serial_numbers": ["A1", "A2"]}]))
    assert first.status_code == 200, first.text
    assert (first.json()["po_status"], first.json()["waiting_units"]) == ("PARTLY_RECEIVED", 3)
    line = (await groups(client, h, po["id"]))[1]
    assert (line["received"], line["waiting"], line["status"]) == (2, 3, "PARTLY_RECEIVED")
    units = await _units(po["id"])
    assert [u.status for u in units] == ["DELIVERED", "DELIVERED", "PENDING", "PENDING", "PENDING"]   # the oldest first
    second = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 3, "serial_numbers": ["A3", "A4", "A5"]}],
                                                         invoice_number="INV-2"))
    assert second.status_code == 200, second.text
    assert second.json()["po_status"] == "RECEIVED"
    line = (await groups(client, h, po["id"]))[1]
    assert (line["received"], line["waiting"], line["status"]) == (5, 0, "RECEIVED")
    assert {a.invoice_number for a in await _assets()} == {"INV-1", "INV-2"}


async def test_the_po_delivery_place_is_used_when_received_into_is_left_out(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 1)])
    body = receipt(w, [{"line_no": 1, "quantity": 1}])
    body.pop("received_into_asset_user_id")
    resp = await receive(client, h, po["id"], body)
    assert resp.status_code == 200, resp.text
    [asset] = await _assets()
    assert asset.current_asset_user_id == w["stock"]


async def test_another_stock_room_of_the_company_can_be_chosen(client):
    w = await build_s4_world()
    h = await login(client, w, "op_it")
    po = await make_po(client, await login(client, w, "admin"), w, [("gangbox", 2)])
    resp = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 2}], received_into_asset_user_id=w["stock2"]))
    assert resp.status_code == 200, resp.text
    assert {a.current_asset_user_id for a in await _assets()} == {w["stock2"]}
    assert {a.created_by for a in await _assets()} == {w["op_it"]}


# ---- serial problems ---------------------------------------------------------

async def test_a_serial_typed_twice_on_a_line_is_listed_with_its_line_unit_and_serial(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 3)])
    resp = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 3, "serial_numbers": ["S-1", "S-2", "S-1"]}]))
    assert resp.status_code == 422
    body = resp.json()
    assert body["problems"] == [{"line_no": 1, "unit_index": 3, "serial": "S-1",
                                 "message": "Serial number S-1 is typed more than once (on this line)."}]
    assert body["detail"] == "Line 1: Serial number S-1 is typed more than once (on this line)."
    assert body["errors"] == [body["detail"]]
    assert await _count(Asset) == 0


async def test_a_serial_typed_on_two_lines_in_another_letter_case_is_a_duplicate(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 1), ("gangbox", 1), ("ap", 1)])
    resp = await receive(client, h, po["id"], receipt(w, [
        {"line_no": 1, "quantity": 1, "serial_numbers": ["abc-9"]},
        {"line_no": 2, "quantity": 1},
        {"line_no": 3, "quantity": 1, "serial_mode": "HAS_SERIAL", "serial_numbers": ["  ABC-9 "]},
    ]))
    assert resp.status_code == 422
    assert resp.json()["problems"] == [{"line_no": 3, "unit_index": 1, "serial": "ABC-9",
                                        "message": "Serial number ABC-9 is typed more than once (on line 1 and line 3)."}]


async def test_a_serial_already_in_ckam_names_the_asset_only_when_the_caller_may_see_it(client):
    w = await build_s4_world()
    admin = await login(client, w, "admin")
    old = await make_po(client, admin, w, [("camera", 1), ("chair", 1)], number="OLD")
    assert (await receive(client, admin, old["id"], receipt(w, [
        {"line_no": 1, "quantity": 1, "serial_numbers": ["SN-IT"]},
        {"line_no": 2, "quantity": 1, "serial_mode": "HAS_SERIAL", "serial_numbers": ["SN-CHAIR"]},
    ]))).status_code == 200
    po = await make_po(client, admin, w, [("camera", 2)], number="NEW")
    body = receipt(w, [{"line_no": 1, "quantity": 2, "serial_numbers": ["sn-it", "SN-CHAIR"]}])
    seen_by_admin = (await receive(client, admin, po["id"], body)).json()["problems"]
    assert seen_by_admin == [
        {"line_no": 1, "unit_index": 1, "serial": "sn-it", "message": "Serial number sn-it is already used by asset S0/S0IT/001."},
        {"line_no": 1, "unit_index": 2, "serial": "SN-CHAIR", "message": "Serial number SN-CHAIR is already used by asset S0/S0NI/001."},
    ]
    seen_by_it = (await receive(client, await login(client, w, "op_it"), po["id"], body)).json()["problems"]
    assert seen_by_it[1]["message"] == "Serial number SN-CHAIR is already used by an asset outside your companies or work area."
    assert await _count(Asset) == 2


async def test_n_a_and_blank_entries_are_never_duplicates(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 3)])
    resp = await receive(client, h, po["id"], receipt(w, [
        {"line_no": 1, "quantity": 3, "serial_numbers": ["N/A", "", "n/a", "   ", "REAL-1"]}]))
    assert resp.status_code == 200, resp.text
    assert [a["serial_number"] for a in resp.json()["assets"]] == ["N/A", "n/a", "REAL-1"]


async def test_the_number_of_serials_must_match_the_quantity(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 5)])
    few = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 3, "serial_numbers": ["A", "", "B"]}]))
    assert few.status_code == 422
    assert few.json()["problems"] == [{"line_no": 1, "message": "3 serial numbers are needed, 2 were typed."}]
    many = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 1, "serial_numbers": ["A", "B"]}]))
    assert many.json()["problems"] == [{"line_no": 1, "message": "1 serial number is needed, 2 were typed."}]


@pytest.mark.parametrize("mode, words", [("NO_SERIAL", "no serial number"), ("SERIAL_LATER", "serial number later")])
async def test_serials_typed_on_a_line_without_serials_are_refused(client, mode, words):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 1)])
    resp = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 1, "serial_mode": mode, "serial_numbers": ["X"]}]))
    assert resp.status_code == 422
    assert resp.json()["problems"][0]["message"].startswith(f"This line is set to {words}, so leave its serial numbers empty")


async def test_an_unknown_serial_rule_is_refused_in_words(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 1)])
    resp = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 1, "serial_mode": "MAYBE"}]))
    assert resp.status_code == 422
    assert resp.json()["problems"] == [{"line_no": 1, "message": "Choose the serial rule: has a serial number, no serial number, or serial number later."}]


# ---- all or nothing ------------------------------------------------------------

async def test_a_refused_receipt_lists_every_problem_and_writes_nothing(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 2), ("gangbox", 3), ("ap", 1)])
    resp = await receive(client, h, po["id"], receipt(w, [
        {"line_no": 1, "quantity": 2, "serial_numbers": ["OK-1"]},          # one serial short
        {"line_no": 2, "quantity": 4},                                      # only 3 waiting
        {"line_no": 3, "quantity": 1},                                      # fine on its own
        {"line_no": 9, "quantity": 1},                                      # no such line
    ], invoice_number="  "))
    assert resp.status_code == 422
    body = resp.json()
    assert [(p["line_no"], p["message"]) for p in body["problems"]] == [
        (None, "Invoice number cannot be blank."),
        (1, "2 serial numbers are needed, 1 was typed."),
        (2, "Only 3 are still waiting, so 4 cannot be received."),
        (9, "This line was not found on this purchase order."),
    ]
    assert body["detail"] == "Nothing was received: 4 problems need fixing. Invoice number cannot be blank."
    assert body["errors"][1] == "Line 1: 2 serial numbers are needed, 1 was typed."
    assert await _count(Asset) == 0 and await _count(AssetEvent) == 0 and await _count(CodeCounter) == 0
    assert {u.status for u in await _units(po["id"])} == {"PENDING"}


async def test_an_unexpected_failure_while_writing_rolls_the_whole_receipt_back(client, monkeypatch):
    from app.assets import service as asset_service

    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("camera", 3), ("gangbox", 3)])
    real = asset_service.apply_events

    async def fail_after_writing(*args, **kwargs):
        await real(*args, **kwargs)          # the assets and their events are written ...
        raise RuntimeError("disk full")      # ... then something unexpected breaks

    monkeypatch.setattr(asset_service, "apply_events", fail_after_writing)
    with pytest.raises(RuntimeError):
        await receive(client, h, po["id"], receipt(w, [
            {"line_no": 1, "quantity": 3, "serial_numbers": serials("C", 3)}, {"line_no": 2, "quantity": 3}]))
    assert await _count(Asset) == 0 and await _count(AssetEvent) == 0 and await _count(CodeCounter) == 0
    assert {u.status for u in await _units(po["id"])} == {"PENDING"}
    monkeypatch.setattr(asset_service, "apply_events", real)
    ok = await receive(client, h, po["id"], receipt(w, [
        {"line_no": 1, "quantity": 3, "serial_numbers": serials("C", 3)}, {"line_no": 2, "quantity": 3}]))
    assert ok.status_code == 200, ok.text
    assert [a["asset_code"] for a in ok.json()["assets"]] == [f"S0/S0IT/{n:03d}" for n in range(1, 7)]   # no gap


# ---- custom (extra) fields ---------------------------------------------------------

async def _required_field(w, **over) -> None:
    async with SessionLocal() as s:
        s.add(CustomField(**{"field_key": "warranty_card", "label": "Warranty card number", "field_type": "text",
                             "is_required": True, **over}))
        await s.commit()


async def test_a_required_extra_field_left_out_is_asked_for_once_per_line(client):
    w = await build_s4_world()
    await _required_field(w)
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 3), ("ap", 2)])
    resp = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 3}, {"line_no": 2, "quantity": 2}]))
    assert resp.status_code == 422
    assert resp.json()["problems"] == [{"line_no": 1, "message": "Warranty card number is required."},
                                       {"line_no": 2, "message": "Warranty card number is required."}]
    assert await _count(Asset) == 0


async def test_a_required_extra_field_given_for_the_line_lands_on_every_unit(client):
    w = await build_s4_world()
    await _required_field(w)
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 3)])
    resp = await receive(client, h, po["id"], receipt(w, [
        {"line_no": 1, "quantity": 3, "custom_fields": {"warranty_card": "WC-ALL"},
         "unit_custom_fields": [None, {"warranty_card": "WC-2"}]}]))
    assert resp.status_code == 200, resp.text
    assert [a.custom_fields for a in await _assets()] == [
        {"warranty_card": "WC-ALL"}, {"warranty_card": "WC-2"}, {"warranty_card": "WC-ALL"}]


async def test_per_unit_extra_field_problems_name_the_unit(client):
    w = await build_s4_world()
    await _required_field(w)
    async with SessionLocal() as s:
        s.add(CustomField(field_key="ram_gb", label="RAM (GB)", field_type="number"))
        await s.commit()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 3)])
    resp = await receive(client, h, po["id"], receipt(w, [
        {"line_no": 1, "quantity": 3, "unit_custom_fields": [
            {"warranty_card": "W1", "ram_gb": 8}, {"warranty_card": "W2", "ram_gb": "eight"}, {"ram_gb": 4}]}]))
    assert resp.status_code == 422
    assert resp.json()["problems"] == [
        {"line_no": 1, "unit_index": 2, "message": "RAM (GB) must be a number."},
        {"line_no": 1, "unit_index": 3, "message": "Warranty card number is required."},
    ]


async def test_extra_field_values_for_more_units_than_received_or_unknown_fields_are_refused(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 3)])
    resp = await receive(client, h, po["id"], receipt(w, [
        {"line_no": 1, "quantity": 1, "custom_fields": {"nope": "x"}, "unit_custom_fields": [{}, {}]}]))
    assert resp.status_code == 422
    assert [p["message"] for p in resp.json()["problems"]] == [
        "Extra-field values were given for 2 units, but 1 is being received.",
        "The extra field nope is not used for this company.",
    ]


async def test_a_required_field_of_another_company_does_not_block(client):
    w = await build_s4_world()
    await _required_field(w, company_id=w["co_b"])
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 1)])
    assert (await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 1}]))).status_code == 200


# ---- common fields ----------------------------------------------------------------

@pytest.mark.parametrize("over, message", [
    ({"invoice_number": ""}, "Invoice number cannot be blank."),
    ({"invoice_number": None}, "Invoice number cannot be blank."),
    ({"invoice_amount": -1}, "Invoice amount cannot be negative."),
    ({"invoice_amount": None}, "Invoice amount is required."),
    ({"invoice_date": (date.today() + timedelta(days=2)).isoformat()}, "Invoice date cannot be in the future."),
    ({"invoice_date": "2025-12-31"}, "The invoice date cannot be before the PO date (01-01-2026)."),
    ({"invoice_date": None}, "Invoice date is required."),
])
async def test_the_invoice_is_checked_once_for_the_receipt(client, over, message):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 1)])
    resp = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 1}], **over))
    assert resp.status_code == 422
    assert resp.json()["problems"] == [{"line_no": None, "message": message}]
    assert resp.json()["detail"] == message


@pytest.mark.parametrize("place, message", [
    ("dead_stock", "Closed Stock is no longer active, so goods cannot be received there."),
    ("stock_b", "The place the goods are received into must belong to the purchase order's company."),
    ("employee", "Ravi Kumar is not a stock room. Choose a stock room (or the purchase order's delivery place)."),
    (None, "The place you chose to receive the goods into does not exist."),
])
async def test_the_place_goods_are_received_into_must_be_an_active_stock_room_of_the_company(client, place, message):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 1)])
    resp = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 1}],
                                                       received_into_asset_user_id=w[place] if place else 999999))
    assert resp.status_code == 422
    assert resp.json()["problems"] == [{"line_no": None, "message": message}]


async def test_without_a_delivery_place_the_receipt_asks_where(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 1)], delivery_asset_user_id=None)
    body = receipt(w, [{"line_no": 1, "quantity": 1}])
    body.pop("received_into_asset_user_id")
    resp = await receive(client, h, po["id"], body)
    assert resp.json()["problems"] == [{"line_no": None, "message": "Choose where the goods are received into."}]


# ---- lines and quantities ---------------------------------------------------------

async def test_line_problems_are_plain_sentences(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 2), ("ap", 1)])
    await client.post(f"/api/purchase-orders/{po['id']}/line-groups/2/cancel-waiting", headers=h)
    resp = await receive(client, h, po["id"], receipt(w, [
        {"line_no": 1, "quantity": 1}, {"line_no": 1, "quantity": 1}, {"line_no": 2, "quantity": 1}]))
    assert [(p["line_no"], p["message"]) for p in resp.json()["problems"]] == [
        (1, "This line appears twice in the receipt; enter it once."),
        (2, "Nothing on this line is still waiting."),
    ]


@pytest.mark.parametrize("lines, message", [
    ([], "Add at least one line."),
    ([{"line_no": 1, "quantity": 0}], "Line 1: Quantity must be at least 1."),
    ([{"line_no": 1, "quantity": 1001}], "Line 1: Quantity must be at most 1,000."),
])
async def test_an_empty_receipt_or_impossible_quantity_is_a_422(client, lines, message):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 1)])
    resp = await receive(client, h, po["id"], receipt(w, lines))
    assert resp.status_code == 422 and resp.json()["detail"] == message


async def test_one_receipt_holds_at_most_a_thousand_units(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 600), ("gangbox", 600)])
    resp = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 600}, {"line_no": 2, "quantity": 600}]))
    assert resp.status_code == 422
    assert resp.json()["problems"][0] == {"line_no": None, "message": "One receipt can hold at most 1,000 units; this one has 1,200."}


# ---- who may receive ------------------------------------------------------------

async def test_a_line_of_the_other_work_area_is_refused(client):
    w = await build_s4_world()
    admin = await login(client, w, "admin")
    po = await make_po(client, admin, w, [("gangbox", 1), ("chair", 1)])
    it = await login(client, w, "op_it")
    refused = await receive(client, it, po["id"], receipt(w, [{"line_no": 1, "quantity": 1}, {"line_no": 2, "quantity": 1}]))
    assert refused.status_code == 403
    assert refused.json()["detail"].startswith("Line 2: This is Non-IT work, which is outside your work area.")
    assert await _count(Asset) == 0
    nonit = await login(client, w, "op_nonit")
    assert (await receive(client, nonit, po["id"], receipt(w, [{"line_no": 1, "quantity": 1}]))).status_code == 403
    assert (await receive(client, nonit, po["id"], receipt(w, [{"line_no": 2, "quantity": 1}]))).status_code == 200
    assert (await receive(client, it, po["id"], receipt(w, [{"line_no": 1, "quantity": 1}]))).status_code == 200


async def test_company_scope_roles_and_deleted_pos(client):
    w = await build_s4_world()
    owner = await login(client, w, "owner")
    other = await client.post("/api/purchase-orders/with-lines", headers=owner, json={
        "company_id": w["co_b"], "po_number": "B-1", "po_date": "2026-01-01", "cost_center_id": w["cc_b"],
        "lines": [{"item_id": w["item_gangbox"], "quantity": 1, "purchase_cost": 10}]})
    assert other.status_code == 201, other.text
    body = receipt(w, [{"line_no": 1, "quantity": 1}], received_into_asset_user_id=w["stock_b"])
    assert (await receive(client, await login(client, w, "op_it"), other.json()["id"], body)).status_code == 404
    assert (await receive(client, await login(client, w, "viewer_it"), other.json()["id"], body)).status_code == 403
    assert (await receive(client, owner, other.json()["id"], body)).status_code == 200    # the owner works everywhere

    po = await make_po(client, owner, w, [("gangbox", 1)])
    assert (await client.delete(f"/api/purchase-orders/{po['id']}", headers=owner)).status_code == 200
    gone = await receive(client, owner, po["id"], receipt(w, [{"line_no": 1, "quantity": 1}]))
    assert gone.status_code == 422
    assert gone.json()["problems"] == [{"line_no": None, "message": "This purchase order has been deleted, so nothing new can be recorded on it."}]


async def test_inactive_masters_of_the_ordered_line_do_not_block_its_receipt(client):
    """S0 decision 9: what was valid when ordered is received; only the place it goes into must be active."""
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 1)])
    from app.items.models import Item
    from app.masters.models import Vendor
    async with SessionLocal() as s:
        await s.execute(update(Item).where(Item.id == w["item_gangbox"]).values(is_active=False))
        await s.execute(update(Vendor).where(Vendor.id == w["vendor"]).values(is_active=False))
        await s.commit()
    assert (await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 1}]))).status_code == 200


async def test_no_code_rule_is_reported_for_the_line_and_nothing_is_written(client):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    po = await make_po(client, h, w, [("gangbox", 2)])
    from app.numbering.models import CodeRule
    async with SessionLocal() as s:
        await s.execute(update(CodeRule).values(is_active=False))
        await s.commit()
    resp = await receive(client, h, po["id"], receipt(w, [{"line_no": 1, "quantity": 2}]))
    assert resp.status_code == 422
    [problem] = resp.json()["problems"]
    assert problem["line_no"] == 1 and problem["message"].startswith("No code rule (asset code format) is set up")
