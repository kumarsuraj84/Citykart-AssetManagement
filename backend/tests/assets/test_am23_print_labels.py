"""AM-23: bulk Print Labels -- GET /api/assets/{id}/label.png encodes the
asset's bare asset_code (not a URL, unlike /qr.png) as either a linear
Code128 barcode (default) or a QR code, so a label printed from it and
pasted on the asset scans back into this app's own scan fields (Asset
Movement, Asset Register search, ...) as the literal asset_code text."""
from datetime import date
from app.assets.service import procure_assets
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.asset_users.models import AssetUser
from app.masters.models import AssetCategory, AssetSubcategory, Company, CostCenter, Department, Location
from app.numbering.models import CodeRule


async def _setup(suffix: str):
    async with SessionLocal() as session:
        co = Company(code=f"AM23-{suffix}", name=f"AM23 Co {suffix}")
        cat = AssetCategory(code=f"AM23-{suffix}", name="IT", asset_domain="IT")
        session.add_all([co, cat])
        await session.flush()
        sub = AssetSubcategory(category_id=cat.id, code="LAP", name="Laptop")
        cc = CostCenter(company_id=co.id, code="HO", name="Head Office")
        loc = Location(company_id=co.id, code=f"AM23-{suffix}", name="HO")
        dept = Department(name=f"AM23-{suffix}")
        session.add_all([sub, cc, loc, dept])
        await session.flush()
        stock = AssetUser(company_id=co.id, code=f"STK-{suffix}", name="IT Stock", asset_user_type="STOCK_POINT",
                        location_id=loc.id, department_id=dept.id, role="SELF_SERVICE")
        admin = AssetUser(company_id=co.id, code=f"ADM-{suffix}", name="Admin", asset_user_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="ADMIN",
                        login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        other = AssetUser(company_id=co.id, code=f"OTH-{suffix}", name="Someone Else", asset_user_type="EMPLOYEE",
                        location_id=loc.id, department_id=dept.id, role="SELF_SERVICE",
                        login_enabled=True, password_hash=hash_password("Passw0rd!"), must_change_password=False)
        rule = CodeRule(company_id=co.id, prefix_template=f"AM23/{suffix}/", suffix_template="",
                         start_number=1, pad_width=0)
        session.add_all([stock, admin, other, rule])
        await session.commit()
        [asset] = await procure_assets(session, {
            "company_id": co.id, "cost_center_id": cc.id, "category_id": cat.id, "subcategory_id": sub.id,
            "description": "Label Test Laptop", "purchase_date": date(2026, 1, 1), "initial_asset_user_id": stock.id,
        }, quantity=1, actor=admin)
        await session.commit()
        return {"co": co, "asset_id": asset.id, "asset_code": asset.asset_code, "admin_emp": f"ADM-{suffix}", "other_emp": f"OTH-{suffix}"}


async def _login(client, co_id, login_id):
    resp = await client.post("/api/auth/login", json={"company_id": co_id, "login_id": login_id, "password": "Passw0rd!"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}"}


async def test_label_png_defaults_to_barcode(client):
    ids = await _setup("LBL1")
    headers = await _login(client, ids["co"].id, ids["admin_emp"])

    resp = await client.get(f"/api/assets/{ids['asset_id']}/label.png", headers=headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


async def test_label_png_qr_symbol(client):
    ids = await _setup("LBL2")
    headers = await _login(client, ids["co"].id, ids["admin_emp"])

    resp = await client.get(f"/api/assets/{ids['asset_id']}/label.png?symbol=qr", headers=headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"


async def test_label_png_rejects_an_unrecognized_symbol(client):
    ids = await _setup("LBL3")
    headers = await _login(client, ids["co"].id, ids["admin_emp"])

    resp = await client.get(f"/api/assets/{ids['asset_id']}/label.png?symbol=zpl", headers=headers)
    assert resp.status_code == 422


async def test_label_png_404_for_asset_user_who_does_not_hold_the_asset():
    """Same fail-closed scoping as /qr.png -- a label image is not a
    backdoor around _get_scoped_asset."""
    from httpx import AsyncClient, ASGITransport
    from app.main import app

    ids = await _setup("LBL4")
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as anon_client:
        headers = await _login(anon_client, ids["co"].id, ids["other_emp"])
        resp = await anon_client.get(f"/api/assets/{ids['asset_id']}/label.png", headers=headers)
        assert resp.status_code == 404


def test_asset_label_png_encodes_the_bare_asset_code_not_a_url(monkeypatch):
    """Unit-checks that asset_label_png hands the encoder the raw asset_code
    string -- never the /qr.png deep link -- for both symbols, so a scan of
    a printed label re-types as exactly the asset_code into any of this
    app's own scan fields."""
    from app.reports import export_service

    captured = {}

    class FakeImg:
        def save(self, buf, format):  # noqa: A002 - matches PIL's Image.save signature
            buf.write(b"FAKE-QR-PNG")

    def fake_qr_make(data):
        captured["qr_data"] = data
        return FakeImg()

    class FakeCode128:
        def __init__(self, data, writer):
            captured["barcode_data"] = data

        def write(self, buf, options):
            buf.write(b"FAKE-BARCODE-PNG")

    monkeypatch.setattr(export_service.qrcode, "make", fake_qr_make)
    monkeypatch.setattr(export_service, "Code128", FakeCode128)

    barcode_result = export_service.asset_label_png("FA/HO01/IT/LAP/CK_1", "barcode")
    qr_result = export_service.asset_label_png("FA/HO01/IT/LAP/CK_1", "qr")

    assert captured["barcode_data"] == "FA/HO01/IT/LAP/CK_1"
    assert captured["qr_data"] == "FA/HO01/IT/LAP/CK_1"
    assert barcode_result == b"FAKE-BARCODE-PNG"
    assert qr_result == b"FAKE-QR-PNG"
