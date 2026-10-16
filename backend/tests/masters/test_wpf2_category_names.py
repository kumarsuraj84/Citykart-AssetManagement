"""Security closure WP-F2 / CL2-SE-N01: one ACTIVE Category per name inside a work area (IT / Non-IT), and one
ACTIVE Sub-category per name inside its Category -- the same rule (advisory lock + case- and space-insensitive
check) vendors and brands already follow. 20 parallel adds of one category name used to make 3 categories.

A name may exist once in IT and once in Non-IT (two teams, two lists); a deactivated twin does not block;
existing (legacy) twins are never touched and never block an unrelated save."""
import asyncio

from sqlalchemy import func, select

from app.core.db import SessionLocal
from app.masters.models import AssetCategory, AssetSubcategory
from tests.core.s0_world import build_world, login
from tests.masters.test_am25_bulk_import_export import _post_file, _xlsx

CAT_DUP = "A category with this name already exists."
SUB_DUP = "A sub-category with this name already exists."


async def _active(model, name: str, **where) -> int:
    async with SessionLocal() as s:
        stmt = select(func.count()).select_from(model).where(
            func.lower(func.trim(model.name)) == name.lower(), model.is_active.is_(True))
        for column, value in where.items():
            stmt = stmt.where(getattr(model, column) == value)
        return (await s.execute(stmt)).scalar_one()


async def _cat(client, h, name: str, domain: str = "IT", **over):
    return await client.post("/api/masters/categories", headers=h, json={"name": name, "asset_domain": domain, **over})


async def _sub(client, h, category_id: int, name: str, **over):
    return await client.post("/api/masters/subcategories", headers=h, json={"category_id": category_id, "name": name, **over})


async def test_a_second_category_of_one_name_in_one_work_area_is_refused(client):
    w = await build_world()
    h = await login(client, w, "owner")
    assert (await _cat(client, h, "Printers")).status_code == 201
    for again in ("Printers", "  printers ", "PRINTERS"):
        resp = await _cat(client, h, again)
        assert resp.status_code == 422 and resp.json()["detail"] == CAT_DUP, (again, resp.text)
    # a typed code does not get round it either
    typed = await _cat(client, h, "printers", code="PRN2")
    assert typed.status_code == 422 and typed.json()["detail"] == CAT_DUP
    # an existing category of the world ("Computers", IT)
    world_twin = await _cat(client, h, " computers")
    assert world_twin.status_code == 422 and world_twin.json()["detail"] == CAT_DUP
    assert await _active(AssetCategory, "printers", asset_domain="IT") == 1


async def test_the_same_name_in_the_other_work_area_and_a_deactivated_twin_do_not_block(client):
    w = await build_world()
    h = await login(client, w, "owner")
    assert (await _cat(client, h, "Printers", "IT")).status_code == 201
    other_area = await _cat(client, h, "Printers", "NON_IT")
    assert other_area.status_code == 201, other_area.text
    revived_name = await _cat(client, h, "Old category", "IT")          # only a deactivated category has it
    assert revived_name.status_code == 201, revived_name.text
    assert await _active(AssetCategory, "printers") == 2


async def test_a_domain_admin_is_told_of_the_twin_only_after_the_work_area_check(client):
    """The work-area refusal comes first: an IT admin adding a Non-IT name learns nothing about Non-IT names."""
    w = await build_world()
    h = await login(client, w, "admin_it")
    refused = await _cat(client, h, "Furniture", "NON_IT")
    assert refused.status_code == 403
    assert (await _cat(client, h, "Computers", "IT")).json()["detail"] == CAT_DUP


async def test_twenty_parallel_category_adds_of_one_name_make_one_category(client):
    w = await build_world()
    h = await login(client, w, "owner")
    results = await asyncio.gather(*(_cat(client, h, "Race Category") for _ in range(20)))
    codes = [r.status_code for r in results]
    assert not [c for c in codes if c >= 500], [r.text for r in results if r.status_code >= 500]
    assert codes.count(201) == 1 and codes.count(422) == 19, codes
    assert {r.json()["detail"] for r in results if r.status_code == 422} == {CAT_DUP}
    assert await _active(AssetCategory, "race category") == 1


async def test_renaming_or_moving_a_category_onto_an_active_name_is_refused(client):
    w = await build_world()
    h = await login(client, w, "owner")
    printers = (await _cat(client, h, "Printers", "NON_IT")).json()
    renamed = await client.put(f"/api/masters/categories/{w['nonit']}", headers=h,
                               json={"name": " PRINTERS", "asset_domain": "NON_IT"})
    assert renamed.status_code == 422 and renamed.json()["detail"] == CAT_DUP
    # moving "Printers" (Non-IT) to IT where "Computers" lives is fine; renaming it to "computers" there is not
    moved_onto = await client.put(f"/api/masters/categories/{printers['id']}", headers=h,
                                  json={"name": "computers", "asset_domain": "IT", "confirm_domain_change": True})
    assert moved_onto.status_code == 422 and moved_onto.json()["detail"] == CAT_DUP
    # its own name in another letter case is not a twin
    own = await client.put(f"/api/masters/categories/{w['it']}", headers=h, json={"name": "COMPUTERS", "asset_domain": "IT"})
    assert own.status_code == 200 and own.json()["name"] == "COMPUTERS"
    async with SessionLocal() as s:
        assert (await s.get(AssetCategory, w["nonit"])).name == "Furniture"
        assert (await s.get(AssetCategory, printers["id"])).asset_domain == "NON_IT"


async def test_existing_twins_are_left_alone_and_can_still_be_saved(client):
    w = await build_world()
    h = await login(client, w, "owner")
    async with SessionLocal() as s:
        a = AssetCategory(code="TWA", name="Twin", asset_domain="IT")
        b = AssetCategory(code="TWB", name="twin", asset_domain="IT")
        s.add_all([a, b])
        await s.commit()
    same = await client.put(f"/api/masters/categories/{a.id}", headers=h, json={"name": "Twin", "asset_domain": "IT"})
    assert same.status_code == 200, same.text
    assert await _active(AssetCategory, "twin") == 2          # nothing deactivated or renamed


async def test_a_second_sub_category_of_one_name_in_one_category_is_refused(client):
    w = await build_world()
    h = await login(client, w, "owner")
    for again in ("Laptop", " laptop ", "LAPTOP"):
        resp = await _sub(client, h, w["it"], again)
        assert resp.status_code == 422 and resp.json()["detail"] == SUB_DUP, (again, resp.text)
    assert (await _sub(client, h, w["nonit"], "Laptop")).status_code == 201          # another category: fine
    assert (await _sub(client, h, w["it"], "Old sub")).status_code == 201            # deactivated twin: fine
    assert await _active(AssetSubcategory, "laptop", category_id=w["it"]) == 1


async def test_twenty_parallel_sub_category_adds_of_one_name_make_one(client):
    w = await build_world()
    h = await login(client, w, "owner")
    results = await asyncio.gather(*(_sub(client, h, w["it"], "Race Kind") for _ in range(20)))
    codes = [r.status_code for r in results]
    assert not [c for c in codes if c >= 500], [r.text for r in results if r.status_code >= 500]
    assert codes.count(201) == 1 and codes.count(422) == 19, codes
    assert await _active(AssetSubcategory, "race kind", category_id=w["it"]) == 1


async def test_renaming_a_sub_category_onto_an_active_name_in_its_category_is_refused(client):
    w = await build_world()
    h = await login(client, w, "owner")
    tablet = (await _sub(client, h, w["it"], "Tablet")).json()
    refused = await client.put(f"/api/masters/subcategories/{tablet['id']}", headers=h, json={"name": "laptop"})
    assert refused.status_code == 422 and refused.json()["detail"] == SUB_DUP
    own = await client.put(f"/api/masters/subcategories/{w['lap']}", headers=h, json={"name": "LAPTOP"})
    assert own.status_code == 200
    chair_named = await client.put(f"/api/masters/subcategories/{w['chair']}", headers=h, json={"name": "Laptop"})
    assert chair_named.status_code == 200          # "Laptop" lives in another category


async def test_the_category_import_follows_the_same_rule(client):
    w = await build_world()
    h = await login(client, w, "owner")
    content = _xlsx(["Code", "Name", "Responsibility"], [
        ["IMP1", "Scanners", "IT"],
        ["IMP2", " scanners ", "IT"],          # same name again in this file, same work area
        ["IMP3", "COMPUTERS", "IT"],           # an existing active IT category
        ["IMP4", "Scanners", "NON_IT"],        # the other work area: fine
        ["IMP5", "Old category", "IT"],        # only a deactivated category has it: fine
    ])
    preview = (await _post_file(client, "/api/masters/categories/import/preview", content, h)).json()
    assert [r["values"]["Code"] for r in preview["valid_rows"]] == ["IMP1", "IMP4", "IMP5"]
    assert [(e["row"], e["message"]) for e in preview["errors"]] == [
        (3, "Another row in this file already has the category name 'scanners'."),
        (4, "A category with the name 'COMPUTERS' already exists."),
    ]
    resp = await _post_file(client, "/api/masters/categories/import/commit", content, h)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"imported": 3, "errors": [
        {"row": 3, "message": "A category with the name 'scanners' already exists."},
        {"row": 4, "message": "A category with the name 'COMPUTERS' already exists."},
    ]}
    assert await _active(AssetCategory, "scanners", asset_domain="IT") == 1
    assert await _active(AssetCategory, "scanners", asset_domain="NON_IT") == 1
    assert await _active(AssetCategory, "computers") == 1
    # the screen then refuses a name the import created
    again = await _cat(client, h, "SCANNERS", "IT")
    assert again.status_code == 422 and again.json()["detail"] == CAT_DUP


async def test_the_sub_category_import_follows_the_same_rule(client):
    w = await build_world()
    h = await login(client, w, "owner")
    content = _xlsx(["Category Code", "Code", "Name"], [
        ["S0IT", "K1", "Keyboard"],
        ["S0IT", "K2", "keyboard"],            # same name again in this file, same category
        ["S0IT", "K3", "LAPTOP"],              # an existing active sub-category of Computers
        ["S0NI", "K4", "Keyboard"],            # another category: fine
    ])
    body = (await _post_file(client, "/api/masters/subcategories/import/commit", content, h)).json()
    assert body["imported"] == 2
    assert [e["row"] for e in body["errors"]] == [3, 4]
    assert all("sub-category with the name" in e["message"] for e in body["errors"])
    assert await _active(AssetSubcategory, "keyboard", category_id=w["it"]) == 1
    assert await _active(AssetSubcategory, "keyboard", category_id=w["nonit"]) == 1
