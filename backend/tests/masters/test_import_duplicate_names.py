"""Security RACE-1 residual / OBS-NAME-IMPORT (closure WP-A1): the head-office admin's Excel import of brands and
vendors follows the same "one active record per name" rule as adding one on the screen (same advisory lock, same
case- and space-insensitive comparison); a duplicate row is refused with a plain sentence, the other rows still go
in. A deactivated twin does not block, exactly like the screen."""
import asyncio
import io

from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.main import app
from app.masters.models import Brand, Vendor
from tests.masters.test_am25_bulk_import_export import XLSX, _login, _post_file, _setup, _xlsx

VENDOR_HEADER = ["Code", "Name", "GSTIN", "Contact Name", "Contact Phone", "Contact Email"]


async def _active(model, name: str) -> int:
    async with SessionLocal() as s:
        return (await s.execute(select(func.count()).select_from(model).where(
            func.lower(func.trim(model.name)) == name.lower(), model.is_active.is_(True)))).scalar_one()


async def test_a_vendor_file_with_two_rows_of_one_name_and_one_existing_name(client):
    ids = await _setup("DUPV")
    h = await _login(client, ids["admin"])
    async with SessionLocal() as s:
        s.add(Vendor(code="EXIST-1", name="Acme Traders"))
        s.add(Vendor(code="GONE-1", name="Old Supplies", is_active=False))      # deactivated twin: does not block
        await s.commit()
    content = _xlsx(VENDOR_HEADER, [
        ["NEW-1", "Fresh Supplies", None, None, None, None],
        ["NEW-2", "  fresh SUPPLIES ", None, None, None, None],      # same name again (case / spaces ignored)
        ["NEW-3", "ACME traders", None, None, None, None],           # an existing active vendor's name
        ["NEW-4", "Old Supplies", None, None, None, None],           # only a deactivated vendor has it: fine
    ])
    preview = (await _post_file(client, "/api/masters/vendors/import/preview", content, h)).json()
    assert [r["values"]["Code"] for r in preview["valid_rows"]] == ["NEW-1", "NEW-4"]
    assert [(e["row"], e["message"]) for e in preview["errors"]] == [
        (3, "Another row in this file already has the vendor name 'fresh SUPPLIES'."),
        (4, "A vendor with the name 'ACME traders' already exists."),
    ]
    resp = await _post_file(client, "/api/masters/vendors/import/commit", content, h)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["imported"] == 2
    assert body["errors"] == [{"row": 3, "message": "A vendor with the name 'fresh SUPPLIES' already exists."},
                              {"row": 4, "message": "A vendor with the name 'ACME traders' already exists."}]
    assert await _active(Vendor, "fresh supplies") == 1
    assert await _active(Vendor, "acme traders") == 1
    assert await _active(Vendor, "old supplies") == 1


async def test_a_brand_file_with_duplicates_is_refused_per_row(client):
    ids = await _setup("DUPB")
    h = await _login(client, ids["admin"])
    created = await client.post("/api/masters/brands", json={"code": "DELL", "name": "Dell"}, headers=h)
    assert created.status_code == 201
    content = _xlsx(["Code", "Name"], [["HP", "HP"], ["HP2", "hp"], ["DELL2", "DELL "], ["LEN", "Lenovo"]])
    body = (await _post_file(client, "/api/masters/brands/import/commit", content, h)).json()
    assert body["imported"] == 2
    assert [e["row"] for e in body["errors"]] == [3, 4]
    assert all("brand with the name" in e["message"] for e in body["errors"])
    assert await _active(Brand, "hp") == 1 and await _active(Brand, "dell") == 1


async def test_the_screen_still_refuses_a_name_an_import_created(client):
    ids = await _setup("DUPS")
    h = await _login(client, ids["admin"])
    await _post_file(client, "/api/masters/brands/import/commit", _xlsx(["Code", "Name"], [["ASUS", "Asus"]]), h)
    again = await client.post("/api/masters/brands", json={"code": "ASUS2", "name": " asus"}, headers=h)
    assert again.status_code == 422 and again.json()["detail"] == "A brand with this name already exists."


async def test_two_imports_of_the_same_name_at_the_same_moment_create_only_one(client):
    """The advisory lock: two parallel imports (each its own request / transaction) of one new vendor name."""
    ids = await _setup("DUPP")
    h = await _login(client, ids["admin"])

    async def one(code: str):
        content = _xlsx(VENDOR_HEADER, [[code, "Parallel Traders", None, None, None, None]])
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            return (await c.post("/api/masters/vendors/import/commit", headers=h,
                                 files={"file": ("a.xlsx", io.BytesIO(content), XLSX)})).json()

    results = await asyncio.gather(one("PAR-1"), one("PAR-2"))
    assert sorted(r["imported"] for r in results) == [0, 1]
    assert await _active(Vendor, "parallel traders") == 1


async def test_other_masters_are_not_given_the_name_rule(client):
    """Only brands and vendors have the one-name rule (cost centres, for example, are unchanged)."""
    ids = await _setup("DUPO")
    h = await _login(client, ids["admin"])
    content = _xlsx(["Company Code", "Code", "Name"], [[ids["co"].code, "CC1", "Same"], [ids["co"].code, "CC2", "Same"]])
    body = (await _post_file(client, "/api/masters/cost-centers/import/commit", content, h)).json()
    assert body == {"imported": 2, "errors": []}
