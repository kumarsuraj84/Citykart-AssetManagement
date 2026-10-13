"""S3a-1: Items belong to their Category's work area. ADMIN and OPERATOR may add
an Item in their own work area (in the flow); editing / removing one needs an
admin of its work area (or the head-office admin); nothing can be slipped into
the other team's area through a sub-category; moving an Item to the other
team needs someone who handles both and a confirmation; changes are audited."""
import pytest
from sqlalchemy import select

from app.core.db import SessionLocal
from app.masters.models import AssetCategory, AssetSubcategory, MasterAudit
from tests.core.s3a1_world import ROLES, build_s3_world, item_body, login

NONIT_ONLY = "This belongs to the Admin / Non-IT team; you can only work with IT items."


def may_add(who: str, area: str) -> bool:
    return who in ("owner", "admin") or (who, area) in (
        ("admin_it", "it"), ("admin_nonit", "nonit"), ("op_it", "it"), ("op_nonit", "nonit"))


def may_manage(who: str, area: str) -> bool:
    return who in ("owner", "admin") or (who, area) in (("admin_it", "it"), ("admin_nonit", "nonit"))


async def _audit(item_id: int) -> list[tuple]:
    async with SessionLocal() as s:
        rows = (await s.execute(select(MasterAudit).where(MasterAudit.entity == "item", MasterAudit.entity_id == item_id)
                                .order_by(MasterAudit.id))).scalars().all()
        return [(r.field, r.old_value, r.new_value) for r in rows]


@pytest.mark.parametrize("area", ["it", "nonit"])
@pytest.mark.parametrize("who", ROLES)
async def test_who_may_add_edit_and_remove_an_item_of_each_work_area(client, who, area):
    w = await build_s3_world()
    h = await login(client, w, who)
    added = await client.post("/api/items", headers=h, json=item_body(w, area, name=f"New {area}"))
    assert added.status_code == (201 if may_add(who, area) else 403), added.text
    target = w["item_it" if area == "it" else "item_nonit"]
    edit = await client.put(f"/api/items/{target}", headers=h, json=item_body(w, area, name=f"Renamed {area}"))
    assert edit.status_code == (200 if may_manage(who, area) else 403), edit.text
    gone = await client.delete(f"/api/items/{target}", headers=h)
    assert gone.status_code == (204 if may_manage(who, area) else 403), gone.text


async def test_an_item_cannot_be_slipped_under_a_sub_category_of_the_other_team(client):
    w = await build_s3_world()
    op = await login(client, w, "op_it")
    # an IT category with the Non-IT team's sub-category: refused for the area, not just as a mismatch
    mixed = await client.post("/api/items", headers=op, json=item_body(w, "it", name="Sneaky", subcategory_id=w["chair"]))
    assert mixed.status_code == 403 and mixed.json()["detail"].startswith(NONIT_ONLY)
    foreign = await client.post("/api/items", headers=op, json=item_body(w, "nonit", name="Desk"))
    assert foreign.status_code == 403 and foreign.json()["detail"].startswith(NONIT_ONLY)
    # an admin who handles both still gets the ordinary mismatch answer
    both = await client.post("/api/items", headers=await login(client, w, "admin"),
                             json=item_body(w, "it", name="Sneaky", subcategory_id=w["chair"]))
    assert both.status_code == 422 and "does not belong" in both.json()["detail"]


async def test_an_it_admin_cannot_move_an_item_into_the_other_team(client):
    w = await build_s3_world()
    h = await login(client, w, "admin_it")
    resp = await client.put(f"/api/items/{w['item_it']}", headers=h,
                            json=item_body(w, "nonit", name="Laptop", confirm_domain_change=True))
    assert resp.status_code == 403 and resp.json()["detail"].startswith(NONIT_ONLY)


async def test_moving_an_item_to_the_other_team_needs_both_areas_and_confirmation(client):
    w = await build_s3_world()
    h = await login(client, w, "admin")
    unconfirmed = await client.put(f"/api/items/{w['item_it']}", headers=h, json=item_body(w, "nonit", name="Laptop"))
    assert unconfirmed.status_code == 422 and unconfirmed.json()["detail"].startswith(
        "Moving Laptop from the IT team to the Admin / Non-IT team changes who handles it")
    assert await _audit(w["item_it"]) == []
    moved = await client.put(f"/api/items/{w['item_it']}", headers=h, json=item_body(w, "nonit", name="Laptop", confirm_domain_change=True))
    assert moved.status_code == 200 and moved.json()["work_area"] == "NON_IT"
    assert await _audit(w["item_it"]) == [
        ("category", "Computers", "Furniture"), ("subcategory", "Laptop", "Chair"), ("work_area", "IT", "Non-IT")]


async def test_item_edits_and_removal_are_audited_field_by_field(client):
    w = await build_s3_world()
    h = await login(client, w, "admin_it")
    edit = await client.put(f"/api/items/{w['item_it']}", headers=h, json=item_body(
        w, "it", name="Laptop 14 inch", serial_required=False, default_brand_id=w["brand"], default_warranty_years=3))
    assert edit.status_code == 200, edit.text
    assert (await client.delete(f"/api/items/{w['item_it']}", headers=h)).status_code == 204
    assert await _audit(w["item_it"]) == [
        ("name", "Laptop", "Laptop 14 inch"), ("serial_required", "yes", "no"), ("default_brand", None, "Dell"),
        ("default_warranty_years", None, "3"), ("active", "yes", "no")]


async def test_a_refused_item_edit_writes_no_audit_row(client):
    w = await build_s3_world()
    h = await login(client, w, "admin")
    dup = await client.put(f"/api/items/{w['item_it']}", headers=h, json=item_body(w, "it", name="office chair"))
    assert dup.status_code == 422 and "already exists" in dup.json()["detail"]
    assert await _audit(w["item_it"]) == []


async def test_the_item_list_carries_its_work_area_and_names(client):
    w = await build_s3_world()
    rows = {r["name"]: r for r in (await client.get("/api/items", headers=await login(client, w, "op_nonit"))).json()}
    assert rows["Laptop"]["work_area"] == "IT"
    assert rows["Laptop"]["category_name"] == "Computers" and rows["Laptop"]["subcategory_name"] == "Laptop"
    assert rows["Office Chair"]["work_area"] == "NON_IT" and rows["Office Chair"]["category_name"] == "Furniture"
    added = await client.post("/api/items", headers=await login(client, w, "op_nonit"), json=item_body(w, "nonit", name="Desk"))
    assert added.status_code == 201 and added.json()["work_area"] == "NON_IT" and added.json()["subcategory_name"] == "Chair"


async def test_item_rules_seed_and_erp_screens_stay_with_the_head_office_admin(client):
    w = await build_s3_world()
    for who in ("admin", "op_it"):
        h = await login(client, w, who)
        assert (await client.post("/api/items/seed-from-subcategories", headers=h)).status_code == 403
        assert (await client.post("/api/items/maps", headers=h, json={
            "item_id": w["item_it"], "match_type": "CODE", "erp_item_code": "CT1"})).status_code == 403
        assert (await client.get("/api/items/maps", headers=h)).status_code == 403
        assert (await client.delete("/api/items/maps/1", headers=h)).status_code == 403
        assert (await client.get("/api/items/codes", headers=h)).status_code == 403
        assert (await client.get("/api/items/articles", headers=h)).status_code == 403


async def test_an_operator_cannot_add_an_item_under_a_deactivated_category(client):
    w = await build_s3_world()
    async with SessionLocal() as s:
        dead_sub = AssetSubcategory(category_id=w["dead_cat"], code="DS", name="Dead sub")
        s.add(dead_sub)
        await s.commit()
        dead_sub_id = dead_sub.id
        assert (await s.get(AssetCategory, w["dead_cat"])).asset_domain == "IT"
    resp = await client.post("/api/items", headers=await login(client, w, "op_it"),
                             json={"name": "Old thing", "category_id": w["dead_cat"], "subcategory_id": dead_sub_id})
    assert resp.status_code == 422 and "no longer active" in resp.json()["detail"]
