"""S3a-1: vendors, brands and cost centres may be ADDED in the flow by ADMIN and
OPERATOR (company scope for a cost centre); changing / removing them stays with
the head-office admin. A code left out is made from the name; a new vendor or
brand may not repeat an active one's name."""
import pytest
from sqlalchemy import select

from app.core.db import SessionLocal
from app.masters.models import Brand, CostCenter, Vendor
from tests.core.s3a1_world import ROLES, build_s3_world, login

CAN_ADD = {"owner", "admin", "admin_it", "admin_nonit", "op_it", "op_nonit"}

MASTERS = {
    "vendors": lambda w: {"name": "Acme Traders", "code": "ACME"},
    "brands": lambda w: {"name": "Lenovo", "code": "LNV"},
    "cost-centers": lambda w: {"name": "Warehouse", "code": "WH", "company_id": w["co"]},
}
EXISTING = {"vendors": "vendor", "brands": "brand", "cost-centers": "cc"}


@pytest.mark.parametrize("master", list(MASTERS))
@pytest.mark.parametrize("who", ROLES)
async def test_who_may_add_a_small_master(client, who, master):
    w = await build_s3_world()
    h = await login(client, w, who)
    resp = await client.post(f"/api/masters/{master}", headers=h, json=MASTERS[master](w))
    if who in CAN_ADD:
        assert resp.status_code == 201, resp.text
    else:
        assert resp.status_code == 403
        assert "Ask an admin or the head-office admin" in resp.json()["detail"]


@pytest.mark.parametrize("who", ROLES)
async def test_changing_or_removing_a_small_master_stays_with_the_head_office_admin(client, who):
    w = await build_s3_world()
    h = await login(client, w, who)
    for master in MASTERS:
        target = w[EXISTING[master]]
        edit = await client.put(f"/api/masters/{master}/{target}", headers=h, json={"name": "Renamed"})
        if who == "owner":
            assert edit.status_code == 200, edit.text
        else:
            assert edit.status_code == 403
            assert "Only the head-office admin can change" in edit.json()["detail"]
    for master in MASTERS:
        target = w[EXISTING[master]]
        gone = await client.delete(f"/api/masters/{master}/{target}", headers=h)
        assert gone.status_code == (204 if who == "owner" else 403)


async def test_messages_say_who_can_do_it(client):
    w = await build_s3_world()
    viewer = await client.post("/api/masters/vendors", headers=await login(client, w, "viewer_it"), json={"name": "V"})
    assert viewer.json()["detail"] == "Your access does not allow adding a vendor. Ask an admin or the head-office admin."
    admin = await client.put(f"/api/masters/brands/{w['brand']}", headers=await login(client, w, "admin"), json={"name": "X"})
    assert admin.json()["detail"] == "Only the head-office admin can change brands. Ask the head-office admin to do it."


async def test_a_code_left_out_is_made_from_the_name(client):
    w = await build_s3_world()
    h = await login(client, w, "op_it")
    vendor = await client.post("/api/masters/vendors", headers=h, json={"name": "Vansh Enterprises Pvt. Ltd."})
    assert vendor.status_code == 201, vendor.text
    assert vendor.json()["code"] == "VANSHENTERPRISESPVTLTD"
    brand = await client.post("/api/masters/brands", headers=h, json={"name": "lenovo india", "code": None})
    assert brand.json()["code"] == "LENOVOINDIA"
    cc = await client.post("/api/masters/cost-centers", headers=h, json={"name": "Farukhnagar W/H", "company_id": w["co"]})
    assert cc.status_code == 201 and cc.json()["code"] == "FARUKHNAGARWH"
    odd = await client.post("/api/masters/brands", headers=h, json={"name": "&&&"})
    assert odd.json()["code"] == "BRAND"


async def test_made_codes_never_clash_ignoring_case_and_inactive_rows_count(client):
    w = await build_s3_world()
    async with SessionLocal() as s:
        s.add_all([Brand(code="hp", name="Old HP"), Vendor(code="ACME", name="Old Acme", is_active=False)])
        await s.commit()
    h = await login(client, w, "admin")
    first = await client.post("/api/masters/brands", headers=h, json={"name": "HP"})
    assert first.status_code == 201 and first.json()["code"] == "HP2"           # "hp" is taken, case ignored
    second = await client.post("/api/masters/brands", headers=h, json={"name": "H.P."})
    assert second.json()["code"] == "HP3"
    acme = await client.post("/api/masters/vendors", headers=h, json={"name": "Acme"})
    assert acme.json()["code"] == "ACME2"                                        # a deactivated row still owns its code


async def test_made_codes_respect_the_column_length(client):
    w = await build_s3_world()
    h = await login(client, w, "admin")
    long_name = "Abcdefghijklmnopqrstuvwxyz Brand"
    one = await client.post("/api/masters/brands", headers=h, json={"name": long_name + " One"})
    two = await client.post("/api/masters/brands", headers=h, json={"name": long_name + " Two"})
    assert one.json()["code"] == "ABCDEFGHIJKLMNOPQRST"
    assert two.json()["code"] == "ABCDEFGHIJKLMNOPQRS2"
    assert all(len(r.json()["code"]) <= 20 for r in (one, two))
    # a vendor's column allows 100 characters; a made code is kept to 30 to stay readable
    vendor = await client.post("/api/masters/vendors", headers=h, json={"name": "Y" * 150})
    assert vendor.status_code == 201 and vendor.json()["code"] == "Y" * 30


async def test_cost_centre_codes_are_made_per_company(client):
    w = await build_s3_world()
    h = await login(client, w, "admin")
    a = await client.post("/api/masters/cost-centers", headers=h, json={"name": "Head Office", "company_id": w["co_b"]})
    b = await client.post("/api/masters/cost-centers", headers=h, json={"name": "Head Office", "company_id": w["co"]})
    # Company A already has code HO ("Head Office"), but HEADOFFICE is free in both companies.
    assert a.json()["code"] == "HEADOFFICE" and b.json()["code"] == "HEADOFFICE"
    c = await client.post("/api/masters/cost-centers", headers=h, json={"name": "head office", "company_id": w["co"]})
    assert c.json()["code"] == "HEADOFFICE2"


async def test_an_explicit_code_works_as_before(client):
    w = await build_s3_world()
    h = await login(client, w, "op_it")
    ok = await client.post("/api/masters/brands", headers=h, json={"name": "Samsung", "code": "  sam  "})
    assert ok.status_code == 201 and ok.json()["code"] == "sam"
    dup = await client.post("/api/masters/brands", headers=h, json={"name": "Samsung Two", "code": "SAM"})
    assert dup.status_code == 422 and "already exists" in dup.json()["detail"]
    blank = await client.post("/api/masters/brands", headers=h, json={"name": "Blank", "code": "  "})
    assert blank.status_code == 422 and blank.json()["detail"] == "Code cannot be blank."


async def test_a_new_vendor_or_brand_may_not_repeat_an_active_name(client):
    w = await build_s3_world()
    h = await login(client, w, "op_it")
    vendor = await client.post("/api/masters/vendors", headers=h, json={"name": "  good VENDOR "})
    assert vendor.status_code == 422 and vendor.json()["detail"] == "A vendor with this name already exists."
    brand = await client.post("/api/masters/brands", headers=h, json={"name": "dell"})
    assert brand.status_code == 422 and brand.json()["detail"] == "A brand with this name already exists."
    # a deactivated vendor's name may be used again (it can no longer be chosen)
    again = await client.post("/api/masters/vendors", headers=h, json={"name": "Closed Vendor"})
    assert again.status_code == 201, again.text
    # cost centres are not checked by name
    cc = await client.post("/api/masters/cost-centers", headers=h, json={"name": "Head Office", "company_id": w["co"]})
    assert cc.status_code == 201


async def test_old_rows_with_the_same_name_are_left_alone(client):
    w = await build_s3_world()
    async with SessionLocal() as s:
        twins = [Vendor(code="TW1", name="Twin Traders"), Vendor(code="TW2", name="twin traders")]
        s.add_all(twins)
        await s.commit()
        first_id = twins[0].id
    owner = await login(client, w, "owner")
    listed = [v["code"] for v in (await client.get("/api/masters/vendors", headers=owner)).json()]
    assert {"TW1", "TW2"} <= set(listed)
    edit = await client.put(f"/api/masters/vendors/{first_id}", headers=owner, json={"name": "Twin Traders"})
    assert edit.status_code == 200


async def test_a_cost_centre_is_added_only_inside_the_callers_companies(client):
    w = await build_s3_world()
    op = await login(client, w, "op_it")
    other = await client.post("/api/masters/cost-centers", headers=op, json={"name": "X", "company_id": w["co_b"]})
    assert other.status_code == 403
    assert other.json()["detail"] == ("You can only add a cost centre for your own company. "
                                      "Ask the head-office admin to add it for another company.")
    op_b = await login(client, w, "op_b")
    assert (await client.post("/api/masters/cost-centers", headers=op_b, json={"name": "B", "company_id": w["co_b"]})).status_code == 201
    assert (await client.post("/api/masters/cost-centers", headers=op_b, json={"name": "A", "company_id": w["co"]})).status_code == 403
    admin = await login(client, w, "admin")                       # an ADMIN works in every company
    assert (await client.post("/api/masters/cost-centers", headers=admin, json={"name": "B2", "company_id": w["co_b"]})).status_code == 201
    async with SessionLocal() as s:
        names = set((await s.execute(select(CostCenter.name).where(CostCenter.company_id == w["co_b"]))).scalars().all())
    assert {"B", "B2"} <= names and "X" not in names


async def test_a_deactivated_company_takes_no_new_cost_centre(client):
    w = await build_s3_world()
    async with SessionLocal() as s:
        from app.masters.models import Company
        company = await s.get(Company, w["co_b"])
        company.is_active = False
        await s.commit()
    resp = await client.post("/api/masters/cost-centers", headers=await login(client, w, "admin"),
                             json={"name": "Late", "company_id": w["co_b"]})
    assert resp.status_code == 422 and "no longer active" in resp.json()["detail"]
