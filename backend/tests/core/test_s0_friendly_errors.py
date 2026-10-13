"""S0.7 (audit B-8, B-11, B-12, B-13, B-15): no bare 500 for a problem with the
request; validation errors are readable sentences in a string `detail` (the
frontend shows a string detail); garbage Excel files get one plain answer."""
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy.exc import DataError, IntegrityError

from app.core.errors import describe_error, register_exception_handlers
from app.lifecycle.state_machine import LifecycleError
from tests.core.s0_world import build_world, login, make_asset


def test_validation_errors_become_plain_sentences():
    assert describe_error({"type": "missing", "loc": ("body", "po_number"), "msg": "Field required"}) == "PO number is required."
    assert describe_error({"type": "string_too_long", "loc": ("body", "description"), "msg": "",
                           "ctx": {"max_length": 500}}) == "Description is too long (max 500 characters)."
    assert describe_error({"type": "greater_than_equal", "loc": ("body", "lines", 2, "quantity"), "msg": "",
                           "ctx": {"ge": 1}}) == "Line 3: Quantity must be at least 1."
    assert describe_error({"type": "value_error", "loc": ("body",), "msg": "Value error, Choose an Item (or a category)."}) \
        == "Choose an Item (or a category)."
    assert describe_error({"type": "int_parsing", "loc": ("body", "vendor_id"), "msg": ""}) == "Vendor must be a number."


async def test_a_bad_request_body_answers_a_string_detail_and_a_list_of_sentences(client):
    w = await build_world()
    h = await login(client, w, "admin")
    resp = await client.post("/api/purchase-orders", headers=h, json={"company_id": "abc", "po_date": "not a date"})
    assert resp.status_code == 422
    body = resp.json()
    assert isinstance(body["detail"], str)
    assert body["errors"] == ["Company must be a number.", "PO number is required.", "PO date must be a valid date.",
                              "Cost centre is required."]
    assert body["detail"] == " ".join(body["errors"])


async def test_garbage_or_empty_excel_files_get_a_plain_answer(client):
    w = await build_world()
    h = await login(client, w, "owner")
    paths = ["/api/imports/assets/preview", "/api/imports/assets/commit", "/api/imports/purchase-orders/preview",
             "/api/imports/movements/preview", "/api/masters/vendors/import/preview", "/api/asset-users/import/preview"]
    for path in paths:
        for content in (b"", b"this is not a spreadsheet", b"PK\x03\x04garbage"):
            resp = await client.post(path, headers=h, files={"file": ("x.xlsx", content)})
            assert resp.status_code == 422, (path, content, resp.text)
            assert resp.json()["detail"] == "That file is not a valid Excel file."


async def test_a_nul_character_in_a_search_is_a_422_not_a_500(client):
    w = await build_world()
    h = await login(client, w, "admin")
    resp = await client.get("/api/assets", headers=h, params={"q": "ab\x00cd"})
    assert resp.status_code == 422 and "hidden control characters" in resp.json()["detail"]


async def test_an_empty_document_is_refused(client):
    w = await build_world()
    h = await login(client, w, "admin")
    asset = await make_asset(client, h, w)
    resp = await client.post(f"/api/assets/{asset['id']}/documents", headers=h,
                             data={"doc_type": "invoice"}, files={"file": ("empty.pdf", b"", "application/pdf")})
    assert resp.status_code == 422 and resp.json()["detail"] == "The file is empty."


async def test_an_absurd_password_length_is_refused(client):
    resp = await client.post("/api/auth/login", json={"login_id": "x", "password": "p" * 100_000})
    assert resp.status_code == 422 and "too long" in resp.json()["detail"]


def _app_raising(exc: Exception) -> FastAPI:
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/boom")
    async def boom():
        raise exc
    return app


class _Pg(Exception):
    def __init__(self, sqlstate, detail=None, column_name=None):
        super().__init__(detail or "")
        self.sqlstate, self.detail, self.column_name = sqlstate, detail, column_name


class _Orig(Exception):
    pass


def _wrapped(cls, pg):
    orig = _Orig(str(pg))
    orig.__cause__ = pg
    return cls("INSERT ...", {}, orig)


async def _get(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.get("/boom")


async def test_database_errors_become_plain_answers_not_500s():
    fk = _wrapped(IntegrityError, _Pg("23503", 'Key (vendor_id)=(999) is not present in table "vendor".'))
    resp = await _get(_app_raising(fk))
    assert resp.status_code == 422 and resp.json()["detail"] == "The vendor you chose does not exist."
    dup = _wrapped(IntegrityError, _Pg("23505", "Key (company_id, code)=(1, X) already exists."))
    resp = await _get(_app_raising(dup))
    assert resp.status_code == 409 and resp.json()["detail"] == "A record with this code already exists."
    too_long = _wrapped(DataError, _Pg("22001", None))
    too_long.orig = _Orig("value too long for type character varying(200)")
    resp = await _get(_app_raising(too_long))
    assert resp.status_code == 422 and resp.json()["detail"] == "One of the texts is too long (max 200 characters)."
    resp = await _get(_app_raising(LifecycleError("This asset is reported lost, so it cannot be moved.")))
    assert resp.status_code == 422 and resp.json()["detail"] == "This asset is reported lost, so it cannot be moved."


async def test_real_database_type_overflow_is_a_422(client):
    """A text longer than its column, sent through a path without a schema
    limit, comes back as a 422 sentence from the DataError handler."""
    w = await build_world()
    h = await login(client, w, "owner")
    resp = await client.post("/api/items/maps", headers=h, json={
        "not_tracked": True, "match_type": "CODE", "erp_item_code": "C" * 60})
    assert resp.status_code in (422, 409), resp.text
    assert isinstance(resp.json()["detail"], str) and "Internal" not in resp.json()["detail"]
