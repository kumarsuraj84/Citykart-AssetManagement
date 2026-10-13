"""S6: an Item and its set (bundle) in one call -- POST/PUT /api/items with `set_parts`, one transaction,
through the bundles service; plus `is_set` / `bundle_name` on Item rows."""
from sqlalchemy import func, select

from app.bundles.models import Bundle, BundlePart
from app.core.db import SessionLocal
from app.items.models import Item
from app.masters.models import MasterAudit
from tests.core.s3a1_world import build_s3_world, item_body, login


async def _world():
    w = await build_s3_world()
    async with SessionLocal() as s:
        parts = {
            "cpu": Item(name="CPU", category_id=w["it"], subcategory_id=w["lap"]),
            "tft": Item(name="TFT", category_id=w["it"], subcategory_id=w["lap"]),
            "kbd": Item(name="Keyboard", category_id=w["it"], subcategory_id=w["lap"], serial_required=False),
            "leg": Item(name="Desk Leg", category_id=w["nonit"], subcategory_id=w["chair"]),
            "old": Item(name="Old Part", category_id=w["it"], subcategory_id=w["lap"], is_active=False),
        }
        s.add_all(parts.values())
        await s.commit()
        for key, item in parts.items():
            w[f"part_{key}"] = item.id
    return w


def _parts(w, *spec):
    return [{"name": name, "item_id": w[f"part_{key}"], "share_percent": share} for key, name, share in spec]


async def _counts() -> tuple[int, int]:
    async with SessionLocal() as s:
        items = (await s.execute(select(func.count()).select_from(Item))).scalar_one()
        bundles = (await s.execute(select(func.count()).select_from(Bundle))).scalar_one()
        return items, bundles


async def _bundle_parts(bundle_id: int) -> list[tuple[int, str, float, bool]]:
    async with SessionLocal() as s:
        return [(p.id, p.name, float(p.share_percent), p.is_active) for p in (await s.execute(
            select(BundlePart).where(BundlePart.bundle_id == bundle_id).order_by(BundlePart.id))).scalars().all()]


async def test_an_operator_makes_an_item_and_its_set_in_one_call(client):
    w = await _world()
    h = await login(client, w, "op_it")
    resp = await client.post("/api/items", headers=h, json=item_body(
        w, name="Desktop", set_parts=_parts(w, ("cpu", "CPU", 70), ("tft", "TFT", 30))))
    assert resp.status_code == 201, resp.text
    item = resp.json()
    assert item["is_set"] is True and item["bundle_name"] == "Desktop" and item["bundle_id"] is not None
    [b] = [b for b in (await client.get("/api/bundles", headers=h)).json() if b["id"] == item["bundle_id"]]
    assert [(p["name"], p["item_id"], p["share_percent"]) for p in b["parts"]] == [
        ("CPU", w["part_cpu"], 70.0), ("TFT", w["part_tft"], 30.0)]
    row = next(r for r in (await client.get("/api/items", headers=h)).json() if r["id"] == item["id"])
    assert (row["is_set"], row["bundle_name"]) == (True, "Desktop")


async def test_an_item_without_set_parts_is_saved_exactly_as_before(client):
    w = await _world()
    h = await login(client, w, "op_it")
    resp = await client.post("/api/items", headers=h, json=item_body(w, name="Router"))
    assert resp.status_code == 201
    assert (resp.json()["is_set"], resp.json()["bundle_name"], resp.json()["bundle_id"]) == (False, None, None)
    assert await _counts() == (8, 0)


async def test_a_bad_set_saves_neither_the_item_nor_the_set(client):
    w = await _world()
    h = await login(client, w, "op_it")
    before = await _counts()
    cases = [
        (_parts(w, ("cpu", "CPU", 70), ("tft", "TFT", 20)), "the shares add up to 90"),
        (_parts(w, ("cpu", "CPU", 70), ("old", "Old", 30)), "the Item for 'Old' was not found"),
        (_parts(w, ("cpu", "CPU", 50), ("tft", "cpu", 50)), "part names must be different"),
        ([], "A set needs at least one part."),
    ]
    for parts, words in cases:
        resp = await client.post("/api/items", headers=h, json=item_body(w, name="Desktop", set_parts=parts))
        assert resp.status_code == 422, parts
        assert words in resp.json()["detail"], resp.json()["detail"]
    assert await _counts() == before


async def test_a_late_item_failure_rolls_the_new_set_back(client):
    w = await _world()
    h = await login(client, w, "op_it")
    before = await _counts()
    dup = await client.post("/api/items", headers=h, json=item_body(
        w, name="laptop", set_parts=_parts(w, ("cpu", "CPU", 50), ("tft", "TFT", 50))))     # Laptop exists already
    assert dup.status_code == 422 and "already exists" in dup.json()["detail"]
    assert await _counts() == before
    async with SessionLocal() as s:
        assert (await s.execute(select(Bundle).where(func.lower(Bundle.name) == "laptop"))).first() is None


async def test_parts_must_be_in_the_callers_work_area(client):
    w = await _world()
    before = await _counts()
    resp = await client.post("/api/items", headers=await login(client, w, "op_it"), json=item_body(
        w, name="Desk Set", set_parts=_parts(w, ("cpu", "CPU", 50), ("leg", "Leg", 50))))
    assert resp.status_code == 403
    assert resp.json()["detail"].startswith("This belongs to the Admin / Non-IT team; you can only work with IT items.")
    assert await _counts() == before
    viewer = await client.post("/api/items", headers=await login(client, w, "viewer_it"), json=item_body(
        w, name="Desk Set", set_parts=_parts(w, ("cpu", "CPU", 100))))
    assert viewer.status_code == 403
    both = await client.post("/api/items", headers=await login(client, w, "admin"), json=item_body(
        w, name="Mixed Set", set_parts=_parts(w, ("cpu", "CPU", 50), ("leg", "Leg", 50))))
    assert both.status_code == 201                                       # someone who handles both areas


async def test_a_part_that_is_a_set_and_a_set_name_already_taken_are_refused(client):
    w = await _world()
    h = await login(client, w, "op_it")
    desktop = (await client.post("/api/items", headers=h, json=item_body(
        w, name="Desktop", set_parts=_parts(w, ("cpu", "CPU", 70), ("tft", "TFT", 30))))).json()
    nested = await client.post("/api/items", headers=h, json=item_body(
        w, name="Workstation", set_parts=[{"name": "Desktop", "item_id": desktop["id"], "share_percent": 100}]))
    assert nested.status_code == 422 and "is itself a bundle" in nested.json()["detail"]
    owner = await login(client, w, "owner")
    made = await client.post("/api/bundles", headers=owner, json={"name": "Thin Client", "parts": _parts(w, ("cpu", "CPU", 100))})
    assert made.status_code == 201
    taken = await client.post("/api/items", headers=h, json=item_body(
        w, name="Thin Client", set_parts=_parts(w, ("cpu", "CPU", 100))))
    assert taken.status_code == 422 and taken.json()["detail"] == (
        "A set named Thin Client already exists. Choose it as this Item's set, or give the Item another name.")
    both = await client.post("/api/items", headers=h, json=item_body(
        w, name="Other", bundle_id=made.json()["id"], set_parts=_parts(w, ("cpu", "CPU", 100))))
    assert both.status_code == 422 and both.json()["detail"] == "Choose an existing set or list the set's parts, not both."


async def test_an_admin_edits_the_items_own_set_in_place_and_it_is_audited(client):
    w = await _world()
    op = await login(client, w, "op_it")
    desktop = (await client.post("/api/items", headers=op, json=item_body(
        w, name="Desktop", set_parts=_parts(w, ("cpu", "CPU", 70), ("tft", "TFT", 30))))).json()
    before = await _bundle_parts(desktop["bundle_id"])
    h = await login(client, w, "admin_it")
    resp = await client.put(f"/api/items/{desktop['id']}", headers=h, json=item_body(
        w, name="Desktop", bundle_id=desktop["bundle_id"],
        set_parts=_parts(w, ("cpu", "cpu", 60), ("kbd", "Keyboard", 40))))
    assert resp.status_code == 200, resp.text
    assert resp.json()["bundle_id"] == desktop["bundle_id"]                          # the same set, changed in place
    after = await _bundle_parts(desktop["bundle_id"])
    cpu_id = next(pid for pid, name, _, _ in before if name == "CPU")
    assert (cpu_id, "cpu", 60.0, True) in after                                       # matched by name: same part kept
    assert any(name == "TFT" and not active for _, name, _, active in after)          # left out: deactivated, not deleted
    assert any(name == "Keyboard" and active for _, name, _, active in after)
    async with SessionLocal() as s:
        rows = (await s.execute(select(MasterAudit).where(
            MasterAudit.entity == "item", MasterAudit.entity_id == desktop["id"], MasterAudit.field == "set_parts"))).scalars().all()
        assert [(r.old_value, r.new_value) for r in rows] == [("CPU 70%, TFT 30%", "cpu 60%, Keyboard 40%")]
    assert (await client.put(f"/api/items/{desktop['id']}", headers=op, json=item_body(
        w, name="Desktop", set_parts=_parts(w, ("cpu", "CPU", 100))))).status_code == 403      # editing stays with admins


async def test_an_existing_item_becomes_a_set_and_cannot_be_its_own_part(client):
    w = await _world()
    h = await login(client, w, "admin_it")
    own = await client.put(f"/api/items/{w['item_it']}", headers=h, json=item_body(
        w, name="Laptop", set_parts=[{"name": "Self", "item_id": w["item_it"], "share_percent": 100}]))
    assert own.status_code == 422 and own.json()["detail"] == "An Item cannot be a part of its own set."
    resp = await client.put(f"/api/items/{w['item_it']}", headers=h, json=item_body(
        w, name="Laptop", set_parts=_parts(w, ("cpu", "Body", 90), ("kbd", "Keyboard", 10))))
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_set"] is True and resp.json()["bundle_name"] == "Laptop"


async def test_a_set_shared_with_other_items_is_not_changed_from_one_item(client):
    w = await _world()
    owner = await login(client, w, "owner")
    shared = (await client.post("/api/bundles", headers=owner, json={"name": "Kit", "parts": _parts(w, ("cpu", "CPU", 100))})).json()
    for name in ("Kit A", "Kit B"):
        assert (await client.post("/api/items", headers=owner, json=item_body(w, name=name, bundle_id=shared["id"]))).status_code == 201
    kit_a = next(i for i in (await client.get("/api/items", headers=owner)).json() if i["name"] == "Kit A")
    resp = await client.put(f"/api/items/{kit_a['id']}", headers=await login(client, w, "admin_it"), json=item_body(
        w, name="Kit A", bundle_id=shared["id"], set_parts=_parts(w, ("tft", "TFT", 100))))
    assert resp.status_code == 422 and resp.json()["detail"] == (
        "The set Kit is also used by Kit B, so it cannot be changed from this Item. "
        "Ask the head-office admin to change it on the Sets screen.")
    assert [name for _, name, _, active in await _bundle_parts(shared["id"]) if active] == ["CPU"]


async def test_the_sets_screen_itself_stays_head_office_only(client):
    w = await _world()
    body = {"name": "Kit", "parts": _parts(w, ("cpu", "CPU", 100))}
    for who in ("admin", "admin_it", "op_it"):
        h = await login(client, w, who)
        assert (await client.post("/api/bundles", headers=h, json=body)).status_code == 403
    made = (await client.post("/api/bundles", headers=await login(client, w, "owner"), json=body)).json()
    for who in ("admin", "op_it"):
        h = await login(client, w, who)
        assert (await client.put(f"/api/bundles/{made['id']}", headers=h, json=body)).status_code == 403
        assert (await client.delete(f"/api/bundles/{made['id']}", headers=h)).status_code == 403


async def test_an_admin_of_the_other_area_cannot_set_parts_on_an_item(client):
    w = await _world()
    resp = await client.put(f"/api/items/{w['item_it']}", headers=await login(client, w, "admin_nonit"), json=item_body(
        w, name="Laptop", set_parts=_parts(w, ("cpu", "CPU", 100))))
    assert resp.status_code == 403
    async with SessionLocal() as s:
        assert (await s.get(Item, w["item_it"])).bundle_id is None


async def test_a_set_made_with_its_item_orders_like_any_set(client):
    w = await _world()
    h = await login(client, w, "op_it")
    desktop = (await client.post("/api/items", headers=h, json=item_body(
        w, name="Desktop", set_parts=_parts(w, ("cpu", "CPU", 70), ("tft", "TFT", 30))))).json()
    resp = await client.post("/api/purchase-orders/with-lines", headers=h, json={
        "company_id": w["co"], "po_number": "PO-SET", "po_date": "2026-01-01", "cost_center_id": w["cc"],
        "sets": [{"bundle_id": desktop["bundle_id"], "quantity": 2, "price_per_set": 1000}]})
    assert resp.status_code == 201, resp.text
    assert (resp.json()["lines_created"], resp.json()["units_created"]) == (2, 4)


async def test_choosing_an_existing_set_by_id_still_works_as_before(client):
    w = await _world()
    owner = await login(client, w, "owner")
    kit = (await client.post("/api/bundles", headers=owner, json={"name": "Kit", "parts": _parts(w, ("cpu", "CPU", 100))})).json()
    resp = await client.put(f"/api/items/{w['item_it']}", headers=await login(client, w, "admin_it"),
                            json=item_body(w, name="Laptop", bundle_id=kit["id"]))
    assert resp.status_code == 200
    assert (resp.json()["bundle_id"], resp.json()["is_set"], resp.json()["bundle_name"]) == (kit["id"], True, "Kit")
    cleared = await client.put(f"/api/items/{w['item_it']}", headers=owner, json=item_body(w, name="Laptop"))
    assert (cleared.json()["bundle_id"], cleared.json()["is_set"]) == (None, False)
