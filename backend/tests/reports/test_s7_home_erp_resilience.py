"""S7 fix round (P1-1): one ERP read that cannot be made (the goods-receipt or purchase-invoice view does not
exist in production; the warehouse is down) never hides the other ERP figures on Home, and the PO pages'
reminder / PI calls answer 200 with "not available" instead of a 503."""
import asyncpg
import pytest

from app.erp.source import ErpReceipt, ErpUnavailable, ErpViewMissing, PgReadOnly
from tests.erp.s3a2_world import build_s3a2_world, create_body
from tests.erp.test_erp_api import _headers, desktop_po, erp, line  # noqa: F401  (erp is a fixture)

PO_CODE = 1133610106
NO_RECEIPTS = "The ERP does not provide goods receipts yet, so goods-arrived reminders are not available."
NO_INVOICES = "The ERP does not provide purchase invoices yet."


@pytest.fixture
def erp_on(monkeypatch):
    monkeypatch.setattr("app.home.service.is_configured", lambda: True)
    monkeypatch.setattr("app.erp.router.is_configured", lambda: True)


def missing_view(*_args, **_kwargs):
    async def fail(*_a, **_k):
        raise ErpViewMissing("The ERP view this screen reads does not exist yet.")
    return fail


async def _world(client, erp) -> tuple[dict, dict, int]:
    """An ERP PO made here (changed in the ERP since, goods arrived) and another ERP PO still needing input."""
    ids = await build_s3a2_world(erp)
    h = await _headers(client)
    draft = (await client.get(f"/api/erp/pos/{PO_CODE}/draft", headers=h)).json()
    made = await client.post("/api/erp/pos/create", headers=h, json=create_body(draft, ids))
    assert made.status_code == 201, made.text
    erp.pos[PO_CODE] = desktop_po(lines=[line(1, "CT324973", "DELL DESKTOP", 5, 20000)])
    erp.receipt_list = [ErpReceipt(po_code=PO_CODE, item_code="CT324973", received_qty=2, grc_no="G1", grc_date=None)]
    erp.pos[9002] = desktop_po(po_code=9002, po_number="SPO/9002", supplier_code="2264", supplier_name="JAGANNATH ENTERPRISES")
    return ids, h, made.json()["po_id"]


async def home(client, h) -> dict:
    resp = await client.get("/api/home/attention", headers=h)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def test_all_erp_figures_when_every_read_works(client, erp, erp_on):
    _, h, _ = await _world(client, erp)
    a = await home(client, h)
    assert a["erp_available"] is True and a["erp_unavailable"] == []
    assert (a["erp_changed_pos"], a["erp_arrived_pos"]) == (1, 1) and a["erp_pos_needing_input"] >= 1
    assert a["inbox"] is not None


async def test_a_missing_goods_receipt_view_only_hides_goods_arrived(client, erp, erp_on):
    _, h, _ = await _world(client, erp)
    erp.receipts = missing_view()
    a = await home(client, h)
    assert a["erp_arrived_pos"] is None and a["erp_unavailable"] == ["erp_arrived_pos"]
    assert a["erp_available"] is True
    assert a["erp_changed_pos"] == 1 and a["erp_pos_needing_input"] >= 1
    assert a["inbox"] is not None and a["inbox"]["items"] >= 0                     # the head-office row stays


async def test_the_same_for_an_operator(client, erp, erp_on):
    _, _, _ = await _world(client, erp)
    erp.receipts = missing_view()
    a = await home(client, await _headers(client, "OPR"))
    assert a["erp_available"] is True and a["erp_arrived_pos"] is None and a["erp_changed_pos"] == 1
    assert a["inbox"] is None                                                       # head-office only, as before


async def test_a_failing_change_check_only_hides_changed_pos(client, erp, erp_on, monkeypatch):
    _, h, _ = await _world(client, erp)

    async def down(*_a, **_k):
        raise ErpUnavailable("The ERP copy cannot be read.")
    monkeypatch.setattr("app.erp.changes.changes_summary", down)
    a = await home(client, h)
    assert a["erp_changed_pos"] is None and a["erp_unavailable"] == ["erp_changed_pos"]
    assert a["erp_arrived_pos"] == 1 and a["erp_pos_needing_input"] >= 1 and a["erp_available"] is True


async def test_a_failing_po_list_only_hides_pos_needing_input(client, erp, erp_on, monkeypatch):
    _, h, _ = await _world(client, erp)

    async def down(*_a, **_k):
        raise ErpUnavailable("The ERP copy cannot be read.")
    monkeypatch.setattr("app.erp.service.erp_po_rows", down)
    a = await home(client, h)
    assert a["erp_pos_needing_input"] is None and a["erp_unavailable"] == ["erp_pos_needing_input"]
    assert (a["erp_changed_pos"], a["erp_arrived_pos"]) == (1, 1) and a["erp_available"] is True


async def test_a_failing_inbox_only_hides_the_inbox(client, erp, erp_on, monkeypatch):
    _, h, _ = await _world(client, erp)

    async def down(*_a, **_k):
        raise ErpUnavailable("The ERP copy cannot be read.")
    monkeypatch.setattr("app.erp.inbox.inbox_counts", down)
    a = await home(client, h)
    assert a["inbox"] is None and a["erp_unavailable"] == ["inbox"]
    assert (a["erp_changed_pos"], a["erp_arrived_pos"]) == (1, 1) and a["erp_available"] is True


async def test_only_the_inbox_readable_still_counts_as_erp_available(client, erp, erp_on, monkeypatch):
    _, h, _ = await _world(client, erp)

    async def down(*_a, **_k):
        raise ErpUnavailable("The ERP copy cannot be read.")
    for target in ("app.erp.changes.changes_summary", "app.erp.service.erp_po_rows", "app.erp.reminders.delivery_reminders"):
        monkeypatch.setattr(target, down)
    a = await home(client, h)
    assert a["inbox"] is not None and a["erp_available"] is True
    assert a["erp_unavailable"] == ["erp_changed_pos", "erp_arrived_pos", "erp_pos_needing_input"]


# ------------------------------------------------------------------ the PO pages' ERP calls

async def test_reminders_without_a_goods_receipt_view_are_an_empty_200(client, erp, erp_on):
    _, h, po_id = await _world(client, erp)
    erp.receipts = missing_view()
    for params in ({}, {"po_id": po_id}):
        resp = await client.get("/api/erp/reminders", headers=h, params=params)
        assert resp.status_code == 200 and resp.json() == []
        assert resp.headers["X-ERP-Available"] == "false" and resp.headers["X-ERP-Message"] == NO_RECEIPTS
    env = await client.get("/api/erp/reminders", headers=h, params={"envelope": "true"})
    assert env.status_code == 200 and env.json() == {"available": False, "message": NO_RECEIPTS, "items": []}


async def test_reminders_that_work_say_so(client, erp, erp_on):
    _, h, po_id = await _world(client, erp)
    resp = await client.get("/api/erp/reminders", headers=h)
    assert resp.status_code == 200 and len(resp.json()) == 1 and resp.headers["X-ERP-Available"] == "true"
    assert "X-ERP-Message" not in resp.headers
    env = (await client.get("/api/erp/reminders", headers=h, params={"envelope": "true"})).json()
    assert env["available"] is True and env["message"] is None and env["items"][0]["po_id"] == po_id


async def test_reminders_keep_their_role_check(client, erp, erp_on):
    await _world(client, erp)
    erp.receipts = missing_view()
    assert (await client.get("/api/erp/reminders", headers=await _headers(client, "VWR"))).status_code == 403


async def test_pi_lookup_without_an_invoice_view_says_the_erp_does_not_provide_it(client, erp, erp_on):
    _, h, po_id = await _world(client, erp)
    erp.invoices = missing_view()
    resp = await client.get(f"/api/erp/purchase-orders/{po_id}/pi", headers=h)
    assert resp.status_code == 200
    body = resp.json()
    assert (body["available"], body["message"], body["rows"], body["po_id"]) == (False, NO_INVOICES, [], po_id)
    applied = await client.post(f"/api/erp/purchase-orders/{po_id}/pi/apply", headers=h,
                                json={"items": [{"pi_number": "PI-1", "ckam_invoice_number": "INV-1"}]})
    assert applied.status_code == 503 and applied.json()["detail"] == NO_INVOICES


async def test_pi_lookup_that_works_says_available(client, erp, erp_on):
    _, h, po_id = await _world(client, erp)
    body = (await client.get(f"/api/erp/purchase-orders/{po_id}/pi", headers=h)).json()
    assert body["available"] is True and body["message"] is None and body["rows"] == []


async def test_pi_lookup_for_a_po_not_from_the_erp_keeps_its_422(client, erp, erp_on):
    ids, h, _ = await _world(client, erp)
    made = await client.post("/api/purchase-orders", headers=h, json={
        "company_id": ids["spl"], "po_number": "MAN-S7", "po_date": "2026-01-01", "cost_center_id": ids["cost_spl"]})
    assert made.status_code == 201, made.text
    resp = await client.get(f"/api/erp/purchase-orders/{made.json()['id']}/pi", headers=h)
    assert resp.status_code == 422 and "not created from the ERP" in resp.json()["detail"]


async def test_a_missing_view_in_the_erp_is_told_apart_from_a_down_erp(monkeypatch):
    class Conn:
        # Security IF-10 (intended change): reads now run inside conn.transaction(readonly=True) with a timeout.
        def transaction(self, **_kw):
            return _NoTransaction()

        async def fetch(self, *_a, **_kw):
            raise asyncpg.UndefinedTableError('relation "gold_ckam.po_receipt_line" does not exist')

        async def close(self, **_kw):
            pass

    class _NoTransaction:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return False

    reader = PgReadOnly()

    async def connect():
        return Conn()
    monkeypatch.setattr(reader, "_connect", connect)
    with pytest.raises(ErpViewMissing) as caught:
        await reader._fetch("select 1")
    assert isinstance(caught.value, ErpUnavailable)                       # every old `except ErpUnavailable` still works
    assert str(caught.value) == "The ERP view this screen reads does not exist yet."
