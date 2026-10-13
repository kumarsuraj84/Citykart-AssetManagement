"""S3a-1: Categories and Sub-categories belong to a work area (IT / Non-IT).
An ADMIN manages them inside their own work area; a both-area ADMIN and the
head-office admin manage both; operators, viewers and self-service logins
none. Moving a Category to the other work area needs someone who handles both,
an explicit confirmation, and leaves an append-only audit trail."""
import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.assets.models import Asset
from app.core.db import SessionLocal
from app.masters.models import AssetCategory, MasterAudit
from tests.core.s0_world import make_asset
from tests.core.s3a1_world import ROLES, build_s3_world, login

IT_ONLY = "This belongs to the IT team; you can only work with Non-IT items."
NONIT_ONLY = "This belongs to the Admin / Non-IT team; you can only work with IT items."


def may_manage(who: str, area: str) -> bool:
    return who in ("owner", "admin") or (who, area) in (("admin_it", "it"), ("admin_nonit", "nonit"))


async def _audit_rows(entity: str, entity_id: int) -> list[MasterAudit]:
    async with SessionLocal() as s:
        return list((await s.execute(
            select(MasterAudit).where(MasterAudit.entity == entity, MasterAudit.entity_id == entity_id).order_by(MasterAudit.id)
        )).scalars().all())


@pytest.mark.parametrize("area", ["it", "nonit"])
@pytest.mark.parametrize("who", ROLES)
async def test_who_may_manage_categories_and_sub_categories_of_each_work_area(client, who, area):
    w = await build_s3_world()
    h = await login(client, w, who)
    allowed = may_manage(who, area)
    domain = "IT" if area == "it" else "NON_IT"
    cat_id, sub_id = w[area], w["lap" if area == "it" else "chair"]

    calls = [
        await client.post("/api/masters/categories", headers=h, json={"code": "NEWC", "name": "New group", "asset_domain": domain}),
        await client.post("/api/masters/subcategories", headers=h, json={"category_id": cat_id, "code": "NEWS", "name": "New kind"}),
        await client.put(f"/api/masters/categories/{cat_id}", headers=h, json={"name": "Renamed group", "asset_domain": domain}),
        await client.put(f"/api/masters/subcategories/{sub_id}", headers=h, json={"name": "Renamed kind"}),
        await client.delete(f"/api/masters/subcategories/{sub_id}", headers=h),
        await client.delete(f"/api/masters/categories/{cat_id}", headers=h),
    ]
    for resp in calls:
        if allowed:
            assert resp.status_code in (200, 201, 204), resp.text
        else:
            assert resp.status_code == 403, resp.text


async def test_the_refusal_names_the_other_team_in_plain_words(client):
    w = await build_s3_world()
    it_admin = await login(client, w, "admin_it")
    sub = await client.post("/api/masters/subcategories", headers=it_admin, json={"category_id": w["nonit"], "code": "X", "name": "X"})
    assert sub.status_code == 403 and sub.json()["detail"].startswith(NONIT_ONLY)
    nonit_admin = await login(client, w, "admin_nonit")
    cat = await client.post("/api/masters/categories", headers=nonit_admin, json={"code": "X", "name": "X", "asset_domain": "IT"})
    assert cat.status_code == 403 and cat.json()["detail"].startswith(IT_ONLY)
    op = await login(client, w, "op_it")
    refused = await client.post("/api/masters/categories", headers=op, json={"code": "X", "name": "X", "asset_domain": "IT"})
    assert refused.json()["detail"] == ("Only an admin can add or change categories and sub-categories. "
                                        "Ask an admin or the head-office admin.")


async def test_moving_a_category_to_the_other_team_needs_confirmation_and_is_audited(client):
    w = await build_s3_world()
    h = await login(client, w, "admin")
    body = {"name": "Computers", "asset_domain": "NON_IT"}
    unconfirmed = await client.put(f"/api/masters/categories/{w['it']}", headers=h, json=body)
    assert unconfirmed.status_code == 422
    assert unconfirmed.json()["detail"] == (
        "Moving Computers from the IT team to the Admin / Non-IT team also moves its 1 sub-category and 1 Item, "
        "and the Admin / Non-IT team will handle the assets added under it from now on (assets already in the "
        "register keep their work area). Confirm the change to go ahead.")
    async with SessionLocal() as s:
        assert (await s.get(AssetCategory, w["it"])).asset_domain == "IT"
    assert await _audit_rows("category", w["it"]) == []

    moved = await client.put(f"/api/masters/categories/{w['it']}", headers=h, json={**body, "confirm_domain_change": True})
    assert moved.status_code == 200 and moved.json()["asset_domain"] == "NON_IT"
    rows = await _audit_rows("category", w["it"])
    assert [(r.field, r.old_value, r.new_value, r.actor_id) for r in rows] == [("work_area", "IT", "Non-IT", w["admin"])]


async def test_only_someone_handling_both_areas_may_move_a_category(client):
    w = await build_s3_world()
    body = {"name": "Computers", "asset_domain": "NON_IT", "confirm_domain_change": True}
    it_admin = await client.put(f"/api/masters/categories/{w['it']}", headers=await login(client, w, "admin_it"), json=body)
    assert it_admin.status_code == 403
    assert it_admin.json()["detail"].startswith("Only someone who handles both IT and Non-IT, or the head-office admin")
    owner = await client.put(f"/api/masters/categories/{w['it']}", headers=await login(client, w, "owner"), json=body)
    assert owner.status_code == 200 and owner.json()["asset_domain"] == "NON_IT"


async def test_assets_already_in_the_register_keep_their_work_area(client):
    w = await build_s3_world()
    owner = await login(client, w, "owner")
    asset = await make_asset(client, owner, w, "it")
    moved = await client.put(f"/api/masters/categories/{w['it']}", headers=owner,
                             json={"name": "Computers", "asset_domain": "NON_IT", "confirm_domain_change": True})
    assert moved.status_code == 200
    async with SessionLocal() as s:
        assert (await s.get(Asset, asset["id"])).asset_domain == "IT"


async def test_name_changes_and_deactivation_are_audited_and_no_change_writes_nothing(client):
    w = await build_s3_world()
    h = await login(client, w, "admin_nonit")
    same = await client.put(f"/api/masters/categories/{w['nonit']}", headers=h, json={"name": "Furniture", "asset_domain": "NON_IT"})
    assert same.status_code == 200 and await _audit_rows("category", w["nonit"]) == []
    renamed = await client.put(f"/api/masters/categories/{w['nonit']}", headers=h, json={"name": "Furniture & Fixtures", "asset_domain": "NON_IT"})
    assert renamed.status_code == 200
    sub = await client.put(f"/api/masters/subcategories/{w['chair']}", headers=h, json={"name": "Chairs"})
    assert sub.status_code == 200
    assert (await client.delete(f"/api/masters/subcategories/{w['chair']}", headers=h)).status_code == 204
    assert (await client.delete(f"/api/masters/categories/{w['nonit']}", headers=h)).status_code == 204
    cat_rows = await _audit_rows("category", w["nonit"])
    assert [(r.field, r.old_value, r.new_value) for r in cat_rows] == [
        ("name", "Furniture", "Furniture & Fixtures"), ("active", "yes", "no")]
    sub_rows = await _audit_rows("subcategory", w["chair"])
    assert [(r.field, r.old_value, r.new_value) for r in sub_rows] == [("name", "Chair", "Chairs"), ("active", "yes", "no")]
    assert {r.actor_id for r in cat_rows + sub_rows} == {w["admin_nonit"]}


async def test_audit_rows_cannot_be_changed_or_deleted(client):
    w = await build_s3_world()
    h = await login(client, w, "admin")
    await client.put(f"/api/masters/categories/{w['it']}", headers=h, json={"name": "IT Hardware", "asset_domain": "IT"})
    row = (await _audit_rows("category", w["it"]))[0]
    for statement in ("UPDATE master_audit SET new_value = 'tampered' WHERE id = :id", "DELETE FROM master_audit WHERE id = :id"):
        async with SessionLocal() as s:
            with pytest.raises(DBAPIError, match="append-only"):
                await s.execute(text(statement), {"id": row.id})
    assert (await _audit_rows("category", w["it"]))[0].new_value == "IT Hardware"


async def test_a_refused_change_writes_no_audit_row(client):
    w = await build_s3_world()
    h = await login(client, w, "admin_it")
    refused = await client.put(f"/api/masters/categories/{w['nonit']}", headers=h, json={"name": "Hijacked", "asset_domain": "NON_IT"})
    assert refused.status_code == 403
    assert await _audit_rows("category", w["nonit"]) == []
    bad = await client.put(f"/api/masters/categories/{w['it']}", headers=h, json={"name": "Renamed", "asset_domain": "SPACE"})
    assert bad.status_code == 422 and bad.json()["detail"] == "Choose who handles this category: IT or Non-IT."
    assert await _audit_rows("category", w["it"]) == []


async def test_owner_flows_are_unchanged(client):
    w = await build_s3_world()
    h = await login(client, w, "owner")
    cat = await client.post("/api/masters/categories", headers=h, json={"code": "ELEC", "name": "Electricals", "asset_domain": "NON_IT"})
    assert cat.status_code == 201
    sub = await client.post("/api/masters/subcategories", headers=h, json={"category_id": cat.json()["id"], "code": "FAN", "name": "Fan"})
    assert sub.status_code == 201
    dup = await client.post("/api/masters/categories", headers=h, json={"code": "elec", "name": "Again", "asset_domain": "IT"})
    assert dup.status_code == 422 and "already exists" in dup.json()["detail"]
    dead = await client.post("/api/masters/subcategories", headers=h, json={"category_id": w["dead_cat"], "code": "N", "name": "N"})
    assert dead.status_code == 422 and "no longer active" in dead.json()["detail"]
