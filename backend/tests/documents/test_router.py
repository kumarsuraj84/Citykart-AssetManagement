import io
from datetime import date
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.assets.service import procure_assets
from app.documents.service import MAX_SIZE_BYTES
from app.masters.models import Company, CostCenter, AssetCategory, AssetSubcategory, Location, Department
from app.holders.models import Holder
from app.numbering.models import CodeRule


async def test_upload_and_list_document(client, tmp_path, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))

    async with SessionLocal() as session:
        co = Company(code="CKS-DOC1", name="Doc Test Co")
        cat = AssetCategory(code="IT-DOC1", name="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO01", name="HO")
        loc = Location(code="HO-DOC1", name="HO")
        dept = Department(name="IT-DOC1")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = Holder(company_id=co.id, emp_code="ITSTOCK-DOC1", name="IT Stock-HO", holder_type="IT_STOCK",
                        location_id=loc.id, department_id=dept.id, role="HOLDER")
        it_admin = Holder(company_id=co.id, emp_code="ITA-DOC1", name="IT Admin", holder_type="EMPLOYEE",
                           location_id=loc.id, department_id=dept.id, role="ADMIN",
                           password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                         suffix_template="", start_number=1, pad_width=0)
        session.add_all([stock, it_admin, rule])
        await session.commit()
        assets = await procure_assets(session, {
            "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Doc Laptop", "purchase_date": date(2025, 12, 10), "initial_holder_id": stock.id,
        }, quantity=1, actor=it_admin)
        await session.commit()
        asset_id = assets[0].id

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": "ITA-DOC1", "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    file_bytes = io.BytesIO(b"%PDF-1.4 fake invoice content")
    upload_resp = await client.post(
        f"/api/assets/{asset_id}/documents",
        files={"file": ("invoice.pdf", file_bytes, "application/pdf")},
        data={"doc_type": "invoice"},
        headers=headers,
    )
    assert upload_resp.status_code == 201

    list_resp = await client.get(f"/api/assets/{asset_id}/documents", headers=headers)
    assert len(list_resp.json()) == 1
    assert list_resp.json()[0]["doc_type"] == "invoice"

    doc_id = list_resp.json()[0]["id"]
    download_resp = await client.get(f"/api/documents/{doc_id}/download", headers=headers)
    assert download_resp.status_code == 200
    assert download_resp.content.startswith(b"%PDF")

    # Self-review: the stored filename on disk must be a random UUID, never the
    # user-supplied "invoice.pdf" -- guards against path traversal / collisions.
    import re
    from pathlib import Path
    stored_files = list(Path(tmp_path).rglob("*.pdf"))
    assert len(stored_files) == 1
    assert stored_files[0].name != "invoice.pdf"
    assert re.fullmatch(r"[0-9a-f-]{36}\.pdf", stored_files[0].name)


async def _setup_asset(session, co_code="CKS-DOC2"):
    """Shared fixture-style setup for the size/extension/scope tests below."""
    co = Company(code=co_code, name="Doc Test Co 2")
    cat = AssetCategory(code=f"IT-{co_code}", name="IT")
    session.add_all([co, cat])
    await session.flush()
    sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
    cc = CostCenter(company_id=co.id, code="HO01", name="HO")
    loc = Location(code=f"HO-{co_code}", name="HO")
    dept = Department(name=f"IT-{co_code}")
    session.add_all([sub, cc, loc, dept])
    await session.flush()
    stock = Holder(company_id=co.id, emp_code=f"ITSTOCK-{co_code}", name="IT Stock-HO", holder_type="IT_STOCK",
                    location_id=loc.id, department_id=dept.id, role="HOLDER")
    it_admin = Holder(company_id=co.id, emp_code=f"ITA-{co_code}", name="IT Admin", holder_type="EMPLOYEE",
                       location_id=loc.id, department_id=dept.id, role="ADMIN",
                       password_hash=hash_password("Passw0rd!"), must_change_password=False)
    other_employee = Holder(company_id=co.id, emp_code=f"EMP-{co_code}", name="Other Employee", holder_type="EMPLOYEE",
                             location_id=loc.id, department_id=dept.id, role="HOLDER",
                             password_hash=hash_password("Passw0rd!"), must_change_password=False)
    rule = CodeRule(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                     suffix_template="", start_number=1, pad_width=0)
    session.add_all([stock, it_admin, other_employee, rule])
    await session.commit()
    assets = await procure_assets(session, {
        "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
        "description": "Doc Laptop 2", "purchase_date": date(2025, 12, 10), "initial_holder_id": stock.id,
    }, quantity=1, actor=it_admin)
    await session.commit()
    return co, it_admin, other_employee, assets[0].id


async def test_oversized_file_is_rejected(client, tmp_path, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))

    async with SessionLocal() as session:
        co, it_admin, _other, asset_id = await _setup_asset(session, "CKS-DOC-SIZE")

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": it_admin.emp_code, "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    oversized = io.BytesIO(b"0" * (10 * 1024 * 1024 + 1))
    upload_resp = await client.post(
        f"/api/assets/{asset_id}/documents",
        files={"file": ("big.pdf", oversized, "application/pdf")},
        data={"doc_type": "invoice"},
        headers=headers,
    )
    assert upload_resp.status_code == 422

    list_resp = await client.get(f"/api/assets/{asset_id}/documents", headers=headers)
    assert list_resp.json() == []


async def test_oversized_upload_is_rejected_via_bounded_read(client, tmp_path, monkeypatch):
    """Regression test for the fix-round-1 finding: the upload endpoint used to do a
    single unbounded `await file.read()` before checking MAX_SIZE_BYTES, so an
    arbitrarily large body would be fully buffered in memory before rejection (a DoS
    vector). It now reads in fixed-size chunks and aborts the instant the running
    total exceeds the limit. This sends 2x the limit -- comfortably more than the
    single-chunk-over-the-line case `test_oversized_file_is_rejected` already covers
    -- to make sure the chunked path is what's actually being exercised and that a
    much-too-large body still gets a clean, prompt 422 rather than hanging or
    erroring some other way."""
    from app.core.config import settings
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))

    async with SessionLocal() as session:
        co, it_admin, _other, asset_id = await _setup_asset(session, "CKS-DOC-BOUND")

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": it_admin.emp_code, "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    huge = io.BytesIO(b"0" * (2 * MAX_SIZE_BYTES))
    upload_resp = await client.post(
        f"/api/assets/{asset_id}/documents",
        files={"file": ("huge.pdf", huge, "application/pdf")},
        data={"doc_type": "invoice"},
        headers=headers,
    )
    assert upload_resp.status_code == 422

    list_resp = await client.get(f"/api/assets/{asset_id}/documents", headers=headers)
    assert list_resp.json() == []


async def test_invalid_doc_type_is_rejected_cleanly(client, tmp_path, monkeypatch):
    """Regression test for the fix-round-1 finding: doc_type used to be accepted as
    any string, so a value over 20 chars would pass the endpoint and then blow up as
    an unhandled 500 against the DB's String(20) column. It's now validated against
    DOC_TYPES up front and rejected with a clean 422."""
    from app.core.config import settings
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))

    async with SessionLocal() as session:
        co, it_admin, _other, asset_id = await _setup_asset(session, "CKS-DOC-TYPE")

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": it_admin.emp_code, "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    file_bytes = io.BytesIO(b"%PDF-1.4 fake invoice content")
    upload_resp = await client.post(
        f"/api/assets/{asset_id}/documents",
        files={"file": ("invoice.pdf", file_bytes, "application/pdf")},
        data={"doc_type": "not_a_real_doc_type_and_way_over_twenty_characters"},
        headers=headers,
    )
    assert upload_resp.status_code == 422

    list_resp = await client.get(f"/api/assets/{asset_id}/documents", headers=headers)
    assert list_resp.json() == []


async def test_disallowed_extension_is_rejected(client, tmp_path, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))

    async with SessionLocal() as session:
        co, it_admin, _other, asset_id = await _setup_asset(session, "CKS-DOC-EXT")

    resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": it_admin.emp_code, "password": "Passw0rd!"})
    headers = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    bad_file = io.BytesIO(b"#!/bin/sh\necho hi")
    upload_resp = await client.post(
        f"/api/assets/{asset_id}/documents",
        files={"file": ("script.sh", bad_file, "application/x-sh")},
        data={"doc_type": "other"},
        headers=headers,
    )
    assert upload_resp.status_code == 422

    list_resp = await client.get(f"/api/assets/{asset_id}/documents", headers=headers)
    assert list_resp.json() == []


async def test_holder_out_of_scope_cannot_download(client, tmp_path, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path))

    async with SessionLocal() as session:
        co, it_admin, other_employee, asset_id = await _setup_asset(session, "CKS-DOC-SCOPE")

    admin_resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": it_admin.emp_code, "password": "Passw0rd!"})
    admin_headers = {"Authorization": f"Bearer {admin_resp.json()['access_token']}"}

    file_bytes = io.BytesIO(b"%PDF-1.4 fake invoice content")
    upload_resp = await client.post(
        f"/api/assets/{asset_id}/documents",
        files={"file": ("invoice.pdf", file_bytes, "application/pdf")},
        data={"doc_type": "invoice"},
        headers=admin_headers,
    )
    doc_id = upload_resp.json()["id"]

    # other_employee is a HOLDER-role user who does not currently hold this asset
    # (the IT_STOCK holder does). They must not be able to download its document,
    # even though they know the (guessable, sequential) document id.
    holder_resp = await client.post("/api/auth/login", json={"company_id": co.id, "emp_code": other_employee.emp_code, "password": "Passw0rd!"})
    holder_headers = {"Authorization": f"Bearer {holder_resp.json()['access_token']}"}

    download_resp = await client.get(f"/api/documents/{doc_id}/download", headers=holder_headers)
    assert download_resp.status_code == 404

    list_resp = await client.get(f"/api/assets/{asset_id}/documents", headers=holder_headers)
    assert list_resp.status_code == 404
