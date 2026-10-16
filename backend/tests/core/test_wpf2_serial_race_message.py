"""Security closure WP-F2 / CL2-SE-N03: a request that loses a same-serial race (it passed the application's
serial pre-check a moment before the winner committed, then hit the database's unique index
`ux_asset_serial_number_ci`) gets the same status as the pre-check (422) and a plain serial sentence --
not a bare 409 "This record already exists.". The index stays the real guard: exactly one asset per serial.
Every other integrity error is answered as before."""
import asyncio

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

import app.assets.batch as batch_module
import app.assets.service as service_module
import app.purchase_orders.receive as receive_module
from app.assets.models import Asset
from app.core.db import SessionLocal
from app.core.errors import SERIAL_IN_USE, integrity_message
from tests.core.s0_world import asset_body
from tests.purchase_orders.s4_world import build_s4_world, login, make_po, receipt, receive

PARALLEL = 20


async def _assets_with_serial(serial: str) -> int:
    async with SessionLocal() as s:
        return (await s.execute(select(func.count()).select_from(Asset).where(
            func.lower(func.trim(Asset.serial_number)) == serial.lower(), Asset.deleted_at.is_(None)))).scalar_one()


def _friendly_serial_refusal(resp) -> bool:
    """The pre-check's sentence ("Serial number X is already used by asset Y.") or the index's (SERIAL_IN_USE)."""
    detail = resp.json().get("detail") or ""
    return resp.status_code == 422 and "serial number" in detail.lower() and "already used" in detail


def _histogram(results) -> dict:
    out: dict = {}
    for r in results:
        out[r.status_code] = out.get(r.status_code, 0) + 1
    # evidence (pytest -s): how many losers were answered by the index path vs the pre-check
    by_path = {"index": sum(1 for r in results if r.status_code == 422 and r.json().get("detail") == SERIAL_IN_USE)}
    by_path["pre-check"] = sum(1 for r in results if r.status_code == 422) - by_path["index"]
    print(f"[WPF2] status histogram {out}; 422 answered by {by_path}")
    return out


# ---------------------------------------------------------------- the constraint-name -> message map (unit)

def _integrity(constraint: str, detail: str, sqlstate: str = "23505") -> IntegrityError:
    class _Pg(Exception):
        pass

    pg = _Pg()
    pg.sqlstate, pg.constraint_name, pg.detail = sqlstate, constraint, detail

    class _Orig(Exception):
        pass

    orig = _Orig()
    orig.__cause__ = pg
    return IntegrityError("INSERT", {}, orig)


def test_the_serial_index_is_a_plain_422_and_other_constraints_are_unchanged():
    assert integrity_message(_integrity(
        "ux_asset_serial_number_ci", "Key (lower(TRIM(BOTH FROM serial_number)))=(sn-1) already exists.",
    )) == (422, SERIAL_IN_USE)
    # unchanged: the PO-number index keeps its own sentence and status
    assert integrity_message(_integrity(
        "uq_purchase_order_company_number_active", "Key (company_id, lower(btrim(po_number::text)))=(1, x) already exists.",
    )) == (409, "A purchase order with this PO number already exists for this company.")
    # unchanged: a plain-column unique key names its column
    assert integrity_message(_integrity("asset_asset_code_key", "Key (asset_code)=(A/1) already exists.")) == (
        409, "A record with this asset code already exists.")
    # unchanged: any other expression index still gets the generic sentence (not hidden, not re-worded)
    assert integrity_message(_integrity("ux_item_name_active_ci", "Key (lower(name::text))=(x) already exists.")) == (
        409, "This record already exists.")
    # unchanged: a missing reference
    assert integrity_message(_integrity(
        "asset_vendor_id_fkey", 'Key (vendor_id)=(99) is not present in table "vendor".', sqlstate="23503",
    )) == (422, "The vendor you chose does not exist.")


async def test_the_serial_index_is_in_the_test_database():
    from sqlalchemy import text
    async with SessionLocal() as s:
        found = (await s.execute(text(
            "select indexdef from pg_indexes where indexname = 'ux_asset_serial_number_ci'"))).scalar_one()
    assert "UNIQUE" in found and "serial_number" in found


# ---------------------------------------------------------------- the index path, made certain (pre-check skipped)

async def test_a_receipt_that_passed_the_pre_check_gets_the_serial_sentence_from_the_index(client, monkeypatch):
    """Simulates the race loser exactly: the advisory pre-check finds nothing, the database index refuses."""
    w = await build_s4_world()
    h = await login(client, w, "owner")
    po_a = await make_po(client, h, w, [("camera", 1)], number="PO-N03-A")
    po_b = await make_po(client, h, w, [("camera", 1)], number="PO-N03-B")
    body = receipt(w, [{"line_no": 1, "quantity": 1, "serial_numbers": ["N03-IDX-1"]}])
    assert (await receive(client, h, po_a["id"], body)).status_code == 200

    async def nothing_in_use(session, serials):
        return []

    monkeypatch.setattr(receive_module, "find_serials_in_use", nothing_in_use)       # the receipt's own check
    monkeypatch.setattr(service_module, "find_serials_in_use", nothing_in_use)       # the engine's batch check
    lost = await receive(client, h, po_b["id"], body)
    assert lost.status_code == 422 and lost.json()["detail"] == SERIAL_IN_USE, lost.text
    assert "request_id" in lost.json()
    assert await _assets_with_serial("N03-IDX-1") == 1
    # nothing of the refused receipt was written: PO B's unit is still waiting
    from app.purchase_orders.models import PendingAsset
    async with SessionLocal() as s:
        statuses = (await s.execute(select(PendingAsset.status).where(
            PendingAsset.purchase_order_id == po_b["id"]))).scalars().all()
    assert statuses == ["PENDING"]


async def test_a_batch_that_passed_the_pre_check_gets_the_serial_sentence_from_the_index(client, monkeypatch):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    payload = {"item_id": w["item_camera"], "quantity": 1, "received_into_asset_user_id": w["stock"],
               "cost_center_id": w["cc"], "serial_numbers": ["N03-IDX-2"]}
    assert (await client.post("/api/assets/batch", headers=h, json=payload)).status_code == 201

    async def nothing_in_use(session, serials):
        return []

    monkeypatch.setattr(batch_module, "find_serials_in_use", nothing_in_use)
    monkeypatch.setattr(service_module, "find_serials_in_use", nothing_in_use)
    lost = await client.post("/api/assets/batch", headers=h, json=payload)
    assert lost.status_code == 422 and lost.json()["detail"] == SERIAL_IN_USE, lost.text
    assert await _assets_with_serial("N03-IDX-2") == 1


# ---------------------------------------------------------------- real parallel bursts (20 at once)

async def test_twenty_parallel_receipts_of_one_serial_make_one_asset_and_friendly_refusals(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    pos = [await make_po(client, h, w, [("camera", 1)], number=f"PO-N03-{i:02d}") for i in range(PARALLEL)]
    body = receipt(w, [{"line_no": 1, "quantity": 1, "serial_numbers": ["N03-RACE-RCV"]}])
    results = await asyncio.gather(*(receive(client, h, po["id"], body) for po in pos))
    histogram = _histogram(results)
    assert not [c for c in histogram if c >= 500], [r.text for r in results if r.status_code >= 500]
    assert histogram.get(200) == 1, histogram
    losers = [r for r in results if r.status_code != 200]
    assert len(losers) == PARALLEL - 1 and all(_friendly_serial_refusal(r) for r in losers), \
        [(r.status_code, r.text) for r in losers if not _friendly_serial_refusal(r)]
    assert not [r for r in losers if r.json()["detail"] == "This record already exists."]
    assert await _assets_with_serial("N03-RACE-RCV") == 1


async def test_twenty_parallel_batch_adds_of_one_serial_make_one_asset_and_friendly_refusals(client):
    w = await build_s4_world()
    h = await login(client, w, "owner")
    payload = {"item_id": w["item_camera"], "quantity": 1, "received_into_asset_user_id": w["stock"],
               "cost_center_id": w["cc"], "serial_numbers": ["N03-RACE-BATCH"]}
    results = await asyncio.gather(*(client.post("/api/assets/batch", headers=h, json=payload) for _ in range(PARALLEL)))
    histogram = _histogram(results)
    assert not [c for c in histogram if c >= 500], [r.text for r in results if r.status_code >= 500]
    assert histogram.get(201) == 1, histogram
    losers = [r for r in results if r.status_code != 201]
    assert len(losers) == PARALLEL - 1 and all(_friendly_serial_refusal(r) for r in losers), \
        [(r.status_code, r.text) for r in losers if not _friendly_serial_refusal(r)]
    assert await _assets_with_serial("N03-RACE-BATCH") == 1


async def test_twenty_parallel_single_asset_adds_of_one_serial_make_one_asset_and_friendly_refusals(client):
    """The retest's own scenario (c): POST /api/assets with one serial, 20 at once (was 201x1, 409x13, 422x6)."""
    w = await build_s4_world()
    h = await login(client, w, "owner")
    payload = asset_body(w, serial_number="N03-RACE-ASSET")
    results = await asyncio.gather(*(client.post("/api/assets", headers=h, json=payload) for _ in range(PARALLEL)))
    histogram = _histogram(results)
    assert not [c for c in histogram if c >= 500], [r.text for r in results if r.status_code >= 500]
    assert histogram.get(201) == 1 and histogram.get(422) == PARALLEL - 1, histogram
    assert all("serial number" in r.json()["detail"].lower() for r in results if r.status_code == 422)
    assert await _assets_with_serial("N03-RACE-ASSET") == 1


@pytest.mark.parametrize("serial", ["N/A", " n/a "])
async def test_the_reserved_no_serial_values_still_repeat_freely(client, serial):
    """Regression guard: the change touches only the answer to a real clash, never what counts as one."""
    w = await build_s4_world()
    h = await login(client, w, "owner")
    payload = asset_body(w, serial_number=serial)
    results = await asyncio.gather(*(client.post("/api/assets", headers=h, json=payload) for _ in range(3)))
    assert [r.status_code for r in results] == [201, 201, 201], [r.text for r in results]
