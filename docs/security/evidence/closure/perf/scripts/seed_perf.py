"""PERF-TEST dataset for the old-vs-new CKAM comparison (disposable stacks ckam-pf-old / ckam-pf-new ONLY).

Pattern of scratchpad/sec/seed_security_fixture.py: ONE direct insert (a head-office admin `PERFHO`, Primary Owner,
because the migration's `Admin` password is a one-time secret we do not use), then everything else through the
application's real HTTP API, so asset codes, events, audit rows and PO receipts are produced by the real code. The
only other direct writes are the local ERP copy rows (erp_* tables), because these stacks have NO ERP link.

The dataset is deterministic: run on both stacks it creates the same rows in the same order (ids match).

Bulk step: 150 POs (2 lines each: 4 serial laptops + 10 no-serial chairs) of which 140 are received in full
(1,960 assets), 300 of those moved to employees, plus the dedicated (not yet received) POs the benchmark
receives against, one PO per timed sample.

Run inside the api container:  python /tmp/seed_perf.py   -> writes /tmp/perfseed.json
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import sys
import time
from datetime import date, datetime, timedelta, timezone

import httpx
from sqlalchemy import select

from app.asset_users.models import AssetUser
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.erp.mirror_models import ErpItemCopy, ErpPoLineCopy, ErpSiteCopy, ErpSyncRun, ErpVendorCopy
from app.masters.models import Company

API = "http://127.0.0.1:8000"
PW = "Perf#Test2026ok"
TODAY = date(2026, 10, 16)
PO_DATE = (TODAY - timedelta(days=30)).isoformat()
INV_DATE = (TODAY - timedelta(days=10)).isoformat()
OUT = "/tmp/perfseed.json"

N_VENDORS = 20
N_EMPLOYEES = 60
N_BULK_POS = 150
N_RECEIVED = 140
LAPTOPS_PER_PO = 4
CHAIRS_PER_PO = 10
# dedicated POs for the timed receives: (key, item, quantity per PO, number of POs)
RECEIVE_POS = [("r1", "chair", 1, 22), ("r10", "chair", 10, 22), ("r50", "chair", 50, 10),
               ("r100", "chair", 100, 10), ("rs10", "laptop", 10, 22)]
N_ERP_POS = 40


class Fail(Exception):
    pass


class Api:
    def __init__(self):
        self.http = httpx.AsyncClient(base_url=API, timeout=300)
        self.tok = None

    async def login(self, code: str, password: str) -> str:
        r = await self.http.post("/api/auth/login", json={"login_id": code, "password": password})
        if r.status_code != 200:
            raise Fail(f"login {code}: {r.status_code} {r.text}")
        self.tok = r.json()["access_token"]
        self.tok_at = time.monotonic()
        return self.tok

    async def call(self, method: str, path: str, ok=(200, 201, 204), **kw):
        if time.monotonic() - self.tok_at > 600:          # access tokens live 15 minutes
            await self.login("PERFHO", PW)
        headers = dict(kw.pop("headers", {}) or {})
        headers["Authorization"] = f"Bearer {self.tok}"
        r = await self.http.request(method, path, headers=headers, **kw)
        if r.status_code not in ok:
            raise Fail(f"{method} {path}: {r.status_code} {r.text[:800]}")
        if r.status_code == 204 or not r.content:
            return None
        return r.json()


def say(msg: str) -> None:
    print(msg, flush=True)


async def bootstrap() -> int:
    async with SessionLocal() as s:
        row = (await s.execute(select(AssetUser).where(AssetUser.code == "PERFHO"))).scalars().first()
        if row is not None:
            return row.id
        owner = (await s.execute(select(AssetUser).where(AssetUser.is_primary_owner.is_(True)).order_by(AssetUser.id))).scalars().first()
        row = AssetUser(code="PERFHO", name="PERFHO", asset_user_type=None, company_id=None, location_id=None,
                        email="perfho@perf.test", role="ADMIN", is_primary_owner=True, login_enabled=True,
                        password_hash=hash_password(PW), must_change_password=False,
                        created_by=owner.id if owner else None, updated_by=owner.id if owner else None)
        s.add(row)
        await s.commit()
        await s.refresh(row)
        return row.id


async def main() -> None:
    t0 = time.monotonic()
    async with SessionLocal() as s:
        if (await s.execute(select(Company).where(Company.code == "CKSPL"))).scalars().first() is not None:
            say("already seeded")
            sys.exit(2)
    out: dict = {}
    out["admin_id"] = await bootstrap()
    api = Api()
    await api.login("PERFHO", PW)

    dept = (await api.call("POST", "/api/masters/departments", json={"name": "IT Dept (PERF)"}))["id"]
    brand = (await api.call("POST", "/api/masters/brands", json={"name": "PERF Brand"}))["id"]
    await api.call("POST", "/api/code-rules", json={"company_id": None, "prefix_template": "{company.code}/{category.code}/",
                                                     "suffix_template": "", "start_number": 1, "pad_width": 5})
    comp = await api.call("POST", "/api/masters/companies", json={"code": "CKSPL", "name": "CityKart Stores PERF-TEST", "erp_company_code": "CKSPL"})
    cid = comp["id"]
    loc = (await api.call("POST", "/api/masters/locations", json={"company_id": cid, "code": "HO", "name": "Head Office", "address": "1 Perf Road"}))["id"]
    cc = (await api.call("POST", "/api/masters/cost-centers", json={"company_id": cid, "code": "CC-01", "name": "Cost Centre Main"}))["id"]
    room = (await api.call("POST", "/api/stock-rooms", json={"name": "HO Stock Room", "company_id": cid, "location_id": loc}))["id"]
    st = await api.call("POST", "/api/people/stores", json={"code": "SPA", "name": "Perf Test Store SPA", "company_id": cid})
    out.update(company_id=cid, location_id=loc, cost_center_id=cc, stock_room_id=room, store_id=st["store"]["id"],
               install_point_id=st["install_point"]["id"])

    cats = {}
    for dom, code, name, sub in (("IT", "ITFA", "IT Fixed Assets", "LAP"), ("NON_IT", "ADFA", "Admin Fixed Assets", "FUR")):
        cat = await api.call("POST", "/api/masters/categories", json={"code": code, "name": name, "asset_domain": dom})
        sc = await api.call("POST", "/api/masters/subcategories", json={"category_id": cat["id"], "code": sub, "name": sub.title()})
        cats[dom] = (cat["id"], sc["id"])
    laptop = (await api.call("POST", "/api/items", json={"name": "Laptop 14in", "category_id": cats["IT"][0], "subcategory_id": cats["IT"][1],
                                                          "serial_required": True, "default_brand_id": brand, "default_warranty_years": 3}))["id"]
    chair = (await api.call("POST", "/api/items", json={"name": "Office Chair", "category_id": cats["NON_IT"][0], "subcategory_id": cats["NON_IT"][1],
                                                         "serial_required": False, "default_warranty_years": 1}))["id"]
    out.update(laptop_id=laptop, chair_id=chair, categories=cats, brand_id=brand, department_id=dept)
    vendors = []
    for n in range(1, N_VENDORS + 1):
        vendors.append((await api.call("POST", "/api/masters/vendors", json={"name": f"PERF Vendor {n:02d}"}))["id"])
    employees = []
    for n in range(1, N_EMPLOYEES + 1):
        employees.append((await api.call("POST", "/api/people/employees", json={
            "code": f"PFEMP{n:04d}", "name": f"Perf Employee {n:04d}", "company_id": cid, "location_id": loc,
            "department_id": dept, "email": f"pfemp{n:04d}@perf.test"}))["id"])
    out.update(vendor_ids=vendors, employee_ids=employees)
    say(f"masters done in {time.monotonic() - t0:.0f}s")

    async def make_po(number: str, vendor: int, lines: list[dict]) -> dict:
        po = await api.call("POST", "/api/purchase-orders/with-lines", json={
            "company_id": cid, "po_number": number, "po_date": PO_DATE, "vendor_id": vendor, "cost_center_id": cc,
            "delivery_asset_user_id": room, "lines": lines})
        groups = await api.call("GET", f"/api/purchase-orders/{po['id']}/line-groups")
        return {"id": po["id"], "po_number": number, "line_of": {str(g["item_id"]): g["line_no"] for g in groups}}

    bulk = []
    for n in range(1, N_BULK_POS + 1):
        po = await make_po(f"PERF-PO-{n:04d}", vendors[(n - 1) % N_VENDORS], [
            {"item_id": laptop, "quantity": LAPTOPS_PER_PO, "purchase_cost": 60000 + n, "tax_percent": 18},
            {"item_id": chair, "quantity": CHAIRS_PER_PO, "purchase_cost": 4500, "tax_percent": 18}])
        if n <= N_RECEIVED:
            await api.call("POST", f"/api/purchase-orders/{po['id']}/receive", json={
                "received_into_asset_user_id": room, "invoice_number": f"INV-PERF-{n:04d}", "invoice_date": INV_DATE,
                "invoice_amount": round(LAPTOPS_PER_PO * (60000 + n) * 1.18 + CHAIRS_PER_PO * 4500 * 1.18, 2),
                "lines": [{"line_no": po["line_of"][str(laptop)], "quantity": LAPTOPS_PER_PO,
                           "serial_numbers": [f"PFL{n:04d}{k}" for k in range(1, LAPTOPS_PER_PO + 1)]},
                          {"line_no": po["line_of"][str(chair)], "quantity": CHAIRS_PER_PO}]})
        bulk.append(po)
        if n % 25 == 0:
            say(f"  bulk PO {n} ({time.monotonic() - t0:.0f}s)")
    out["bulk_pos"] = [p["id"] for p in bulk]

    # 300 assets to employees (6 bulk moves of 50), so holders / search have variety
    ids = []
    for off in (0, 200):                                # the old code lists at most 200 per page
        listing = await api.call("GET", f"/api/assets?limit=200&offset={off}&asset_user_id={room}")
        ids += [a["id"] for a in listing["items"]]
    ids = sorted(ids)
    for k in range(6):
        await api.call("POST", "/api/assets/bulk-move", json={"asset_ids": ids[k * 50:(k + 1) * 50], "to_asset_user_id": employees[k]})
    say(f"moves done ({time.monotonic() - t0:.0f}s)")

    recv: dict = {}
    for key, item, qty, count in RECEIVE_POS:
        iid = laptop if item == "laptop" else chair
        recv[key] = []
        for n in range(1, count + 1):
            po = await make_po(f"PERF-{key.upper()}-{n:03d}", vendors[n % N_VENDORS],
                               [{"item_id": iid, "quantity": qty, "purchase_cost": 1000 if item == "chair" else 50000, "tax_percent": 18}])
            recv[key].append({"id": po["id"], "line_no": po["line_of"][str(iid)], "qty": qty, "serial": item == "laptop", "n": n})
    out["receive_pos"] = recv
    say(f"receive POs done ({time.monotonic() - t0:.0f}s)")

    # local ERP copy (no ERP link on these stacks)
    now = datetime.now(timezone.utc)
    seen = dict(row_hash=hashlib.sha256(b"perf").hexdigest(), first_seen_at=now, last_seen_at=now, is_present=True)
    async with SessionLocal() as sess:
        sess.add(ErpSyncRun(status="success", trigger="manual", finished_at=now, source_stamp=now, message="perf fixture",
                            po_lines_new=N_ERP_POS * 2, vendors=5, items=2))
        for v in range(1, 6):
            sess.add(ErpVendorCopy(company_code="CKSPL", vendor_code=f"SUP-{v}", name=f"PERF ERP Supplier {v}", gstin="06ABCDE1234F1Z5",
                                   city="Testville", is_extinct=False, **seen))
        sess.add(ErpSiteCopy(company_code="CKSPL", site_code=101, short_name="SPA", site_name="Perf Test Store SPA", store_name="Perf Test Store SPA",
                             site_kind="STORE", store_type="COCO", store_status="ACTIVE", is_active_site=True, state="Haryana", city="Testville", **seen))
        for ic, name in (("ICLAP01", "FA_IT_LAPTOP"), ("ICCHR01", "FA_ADM_CHAIR")):
            sess.add(ErpItemCopy(icode=ic, company_code="CKSPL", article_name=name, section="IT", department="HW", division="FIXED ASSETS",
                                 cat1="X", cat2="Y", hsn="84713010", unit="NOS", **seen))
        for p in range(1, N_ERP_POS + 1):
            po_code = 9100000 + p
            for ln, (ic, q, rate) in enumerate((("ICLAP01", 2, 55000), ("ICCHR01", 5, 4000)), start=1):
                sess.add(ErpPoLineCopy(
                    company_code="CKSPL", po_line_key=f"P-{po_code}-{ln}", po_code=po_code, po_number=f"ERP-PERF-{p:04d}", po_date=TODAY - timedelta(days=15),
                    line_status="OPEN", delivery_location="SPA", delivery_site_kind="STORE", supplier_code=f"SUP-{(p % 5) + 1}",
                    supplier_name=f"PERF ERP Supplier {(p % 5) + 1}", icode=ic, item_description="perf line", group_code="FA",
                    hsn="84713010", unit="NOS", ordqty=q, rate=rate, tax_percent=18, line_netamt=rate * q, rcqty=0, cnlqty=0,
                    hdr_netamt=rate * q * 1.18, hdr_chgamt=0, erp_loaded_at=now, **seen))
        await sess.commit()
    async with SessionLocal() as sess:
        from sqlalchemy import text
        counts = {t: (await sess.execute(text(f"select count(*) from {t}"))).scalar() for t in
                  ("asset", "asset_event", "purchase_order", "vendor", "asset_user", "audit_log", "erp_po_line")}
    out["counts"] = counts
    out["seconds"] = round(time.monotonic() - t0, 1)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    say(f"done in {out['seconds']}s: {counts}")


if __name__ == "__main__":
    asyncio.run(main())
