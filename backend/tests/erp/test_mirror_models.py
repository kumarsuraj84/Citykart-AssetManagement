"""CKAM's own copy of the ERP data: the tables exist and keep each company's rows apart."""
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.db import SessionLocal
from app.erp.mirror_models import ErpItemCopy, ErpPoLineCopy, ErpSyncRun, ErpVendorCopy

NOW = datetime(2026, 10, 13, 6, 0, tzinfo=timezone.utc)


def po_line(company="CKSPL", key="L1", **over):
    base = dict(
        company_code=company, po_line_key=key, po_code=1134078554, po_number="GPO/001503/26-27", po_date=date(2026, 10, 1),
        line_status="OPEN", delivery_location="BWR", delivery_site_kind="STORE", supplier_code="4431", supplier_name="TRAANS GLOBAL",
        icode="CT371487", item_description="-|TRAANS GLOBAL|6000 K", group_code="FA_EF_LIGHTS", hsn="9405", unit="PCS",
        ordqty=105, rate=450, tax_percent=18, line_netamt=55755, rcqty=0, cnlqty=0, hdr_netamt=55755, hdr_chgamt=0,
        row_hash="h" * 64, first_seen_at=NOW, last_seen_at=NOW, is_present=True,
    )
    base.update(over)
    return ErpPoLineCopy(**base)


async def test_the_same_line_key_is_one_row_per_company():
    async with SessionLocal() as s:
        s.add_all([po_line("CKSPL", "L1"), po_line("CKVPL", "L1")])
        await s.commit()
        rows = (await s.execute(select(ErpPoLineCopy))).scalars().all()
        assert sorted(r.company_code for r in rows) == ["CKSPL", "CKVPL"]


async def test_a_company_cannot_have_two_rows_for_one_line_key():
    async with SessionLocal() as s:
        s.add(po_line("CKSPL", "L1"))
        await s.commit()
    async with SessionLocal() as s:
        s.add(po_line("CKSPL", "L1"))
        with pytest.raises(IntegrityError):
            await s.commit()


async def test_vendors_items_and_runs_are_stored():
    async with SessionLocal() as s:
        s.add_all([
            ErpVendorCopy(company_code="CKSPL", vendor_code="2470", name="JS TECHNOLOGY", gstin="07AAAAA0000A1Z5", city="DELHI",
                          is_extinct=False, row_hash="v" * 64, first_seen_at=NOW, last_seen_at=NOW, is_present=True),
            ErpVendorCopy(company_code="CKVPL", vendor_code="2470", name="SOMEONE ELSE", gstin=None, city=None,
                          is_extinct=False, row_hash="w" * 64, first_seen_at=NOW, last_seen_at=NOW, is_present=True),
            ErpItemCopy(icode="CT371487", company_code="CKSPL", article_name="FA_EF_LINEAR LIGHT", section="ELECTRICAL FITTING",
                        department="FA_EF_LIGHTS", division="FIXED ASSETS", cat1="-", cat2="TRAANS GLOBAL", hsn="9405", unit="PCS",
                        row_hash="i" * 64, first_seen_at=NOW, last_seen_at=NOW, is_present=True),
            ErpSyncRun(started_at=NOW, status="success", trigger="manual", po_lines_new=1),
        ])
        await s.commit()
        vendors = (await s.execute(select(ErpVendorCopy).order_by(ErpVendorCopy.company_code))).scalars().all()
        assert [(v.company_code, v.vendor_code) for v in vendors] == [("CKSPL", "2470"), ("CKVPL", "2470")]
        run = (await s.execute(select(ErpSyncRun))).scalar_one()
        assert run.id is not None and run.po_lines_changed == 0 and run.po_lines_gone == 0
