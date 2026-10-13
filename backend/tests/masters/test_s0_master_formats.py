"""S0.10 / S0.5 / S0.6 on masters (audit B-14): GSTIN and email formats,
codes unique ignoring case and spaces for NEW records (existing mixed-case rows
are untouched), blank codes/names refused, and no new row under a deactivated
parent."""
from app.core.db import SessionLocal
from app.masters.models import Brand, Vendor
from tests.core.s0_world import build_world, login


async def test_vendor_gstin_and_email_must_be_valid_when_given(client):
    w = await build_world()
    h = await login(client, w, "owner")
    bad_gstin = await client.post("/api/masters/vendors", headers=h, json={"code": "V1", "name": "V One", "gstin": "12345"})
    assert bad_gstin.status_code == 422 and bad_gstin.json()["detail"].startswith("GSTIN is not valid.")
    bad_email = await client.post("/api/masters/vendors", headers=h, json={"code": "V1", "name": "V One", "contact_email": "nobody"})
    assert bad_email.status_code == 422 and bad_email.json()["detail"] == "Contact email is not a valid email address."
    ok = await client.post("/api/masters/vendors", headers=h, json={
        "code": "V1", "name": "V One", "gstin": "07aaaaa0000a1z5", "contact_email": "sales@vone.in"})
    assert ok.status_code == 201 and ok.json()["gstin"] == "07AAAAA0000A1Z5"


async def test_a_stored_legacy_gstin_does_not_block_an_unrelated_edit(client):
    w = await build_world()
    h = await login(client, w, "owner")
    async with SessionLocal() as s:
        legacy = Vendor(code="OLDV", name="Old Vendor", gstin="LEGACY")
        s.add(legacy)
        await s.commit()
        legacy_id = legacy.id
    edit = await client.put(f"/api/masters/vendors/{legacy_id}", headers=h, json={"name": "Old Vendor Pvt Ltd", "gstin": "LEGACY"})
    assert edit.status_code == 200 and edit.json()["gstin"] == "LEGACY"
    changed = await client.put(f"/api/masters/vendors/{legacy_id}", headers=h, json={"name": "Old Vendor Pvt Ltd", "gstin": "STILLBAD"})
    assert changed.status_code == 422


async def test_new_codes_are_unique_ignoring_case_and_spaces_but_old_rows_stay(client):
    w = await build_world()
    h = await login(client, w, "owner")
    dup = await client.post("/api/masters/brands", headers=h, json={"code": " s0br ", "name": "Dell again"})
    assert dup.status_code == 422 and "already exists" in dup.json()["detail"]
    async with SessionLocal() as s:              # rows that already differ only by case are left as they are
        s.add_all([Brand(code="it", name="lower"), Brand(code="IT", name="upper")])
        await s.commit()
    listed = {b["code"] for b in (await client.get("/api/masters/brands", headers=h)).json()}
    assert {"it", "IT"} <= listed
    cc = await client.post("/api/masters/cost-centers", headers=h, json={"company_id": w["co"], "code": "ho", "name": "Dup"})
    assert cc.status_code == 422 and "already exists" in cc.json()["detail"]
    other_company = await client.post("/api/masters/cost-centers", headers=h, json={"company_id": w["co_b"], "code": "WH", "name": "WH"})
    assert other_company.status_code == 201
    trimmed = await client.post("/api/masters/brands", headers=h, json={"code": "  HP  ", "name": "HP"})
    assert trimmed.status_code == 201 and trimmed.json()["code"] == "HP"


async def test_blank_codes_and_names_and_long_text_are_refused(client):
    w = await build_world()
    h = await login(client, w, "owner")
    blank_code = await client.post("/api/masters/brands", headers=h, json={"code": "  ", "name": "X"})
    assert blank_code.status_code == 422 and blank_code.json()["detail"] == "Code cannot be blank."
    blank_name = await client.post("/api/masters/departments", headers=h, json={"name": ""})
    assert blank_name.status_code == 422 and blank_name.json()["detail"] == "Name cannot be blank."
    long_code = await client.post("/api/masters/brands", headers=h, json={"code": "C" * 21, "name": "X"})
    assert long_code.status_code == 422 and long_code.json()["detail"] == "Code is too long (max 20 characters)."


async def test_no_new_row_under_a_deactivated_parent(client):
    w = await build_world()
    h = await login(client, w, "owner")
    sub = await client.post("/api/masters/subcategories", headers=h, json={"category_id": w["dead_cat"], "code": "NEW", "name": "New"})
    assert sub.status_code == 422 and "no longer active" in sub.json()["detail"]
