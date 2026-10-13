"""S6 (S0 observation): an ADMIN limited to one work area may not change the login, access level or work area
of someone whose current work area is wider than their own; other details stay editable."""
from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from tests.core.s0_world import build_world, login


async def _user(user_id: int) -> AssetUser:
    async with SessionLocal() as s:
        return await s.get(AssetUser, user_id)


async def test_a_one_area_admin_cannot_change_access_of_someone_wider(client):
    w = await build_world()
    h = await login(client, w, "admin_it")
    for target, change in (("admin", {"login_enabled": False}), ("admin", {"role": "VIEWER"}),
                           ("admin", {"allowed_asset_domains": "IT"}), ("op_both", {"role": "VIEWER"}),
                           ("op_both", {"login_enabled": False}), ("op_both", {"primary_asset_domain": "IT"})):
        resp = await client.put(f"/api/asset-users/{w[target]}", headers=h, json=change)
        assert resp.status_code == 403, (target, change)
        name = "Ordinary Admin" if target == "admin" else "Both Operator"
        assert resp.json()["detail"] == (
            f"{name} works in a wider work area than yours (you handle only IT work), so you cannot change their "
            "login, access level or work area. Ask the head-office admin.")
    admin = await _user(w["admin"])
    assert (admin.login_enabled, admin.role, admin.allowed_asset_domains) == (True, "ADMIN", None)


async def test_other_details_and_unchanged_values_can_still_be_sent(client):
    w = await build_world()
    h = await login(client, w, "admin_it")
    phone = await client.put(f"/api/asset-users/{w['admin']}", headers=h, json={"phone": "99999"})
    assert phone.status_code == 200 and phone.json()["phone"] == "99999"
    same = await client.put(f"/api/asset-users/{w['op_both']}", headers=h, json={
        "role": "OPERATOR", "login_enabled": True, "allowed_asset_domains": "BOTH", "name": "Both Operator Renamed"})
    assert same.status_code == 200 and same.json()["name"] == "Both Operator Renamed"          # "BOTH" = unset


async def test_people_of_the_admins_own_area_and_wider_editors_are_unaffected(client):
    w = await build_world()
    own_area = await client.put(f"/api/asset-users/{w['op_it']}", headers=await login(client, w, "admin_it"),
                                json={"role": "VIEWER"})
    assert own_area.status_code == 200 and own_area.json()["role"] == "VIEWER"
    for who in ("admin", "owner"):
        resp = await client.put(f"/api/asset-users/{w['op_both']}", headers=await login(client, w, who),
                                json={"allowed_asset_domains": "NON_IT"})
        assert resp.status_code == 200, who
    owner_target = await client.put(f"/api/asset-users/{w['owner2']}", headers=await login(client, w, "admin"), json={"phone": "1"})
    assert owner_target.status_code == 403 and owner_target.json()["detail"] == (
        "Only a head-office admin can change a head-office admin account.")
