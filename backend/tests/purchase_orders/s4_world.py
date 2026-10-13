"""Shared set-up for the S4 tests (Receive by line, the batch asset engine, bulk serials, PO reads).

The S0 world (company A with an IT and a Non-IT category, company B, a login of every kind, stock rooms,
a global code rule "S0/{category.code}/" with 3 digits) plus four Items, one per serial rule:
an Indoor Camera (has a serial), a Gang Box (no serial), an Access Point (serial later) -- all IT -- and an
Office Chair (Non-IT, no serial)."""
from sqlalchemy import event

from app.core.db import SessionLocal, engine
from app.items.models import Item
from tests.core.s0_world import PASSWORD, build_world, login  # noqa: F401  (re-exported)


async def build_s4_world() -> dict:
    w = await build_world()
    async with SessionLocal() as s:
        items = {
            "camera": Item(name="Indoor Camera", category_id=w["it"], subcategory_id=w["lap"], serial_required=True),
            "gangbox": Item(name="Gang Box", category_id=w["it"], subcategory_id=w["lap"], serial_required=False),
            "ap": Item(name="Access Point", category_id=w["it"], subcategory_id=w["lap"], serial_required=True,
                       serial_later=True),
            "chair": Item(name="Office Chair", category_id=w["nonit"], subcategory_id=w["chair"], serial_required=False),
        }
        s.add_all(items.values())
        await s.commit()
        for key, item in items.items():
            w[f"item_{key}"] = item.id
    return w


async def make_po(client, headers, w: dict, lines: list[tuple[str, int]], number: str = "PO-S4", **over) -> dict:
    """A manual PO (one call) with one line per (item key, quantity), in that order (line 1, 2, ...)."""
    body = {
        "company_id": w["co"], "po_number": number, "po_date": "2026-01-01", "vendor_id": w["vendor"],
        "cost_center_id": w["cc"], "delivery_asset_user_id": w["stock"],
        "lines": [{"item_id": w[f"item_{key}"], "quantity": qty, "purchase_cost": 1000, "tax_percent": 18}
                  for key, qty in lines],
    }
    body.update(over)
    resp = await client.post("/api/purchase-orders/with-lines", headers=headers, json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def receipt(w: dict, lines: list[dict], **over) -> dict:
    body = {"received_into_asset_user_id": w["stock"], "invoice_number": "INV-1", "invoice_date": "2026-02-01",
            "invoice_amount": 1000, "lines": lines}
    body.update(over)
    return body


def serials(prefix: str, n: int, start: int = 1) -> list[str]:
    return [f"{prefix}-{i:04d}" for i in range(start, start + n)]


async def receive(client, headers, po_id: int, body: dict):
    return await client.post(f"/api/purchase-orders/{po_id}/receive", headers=headers, json=body)


async def groups(client, headers, po_id: int) -> dict[int, dict]:
    resp = await client.get(f"/api/purchase-orders/{po_id}/line-groups", headers=headers)
    assert resp.status_code == 200, resp.text
    return {g["line_no"]: g for g in resp.json()}


class Statements:
    """Counts the SQL statements sent to the database while active."""

    def __init__(self):
        self.count = 0

    def __call__(self, *args, **kwargs):
        self.count += 1

    def __enter__(self):
        event.listen(engine.sync_engine, "before_cursor_execute", self)
        return self

    def __exit__(self, *exc):
        event.remove(engine.sync_engine, "before_cursor_execute", self)
