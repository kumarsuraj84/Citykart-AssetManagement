"""S8 performance guard: auditing adds at most a couple of statements per request, whatever the number of
units, and a 100-unit receipt stays fast."""
import time
from contextlib import contextmanager

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.observability import audit as obs_audit
from app.observability import writer
from tests.observability.helpers import Statements
from tests.purchase_orders.s4_world import build_s4_world, login, make_po, receipt, receive, serials

RESULTS: dict[str, int | float] = {}


@contextmanager
def audit_switched_off(monkeypatch):
    """The request as it was before S8: no automatic rows, no explicit rows, no security / access rows."""
    event.remove(Session, "after_flush", obs_audit._after_flush)

    async def nothing(*args, **kwargs):
        return True

    with monkeypatch.context() as m:
        m.setattr(obs_audit, "record", lambda *a, **k: None)
        m.setattr(writer, "insert_rows", nothing)
        try:
            yield
        finally:
            event.listen(Session, "after_flush", obs_audit._after_flush)


async def _receipt(client, h, w, number: str, units: int = 100) -> tuple[int, float]:
    po = await make_po(client, h, w, [("camera", units)], number=number)
    body = receipt(w, [{"line_no": 1, "quantity": units, "serial_numbers": serials(number, units)}],
                   invoice_number=f"INV-{number}")
    with Statements() as counted:
        started = time.perf_counter()
        resp = await receive(client, h, po["id"], body)
        elapsed = time.perf_counter() - started
    assert resp.status_code == 200, resp.text
    return counted.count, elapsed


async def test_receiving_100_units_costs_at_most_one_more_statement_and_stays_fast(client, monkeypatch):
    w = await build_s4_world()
    h = await login(client, w, "admin")
    await _receipt(client, h, w, "WARM", units=5)                      # first-use costs (caches, pool) out of the way
    with audit_switched_off(monkeypatch):
        before, before_s = await _receipt(client, h, w, "OFF")
    after, after_s = await _receipt(client, h, w, "ON")
    one, _ = await _receipt(client, h, w, "ONE", units=1)
    print(f"\n[S8 receive 100] statements before {before}, after {after}; seconds before {before_s:.3f}, "
          f"after {after_s:.3f}; 1 unit after: {one}")
    assert after - before <= 1                  # the ONE RECEIVE row
    assert after - one <= 5                     # still constant work per receipt, not per unit
    assert after_s < 0.4, after_s


async def test_a_master_update_costs_one_more_statement(client, monkeypatch):
    w = await build_s4_world()
    h = await login(client, w, "owner")

    async def put(name: str) -> int:
        with Statements() as counted:
            resp = await client.put(f"/api/masters/vendors/{w['vendor']}", headers=h, json={"name": name})
        assert resp.status_code == 200, resp.text
        return counted.count

    await put("Warm Vendor")
    with audit_switched_off(monkeypatch):
        before = await put("Vendor Off")
    after = await put("Vendor On")
    print(f"\n[S8 master update] statements before {before}, after {after}")
    assert after - before == 1                  # the automatic UPDATE row, same flush


async def test_a_plain_read_costs_no_extra_statement(client, monkeypatch):
    w = await build_s4_world()
    h = await login(client, w, "admin")

    async def read() -> int:
        with Statements() as counted:
            resp = await client.get("/api/purchase-orders", headers=h)
        assert resp.status_code == 200
        return counted.count

    await read()
    with audit_switched_off(monkeypatch):
        before = await read()
    assert await read() == before
