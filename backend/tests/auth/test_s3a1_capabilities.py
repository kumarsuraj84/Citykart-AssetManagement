"""S3a-1: GET /api/auth/capabilities tells the screens what the signed-in person
may create and manage -- and it must agree with what the endpoints really
allow (the agreement test asks, then tries every action)."""
import pytest

from tests.core.s3a1_world import ROLES, build_s3_world, item_body, login

EXPECTED = {
    #             label                     head  areas               create small  item   category  manage dom  change  users
    "owner":       ("Head-office Admin",     True,  ["IT", "NON_IT"],  True,         True,  True,     True,       True,   True),
    "admin":       ("Full Admin",            False, ["IT", "NON_IT"],  True,         True,  True,     True,       True,   True),
    "admin_it":    ("Full Admin",            False, ["IT"],            True,         True,  True,     True,       False,  True),
    "admin_nonit": ("Full Admin",            False, ["NON_IT"],        True,         True,  True,     True,       False,  True),
    "op_it":       ("Can Add & Move Assets", False, ["IT"],            True,         True,  False,    False,      False,  False),
    "op_nonit":    ("Can Add & Move Assets", False, ["NON_IT"],        True,         True,  False,    False,      False,  False),
    "viewer_it":   ("View Only",             False, ["IT"],            False,        False, False,    False,      False,  False),
    "self":        ("Own Assets Only",       False, [],                False,        False, False,    False,      False,  False),
}
AREA_LABELS = {("IT", "NON_IT"): "IT and Non-IT", ("IT",): "IT", ("NON_IT",): "Non-IT", (): "Own assets only"}
HEAVY = ("vendor", "brand", "cost_centre", "company", "location", "department", "custom_field", "bundle", "code_rule",
         "item_rules", "erp_setup", "imports", "erp_vendor_unlink")


@pytest.mark.parametrize("who", ROLES)
async def test_capabilities_for_every_kind_of_login(client, who):
    w = await build_s3_world()
    resp = await client.get("/api/auth/capabilities", headers=await login(client, w, who))
    assert resp.status_code == 200, resp.text
    caps = resp.json()
    label, head, areas, small, item, category, manage_domain, change, users = EXPECTED[who]
    assert caps["role_label"] == label
    assert caps["is_head_office_admin"] is head
    assert caps["work_areas"] == areas
    assert caps["work_area_label"] == AREA_LABELS[tuple(areas)]
    assert caps["can_create"] == {"vendor": small, "brand": small, "cost_centre": small, "stock_room": small,
                                  "item": item, "category": category, "sub_category": category}
    assert caps["item_create_work_areas"] == (areas if item else [])
    assert caps["domain_manage_work_areas"] == (areas if manage_domain else [])
    manage = caps["can_manage"]
    assert manage["category"] is manage["sub_category"] is manage["item"] is manage_domain
    assert manage["change_work_area"] is change
    assert manage["users"] is users
    assert manage["erp_vendor_link"] is small
    assert {key: manage[key] for key in HEAVY} == {key: head for key in HEAVY}
    expected_companies = sorted([w["co"], w["co_b"]]) if who in ("owner", "admin", "admin_it", "admin_nonit") else [w["co"]]
    assert caps["company_ids"] == expected_companies
    assert caps["role"] == ("ADMIN" if who in ("owner", "admin", "admin_it", "admin_nonit") else
                            {"op_it": "OPERATOR", "op_nonit": "OPERATOR", "viewer_it": "VIEWER", "self": "SELF_SERVICE"}[who])


async def test_capabilities_need_a_login(client):
    assert (await client.get("/api/auth/capabilities")).status_code == 401


def _ok(resp) -> bool:
    assert resp.status_code in (200, 201, 204, 403), (resp.status_code, resp.text)
    return resp.status_code != 403


@pytest.mark.parametrize("who", ROLES)
async def test_capabilities_agree_with_what_the_endpoints_allow(client, who):
    """Ask first, then try each action: every 'yes' must succeed and every 'no'
    must be refused (403) by the server."""
    w = await build_s3_world()
    h = await login(client, w, who)
    caps = (await client.get("/api/auth/capabilities", headers=h)).json()
    create, manage = caps["can_create"], caps["can_manage"]
    area_of = {"IT": "it", "NON_IT": "nonit"}
    mismatches = []

    def check(name, expected, resp):
        if _ok(resp) != expected:
            mismatches.append(f"{name}: capabilities say {expected}, server answered {resp.status_code} {resp.text}")

    # small records, added in the flow
    check("create.vendor", create["vendor"], await client.post("/api/masters/vendors", headers=h, json={"name": "Agree Vendor"}))
    check("create.brand", create["brand"], await client.post("/api/masters/brands", headers=h, json={"name": "Agree Brand"}))
    check("create.cost_centre", create["cost_centre"], await client.post(
        "/api/masters/cost-centers", headers=h, json={"name": "Agree CC", "company_id": caps["company_ids"][0] if caps["company_ids"] else w["co"]}))
    check("create.stock_room", create["stock_room"], await client.post(
        "/api/stock-rooms", headers=h, json={"name": "Agree Room", "company_id": w["co"], "location_id": w["loc"]}))
    # domain-owned records, per work area
    for domain in ("IT", "NON_IT"):
        area = area_of[domain]
        check(f"create.item.{domain}", domain in caps["item_create_work_areas"],
              await client.post("/api/items", headers=h, json=item_body(w, area, name=f"Agree {domain}")))
        check(f"create.category.{domain}", create["category"] and domain in caps["domain_manage_work_areas"],
              await client.post("/api/masters/categories", headers=h, json={"code": f"AG{domain}"[:20], "name": f"Agree {domain}", "asset_domain": domain}))
        check(f"create.sub_category.{domain}", create["sub_category"] and domain in caps["domain_manage_work_areas"],
              await client.post("/api/masters/subcategories", headers=h, json={"category_id": w[area], "code": "AGS", "name": "Agree sub"}))
        check(f"manage.category.{domain}", manage["category"] and domain in caps["domain_manage_work_areas"],
              await client.put(f"/api/masters/categories/{w[area]}", headers=h, json={"name": f"Group {domain}", "asset_domain": domain}))
        check(f"manage.item.{domain}", manage["item"] and domain in caps["domain_manage_work_areas"],
              await client.put(f"/api/items/{w['item_' + area]}", headers=h, json=item_body(w, area, name=f"Thing {domain}")))
    # head-office-only edits and heavy setup
    check("manage.vendor", manage["vendor"], await client.put(f"/api/masters/vendors/{w['vendor']}", headers=h, json={"name": "Renamed V"}))
    check("manage.brand", manage["brand"], await client.put(f"/api/masters/brands/{w['brand']}", headers=h, json={"name": "Renamed B"}))
    check("manage.cost_centre", manage["cost_centre"], await client.put(f"/api/masters/cost-centers/{w['cc']}", headers=h, json={"name": "Renamed C"}))
    check("manage.company", manage["company"], await client.post("/api/masters/companies", headers=h, json={"code": "AGC", "name": "Agree Co"}))
    check("manage.location", manage["location"], await client.post(
        "/api/masters/locations", headers=h, json={"company_id": w["co"], "code": "AGL", "name": "Agree Loc"}))
    check("manage.department", manage["department"], await client.post("/api/masters/departments", headers=h, json={"name": "Agree Dept"}))
    check("manage.custom_field", manage["custom_field"], await client.post(
        "/api/masters/custom-fields", headers=h, json={"field_key": "agree", "label": "Agree", "field_type": "text"}))
    check("manage.code_rule", manage["code_rule"], await client.post(
        "/api/code-rules", headers=h, json={"company_id": w["co"], "prefix_template": "AG/{category.code}/"}))
    check("manage.item_rules", manage["item_rules"], await client.get("/api/items/maps", headers=h))
    check("manage.users", manage["users"], await client.get(f"/api/asset-users/{w['employee']}/company-access", headers=h))
    # moving a category to the other team (last: it changes the IT category)
    check("manage.change_work_area", manage["change_work_area"], await client.put(
        f"/api/masters/categories/{w['it']}", headers=h,
        json={"name": "Computers", "asset_domain": "NON_IT", "confirm_domain_change": True}))
    assert mismatches == []
