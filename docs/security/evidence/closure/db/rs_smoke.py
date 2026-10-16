"""WP-B local simulation: API smoke test against a throw-away uvicorn that runs as the least-privilege runtime role
(DATABASE_URL = ckam_rs_app on the throw-away database ckam_rs). One sign-in only (rate limits)."""
import json
import sys

import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790"
w = json.load(open("/tmp/rs_world.json"))
PASSWORD = "Passw0rd!"   # throw-away fixture password of the S0 test world
results: list[tuple[str, bool, str]] = []


def step(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'} | {name} | {detail}")


with httpx.Client(base_url=BASE, timeout=30) as c:
    r = c.get("/api/health")
    step("GET /api/health", r.status_code == 200, f"{r.status_code} {r.text[:120]}")

    r = c.post("/api/auth/login", json={"login_id": w["codes"]["owner"], "password": PASSWORD})
    step("POST /api/auth/login (head-office admin)", r.status_code == 200, str(r.status_code))
    h = {"Authorization": f"Bearer {r.json()['access_token']}"}

    body = {"company_id": w["co"], "po_number": "PO-RS-1", "po_date": "2026-01-01", "vendor_id": w["vendor"],
            "cost_center_id": w["cc"], "delivery_asset_user_id": w["stock"],
            "lines": [{"item_id": w["item_chair"], "quantity": 2, "purchase_cost": 1000, "tax_percent": 18}]}
    r = c.post("/api/purchase-orders/with-lines", headers=h, json=body)
    step("POST /api/purchase-orders/with-lines", r.status_code == 201, f"{r.status_code} po_id={r.json().get('id')}")
    po_id = r.json()["id"]

    receipt = {"received_into_asset_user_id": w["stock"], "invoice_number": "INV-RS-1", "invoice_date": "2026-02-01",
               "invoice_amount": 2360, "lines": [{"line_no": 1, "quantity": 2}]}
    r = c.post(f"/api/purchase-orders/{po_id}/receive", headers=h, json=receipt)
    step("POST /api/purchase-orders/{id}/receive (2 chairs -> 2 assets + PROCURED events)",
         r.status_code == 200 and r.json().get("assets_created") == 2, f"{r.status_code} {r.text[:160]}")

    r = c.get("/api/assets", headers=h)
    items = r.json()["items"]
    step("GET /api/assets", r.status_code == 200 and len(items) == 2, f"{r.status_code} {len(items)} assets")
    asset_id = items[0].get("id") or items[0].get("asset_id")

    r = c.post(f"/api/assets/{asset_id}/events", headers=h, json={"event_type": "MOVED", "to_asset_user_id": w["employee"]})
    step("POST /api/assets/{id}/events MOVED to an employee (apply_event + OBS-STATUS marker)",
         r.status_code in (200, 201), f"{r.status_code} {r.text[:160]}")

    detail = c.get(f"/api/assets/{asset_id}", headers=h).json()
    before = (detail["status"], detail.get("current_asset_user_id"), detail.get("status_since"))
    edit = {"description": "Office chair (edited)", "vendor_id": w["vendor"], "serial_number": detail.get("serial_number"),
            "purchase_cost": 1111, "tax_percent": 18,
            # mass-assignment attempt: not part of AssetUpdateIn, must be ignored
            "status": "LOST", "current_asset_user_id": w["stock"], "status_since": "2020-01-01"}
    r = c.put(f"/api/assets/{asset_id}", headers=h, json=edit)
    after_detail = c.get(f"/api/assets/{asset_id}", headers=h).json()
    after = (after_detail["status"], after_detail.get("current_asset_user_id"), after_detail.get("status_since"))
    step("PUT /api/assets/{id} edit (+ field-change audit rows); status/holder/date in the body ignored",
         r.status_code == 200 and before == after and after_detail["description"] == "Office chair (edited)",
         f"{r.status_code} before={before} after={after}")

    r = c.post("/api/auth/refresh")
    step("POST /api/auth/refresh (auth_session row rotated)", r.status_code == 200, str(r.status_code))
    if r.status_code == 200:
        h = {"Authorization": f"Bearer {r.json()['access_token']}"}

    r = c.post("/api/client-reports", headers=h, json={
        "kind": "JS_ERROR", "message": "WP-B smoke: report a problem", "stack": "at Smoke", "route": "/assets",
        "app_version": "wpb", "breadcrumbs": [], "recent_requests": [], "note": "role split smoke"})
    step("POST /api/client-reports (report a problem)", r.status_code in (200, 201), f"{r.status_code} {r.text[:120]}")

    r = c.post("/api/masters/vendors", headers=h, json={"code": "RSV2", "name": "Role Split Vendor"})
    step("POST /api/masters/vendors (master write + master_audit)", r.status_code in (200, 201), f"{r.status_code} {r.text[:120]}")

    r = c.post("/api/auth/logout", headers=h)
    step("POST /api/auth/logout", r.status_code == 204, str(r.status_code))

failed = [n for n, ok, _ in results if not ok]
print(f"SMOKE {'PASSED' if not failed else 'FAILED'}: {len(results) - len(failed)}/{len(results)} steps")
sys.exit(1 if failed else 0)
