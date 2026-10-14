"""S8: no business write path is unaudited.

1. Every POST / PUT / PATCH / DELETE route in the OpenAPI schema is CLASSIFIED below: how it is audited, or
   (ALLOW_LIST) why it legitimately writes no audit row. A new write route fails this test until it is
   classified -- see docs/ai/LOGGING_AND_DIAGNOSTICS.md, "How to add auditing for a new table or route".
2. Representative routes are CALLED as the right role, and each must leave at least one audit row carrying
   that request's id that is not the middleware's generic safety-net row (action WRITE)."""
import pytest

from app.main import app
from app.observability.models import AuditLog
from tests.core.s0_world import PASSWORD, add_line, build_world, login, make_asset, make_po
from tests.observability.helpers import audit

AUTO = "DATA: automatic (session events)"
SEC = "SECURITY: explicit"

AUDITED: dict[tuple[str, str], str] = {
    ("POST", "/api/auth/login"): "SECURITY LOGIN / LOGIN_FAILED / LOCKED",
    ("POST", "/api/auth/refresh"): "SECURITY TOKEN_REFRESH_FAILED (throttled); a successful renewal is not recorded",
    ("POST", "/api/auth/logout"): "SECURITY LOGOUT",
    ("POST", "/api/auth/change-password"): "SECURITY PASSWORD_CHANGED / _FAILED + DATA (password_hash shown as ***)",
    ("POST", "/api/asset-users/import/preview"): "IMPORT IMPORT_PREVIEW",
    ("POST", "/api/asset-users/import/commit"): "IMPORT IMPORT_COMMIT + DATA per new record",
    ("POST", "/api/asset-users"): AUTO + " + SECURITY ACCESS_CHANGED when it can sign in",
    ("POST", "/api/asset-users/issue-passwords"): "SECURITY PASSWORD_RESET (one row, ids, never passwords)",
    ("PUT", "/api/asset-users/{asset_user_id}"): AUTO + " + SECURITY ACCESS_CHANGED for login / role / work area",
    ("DELETE", "/api/asset-users/{asset_user_id}"): AUTO + " (DEACTIVATE)",
    ("POST", "/api/asset-users/{asset_user_id}/primary-owner"): AUTO + " + SECURITY PRIMARY_OWNER_GRANTED",
    ("DELETE", "/api/asset-users/{asset_user_id}/primary-owner"): AUTO + " + SECURITY PRIMARY_OWNER_REVOKED",
    ("POST", "/api/asset-users/{asset_user_id}/reset-password"): AUTO + " + SECURITY PASSWORD_RESET",
    ("POST", "/api/asset-users/{asset_user_id}/company-access"): "DATA explicit + SECURITY ACCESS_CHANGED",
    ("POST", "/api/stock-rooms"): AUTO,
    ("POST", "/api/people/employees"): AUTO + " + SECURITY ACCESS_CHANGED when it can sign in",
    ("POST", "/api/people/stores"): AUTO + " + SECURITY ACCESS_CHANGED",
    ("POST", "/api/people/stores/ensure-rooms"): "DATA BATCH_ADD (one row)",
    ("POST", "/api/people/install-points"): AUTO,
    ("POST", "/api/code-rules"): AUTO + " + SECURITY CODE_RULE_CHANGED",
    ("PUT", "/api/code-rules/{rule_id}"): AUTO + " + SECURITY CODE_RULE_CHANGED",
    ("POST", "/api/assets/batch"): "DATA BATCH_ADD (one row)",
    ("POST", "/api/assets/link-items"): "DATA LINK (one row)",
    ("POST", "/api/assets"): "DATA CREATE (explicit: bulk INSERT)",
    ("POST", "/api/assets/bulk-move"): "LIFECYCLE MOVE (one row)",
    ("POST", "/api/assets/bulk-action"): "LIFECYCLE <event> (one row)",
    ("PUT", "/api/assets/{asset_id}"): AUTO,
    ("DELETE", "/api/assets/{asset_id}"): AUTO + " (DELETE: deleted_at set)",
    ("PUT", "/api/assets/serials"): "DATA SERIALS_FILLED (one row)",
    ("PUT", "/api/assets/{asset_id}/serial"): AUTO,
    ("POST", "/api/assets/{asset_id}/corrections"): AUTO,
    ("POST", "/api/assets/{asset_id}/events"): "LIFECYCLE <event>",
    ("POST", "/api/assets/{asset_id}/documents"): AUTO + " + ACCESS DOCUMENT_UPLOADED",
    ("POST", "/api/imports/assets/preview"): "IMPORT IMPORT_PREVIEW",
    ("POST", "/api/imports/assets/commit"): "IMPORT IMPORT_COMMIT (one row)",
    ("POST", "/api/imports/purchase-orders/preview"): "IMPORT IMPORT_PREVIEW",
    ("POST", "/api/imports/purchase-orders/commit"): "IMPORT IMPORT_COMMIT + DATA per PO",
    ("POST", "/api/imports/movements/preview"): "IMPORT IMPORT_PREVIEW",
    ("POST", "/api/imports/movements/commit"): "IMPORT IMPORT_COMMIT (one row)",
    ("POST", "/api/purchase-orders"): AUTO,
    ("POST", "/api/purchase-orders/with-lines"): AUTO + " + DATA LINES_ADDED",
    ("PUT", "/api/purchase-orders/{po_id}"): AUTO + " (header fields; master_audit keeps the names too)",
    ("DELETE", "/api/purchase-orders/{po_id}"): "DATA DELETE_PO (one row)",
    ("PUT", "/api/purchase-orders/{po_id}/line-groups/{line_no}"): "DATA LINE_UPDATE",
    ("POST", "/api/purchase-orders/{po_id}/line-groups/{line_no}/cancel-waiting"): "DATA CANCEL_WAITING",
    ("POST", "/api/purchase-orders/{po_id}/cancel-waiting"): "DATA CANCEL_WAITING",
    ("POST", "/api/purchase-orders/{po_id}/lines"): "DATA LINES_ADDED",
    ("POST", "/api/purchase-orders/{po_id}/bundle-lines"): "DATA LINES_ADDED",
    ("PUT", "/api/purchase-orders/lines/{line_id}"): "DATA LINE_UPDATE",
    ("POST", "/api/purchase-orders/lines/{line_id}/cancel"): "DATA CANCEL_WAITING",
    ("POST", "/api/purchase-orders/{po_id}/deliver"): "DATA RECEIVE (one row)",
    ("POST", "/api/purchase-orders/{po_id}/receive"): "DATA RECEIVE (one row)",
    ("POST", "/api/purchase-orders/{po_id}/record-pi"): "DATA PI_RECORDED (one row)",
    ("POST", "/api/bundles"): AUTO,
    ("PUT", "/api/bundles/{bundle_id}"): AUTO,
    ("DELETE", "/api/bundles/{bundle_id}"): AUTO + " (DEACTIVATE)",
    ("POST", "/api/erp/sync"): "ERP ERP_SYNC + system_event sync_started / sync_<status>",
    ("POST", "/api/erp/stores/create"): "ERP STORES_CREATE (one row)",
    ("POST", "/api/erp/vendors/import"): AUTO + " (vendor + vendor_erp_link)",
    ("POST", "/api/erp/vendors/{vendor_id}/link"): AUTO + " (vendor_erp_link)",
    ("DELETE", "/api/erp/vendors/{vendor_id}/link"): AUTO + " (vendor_erp_link DELETE)",
    ("POST", "/api/erp/vendors/{vendor_id}/link-many"): AUTO + " (vendor_erp_link per code)",
    ("POST", "/api/erp/vendors/import-group"): AUTO + " (vendor + links)",
    ("POST", "/api/erp/inbox/items/resolve"): AUTO + " (item / item_map per decision)",
    ("POST", "/api/erp/inbox/vendors/resolve"): AUTO + " (vendor / links per decision)",
    ("POST", "/api/erp/purchase-orders/{po_id}/changes/apply"): "ERP ERP_CHANGES_APPLIED + DATA baseline rows",
    ("POST", "/api/erp/purchase-orders/{po_id}/pi/apply"): "ERP PI_RECORDED (one row)",
    ("POST", "/api/erp/pos/{po_code}/not-tracked"): AUTO + " (item_map)",
    ("POST", "/api/erp/pos/create"): AUTO + " (purchase_order) + ERP CREATE_FROM_ERP",
    ("POST", "/api/items"): AUTO,
    ("PUT", "/api/items/{item_id}"): AUTO,
    ("DELETE", "/api/items/{item_id}"): AUTO + " (DEACTIVATE)",
    ("POST", "/api/items/seed-from-subcategories"): AUTO + " (one row per Item made)",
    ("POST", "/api/items/maps"): AUTO,
    ("DELETE", "/api/items/maps/{map_id}"): AUTO + " (DEACTIVATE)",
    ("POST", "/api/masters/custom-fields"): AUTO,
    ("PUT", "/api/masters/custom-fields/{item_id}"): AUTO,
    ("DELETE", "/api/masters/custom-fields/{item_id}"): AUTO + " (DEACTIVATE)",
    ("PATCH", "/api/admin/logs/client-reports/{report_id}"): "ACCESS CLIENT_REPORT_STATUS",
}
for _master in ("companies", "locations", "departments", "cost-centers", "categories", "subcategories", "brands", "vendors"):
    AUDITED[("POST", f"/api/masters/{_master}")] = AUTO
    AUDITED[("PUT", f"/api/masters/{_master}/{{item_id}}")] = AUTO
    AUDITED[("DELETE", f"/api/masters/{_master}/{{item_id}}")] = AUTO + " (DEACTIVATE)"
    AUDITED[("POST", f"/api/masters/{_master}/import/preview")] = "IMPORT IMPORT_PREVIEW"
    AUDITED[("POST", f"/api/masters/{_master}/import/commit")] = "IMPORT IMPORT_COMMIT + DATA per new record"

# Write-method routes that legitimately leave no audit row.
ALLOW_LIST: dict[tuple[str, str], str] = {
    ("POST", "/api/code-rules/preview"): "shows what a code format would look like; saves nothing",
    ("POST", "/api/purchase-orders/check-serials"): "advisory serial check; saves nothing",
    ("POST", "/api/client-reports"): "writes the client_report log table itself (found by its reference)",
}


def _write_routes() -> set[tuple[str, str]]:
    schema = app.openapi()
    return {(m.upper(), p) for p, ops in schema["paths"].items() for m in ops if m in ("post", "put", "patch", "delete")}


def test_every_write_route_is_classified():
    routes = _write_routes()
    unclassified = sorted(routes - set(AUDITED) - set(ALLOW_LIST))
    stale = sorted((set(AUDITED) | set(ALLOW_LIST)) - routes)
    assert not unclassified, f"write routes with no audit classification: {unclassified}"
    assert not stale, f"classified routes that no longer exist: {stale}"
    assert not set(AUDITED) & set(ALLOW_LIST)


async def _audited(resp) -> list[AuditLog]:
    assert resp.status_code < 400, (resp.request.method, resp.request.url, resp.status_code, resp.text)
    rows = await audit(AuditLog.request_id == resp.headers["x-request-id"])
    assert rows, f"no audit row for {resp.request.method} {resp.request.url.path}"
    assert all(r.action != "WRITE" for r in rows), [r.summary for r in rows]
    return rows


async def test_representative_write_routes_leave_audit_rows_with_their_request_id(client):
    w = await build_world()
    owner = await login(client, w, "owner")
    admin = await login(client, w, "admin")
    calls = []

    async def call(method, path, headers, **kwargs):
        resp = await client.request(method, path, headers=headers, **kwargs)
        calls.append((method, path))
        return await _audited(resp)

    # masters (head-office admin)
    company = (await client.post("/api/masters/companies", headers=owner, json={"code": "WLK", "name": "Walker Co"}))
    await _audited(company)
    cid = company.json()["id"]
    await call("PUT", f"/api/masters/companies/{cid}", owner, json={"name": "Walker Company"})
    dept = await client.post("/api/masters/departments", headers=owner, json={"name": "Walker Dept"})
    await _audited(dept)
    await call("DELETE", f"/api/masters/departments/{dept.json()['id']}", owner)
    await call("POST", "/api/masters/brands", owner, json={"name": "Walker Brand"})
    await call("POST", "/api/masters/cost-centers", owner, json={"company_id": w["co"], "code": "WLKCC", "name": "Walker CC"})
    await call("POST", "/api/masters/custom-fields", owner, json={"field_key": "walk", "label": "Walk", "field_type": "text"})
    # items, links, sets
    item = await client.post("/api/items", headers=owner, json={"name": "Walker Laptop", "category_id": w["it"],
                                                               "subcategory_id": w["lap"]})
    await _audited(item)
    await call("PUT", f"/api/items/{item.json()['id']}", owner, json={"name": "Walker Laptop 2", "category_id": w["it"],
                                                                      "subcategory_id": w["lap"]})
    await call("POST", "/api/items/maps", owner, json={"not_tracked": True, "match_type": "CODE", "erp_item_code": "WLK-1"})
    await call("POST", "/api/bundles", owner, json={"name": "Walker Set", "parts": [
        {"name": "Body", "item_id": item.json()["id"], "share_percent": 100}]})
    # people and places
    await call("POST", "/api/stock-rooms", admin, json={"name": "Walker Stock", "company_id": w["co"], "location_id": w["loc"]})
    await call("POST", "/api/people/install-points", admin, json={"name": "Walker Wall", "company_id": w["co"],
                                                                  "location_id": w["loc"]})
    await call("POST", "/api/people/employees", admin, json={"name": "Walker Emp", "company_id": w["co"], "code": "WLKE",
                                                             "location_id": w["loc"]})
    person = await client.post("/api/asset-users", headers=admin, json={
        "company_id": w["co"], "code": "WLKP", "name": "Walker Person", "asset_user_type": "EMPLOYEE",
        "location_id": w["loc"]})
    await _audited(person)
    await call("PUT", f"/api/asset-users/{person.json()['id']}", admin, json={"phone": "99999"})
    await call("DELETE", f"/api/asset-users/{person.json()['id']}", admin)
    await call("POST", "/api/code-rules", owner, json={"company_id": cid, "prefix_template": "WLK/", "suffix_template": "",
                                                       "start_number": 1, "pad_width": 3})
    # purchase orders
    po = await make_po(client, admin, w, number="WALK-PO")
    await call("PUT", f"/api/purchase-orders/{po['id']}", admin, json={"po_date": "2026-01-02"})
    line = await add_line(client, admin, w, po["id"], quantity=2)
    await _audited(line)
    unit = line.json()[0]["id"]
    await call("PUT", f"/api/purchase-orders/lines/{unit}", admin, json={
        "description": "Laptop 2", "category_id": w["it"], "subcategory_id": w["lap"], "purchase_cost": 900, "tax_percent": 18})
    await call("POST", f"/api/purchase-orders/lines/{unit}/cancel", admin)
    await call("POST", f"/api/purchase-orders/{po['id']}/cancel-waiting", admin)
    # assets
    asset = await make_asset(client, admin, w)
    await call("PUT", f"/api/assets/{asset['id']}", admin, json={"description": "Walker laptop"})
    await call("POST", f"/api/assets/{asset['id']}/corrections", admin, json={"purchase_date": "2026-01-15",
                                                                               "reason": "typo"})
    await call("POST", f"/api/assets/{asset['id']}/events", admin, json={"event_type": "MOVED",
                                                                          "to_asset_user_id": w["employee"]})
    await call("POST", "/api/assets/bulk-move", admin, json={"asset_ids": [asset["id"]], "to_asset_user_id": w["stock"]})
    # sign-in
    await call("POST", "/api/auth/change-password", await login(client, w, "op_it"),
               json={"old_password": PASSWORD, "new_password": "Walker#2026x"})
    await call("POST", "/api/auth/logout", {})
    assert len(calls) >= 20                  # plus the five creates checked above
    for method, path in calls:
        assert any(path.startswith(p.split("{")[0].rstrip("/")) for m, p in AUDITED if m == method), (method, path)


@pytest.mark.parametrize("route", sorted(ALLOW_LIST))
def test_allow_listed_routes_say_why(route):
    assert len(ALLOW_LIST[route]) > 10


async def test_the_safety_net_catches_a_write_route_without_its_own_row(client, monkeypatch):
    """A successful write request that changed business rows but wrote no audit row gets a generic DATA
    'WRITE' row (so a forgotten route is visible in the trail and in this suite)."""
    from app.observability import audit as obs_audit

    w = await build_world()
    h = await login(client, w, "admin")
    asset = await make_asset(client, h, w)
    real = obs_audit.lifecycle_summary if hasattr(obs_audit, "lifecycle_summary") else None
    import app.lifecycle.router as lifecycle_router

    async def forgotten(*args, **kwargs):
        return None

    monkeypatch.setattr(lifecycle_router, "lifecycle_summary", forgotten)
    resp = await client.post(f"/api/assets/{asset['id']}/events", headers=h,
                             json={"event_type": "MOVED", "to_asset_user_id": w["employee"]})
    assert resp.status_code == 201
    [row] = await audit(AuditLog.request_id == resp.headers["x-request-id"])
    assert (row.category, row.action) == ("DATA", "WRITE")
    assert row.summary == "POST /api/assets/{asset_id}/events saved changes that have no specific audit entry."
    assert real is None
