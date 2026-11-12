"""Test helper: puts a purchase invoice (PI) into CKAM's copy of the ERP data, as the ERP copy would."""
from datetime import date, datetime, timezone

from app.core.db import SessionLocal
from app.erp.mirror_models import ErpPiCopy, bill_key


async def copy_pi(pi_code=1, pi_number="PI-100", bill="INV-1", vendor_code="11338", vendor_name="VANSH ENTERPRISES", status="P",
                  amount=1000.0, pi_day=28, company="CKSPL", present=True) -> None:
    now = datetime.now(timezone.utc)
    async with SessionLocal() as session:
        session.add(ErpPiCopy(
            company_code=company, pi_code=pi_code, pi_number=pi_number, pi_date=date(2026, 9, pi_day), vendor_code=vendor_code,
            vendor_name=vendor_name, bill_no=bill, bill_no_norm=bill_key(bill), bill_date=date(2026, 9, 20), amount=amount,
            lines_amount=round(amount * 0.85, 2) if amount is not None else None, release_status=status, lines=1, row_hash="test",
            first_seen_at=now, last_seen_at=now, is_present=present))
        await session.commit()
