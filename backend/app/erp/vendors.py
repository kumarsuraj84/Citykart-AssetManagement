"""Linking CKAM vendors to ERP suppliers, one company at a time.

Each company's ERP numbers its suppliers on its own: code 61 is a different supplier in CKSPL and in
CKVPL, while the same real supplier (same GSTIN) has a different code in each. So a link is
(company, ERP supplier code) -> CKAM vendor, and one CKAM vendor can carry several links. A new ERP
supplier is matched to an existing CKAM vendor by GSTIN first, then by name or code, and a person
confirms; the choice is remembered as a link."""
import re
from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession
from app.asset_users.models import AssetUser
from app.erp.mirror_models import ErpVendorCopy
from app.erp.source import ErpSource, ErpVendor
from app.masters.models import Company, Vendor, VendorErpLink


def _norm(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def _gstin(text: str | None) -> str:
    return re.sub(r"\s", "", (text or "")).upper()


async def company_for_erp(session: AsyncSession, company_id: int) -> Company:
    company = await session.get(Company, company_id)
    if company is None or not company.is_active:
        raise LookupError("company not found")
    return company


async def _active_vendors(session: AsyncSession) -> list[Vendor]:
    return list((await session.execute(select(Vendor).where(Vendor.is_active.is_(True)).order_by(Vendor.id))).scalars().all())


async def known_gstins(session: AsyncSession, vendors: list[Vendor]) -> dict[int, set[str]]:
    """Every GSTIN we know for each vendor: its own, plus the one the ERP holds for each supplier it is linked
    to (a vendor made before the ERP supplied GSTINs may have none of its own, yet its linked supplier does)."""
    known: dict[int, set[str]] = {v.id: ({_gstin(v.gstin)} - {""}) for v in vendors}
    companies = {c.id: c.erp_code for c in (await session.execute(select(Company))).scalars().all()}
    owner = {(companies[l.company_id], l.erp_vendor_code): v.id for v in vendors for l in v.erp_links if l.company_id in companies}
    if owner:
        rows = (await session.execute(
            select(ErpVendorCopy.company_code, ErpVendorCopy.vendor_code, ErpVendorCopy.gstin)
            .where(tuple_(ErpVendorCopy.company_code, ErpVendorCopy.vendor_code).in_(list(owner)), ErpVendorCopy.gstin.is_not(None))
        )).all()
        for company_code, vendor_code, gstin in rows:
            if _gstin(gstin):
                known[owner[(company_code, vendor_code)]].add(_gstin(gstin))
    return known


def suggest_vendor(erp: ErpVendor, vendors: list[Vendor], gstins: dict[int, set[str]] | None = None) -> tuple[Vendor | None, str | None]:
    """The CKAM vendor that is probably the same supplier: the same GSTIN, else the same name or code."""
    gstin = _gstin(erp.gstin)
    if gstin:
        known = gstins if gstins is not None else {v.id: ({_gstin(v.gstin)} - {""}) for v in vendors}
        hit = next((v for v in vendors if gstin in known.get(v.id, set())), None)
        if hit is not None:
            return hit, "gstin"
    keys = {_norm(erp.name), _norm(erp.code)} - {""}
    hit = next((v for v in vendors if _norm(v.name) in keys or _norm(v.code) in keys), None)
    return (hit, "name") if hit is not None else (None, None)


async def list_erp_vendors(session: AsyncSession, source: ErpSource, company_id: int) -> list[dict]:
    """Every ERP supplier of this company, with the CKAM vendor it is linked to or, when not linked, the
    vendor that looks like the same supplier (and why)."""
    company = await company_for_erp(session, company_id)
    erp = await source.vendors(company.erp_code)
    ckam = await _active_vendors(session)
    by_code = {link.erp_vendor_code: v for v in ckam for link in v.erp_links if link.company_id == company.id}
    gstins = await known_gstins(session, ckam)
    out = []
    for e in erp:
        linked = by_code.get(e.code)
        suggestion, reason = (None, None) if linked is not None else suggest_vendor(e, ckam, gstins)
        out.append({
            "company_id": company.id, "erp_code": e.code, "name": e.name, "gstin": e.gstin, "contact_name": e.contact_name,
            "phone": e.phone, "email": e.email, "is_active": e.is_active,
            "linked_vendor_id": linked.id if linked else None, "linked_vendor_name": linked.name if linked else None,
            "suggested_vendor_id": suggestion.id if suggestion else None,
            "suggested_vendor_name": suggestion.name if suggestion else None, "suggestion_reason": reason,
        })
    return out


async def _erp_vendor(source: ErpSource, company: Company, erp_code: str) -> ErpVendor:
    found = next((v for v in await source.vendors(company.erp_code) if v.code == erp_code), None)
    if found is None:
        raise ValueError(f"supplier {erp_code} was not found in the ERP of {company.name}")
    return found


async def _link_row(session: AsyncSession, company_id: int, erp_code: str) -> VendorErpLink | None:
    return (await session.execute(
        select(VendorErpLink).where(VendorErpLink.company_id == company_id, VendorErpLink.erp_vendor_code == erp_code)
    )).scalar_one_or_none()


async def import_vendor(session: AsyncSession, actor: AssetUser, source: ErpSource, company_id: int, erp_code: str) -> Vendor:
    """Creates a CKAM vendor from an ERP supplier of this company, with its link. The vendor Code is the
    ERP supplier code, or `<company>-<code>` when another company's supplier already took that code. A
    supplier whose GSTIN is already a CKAM vendor is not added twice: link it instead."""
    company = await company_for_erp(session, company_id)
    erp = await _erp_vendor(source, company, erp_code)
    if await _link_row(session, company.id, erp_code) is not None:
        raise ValueError(f"{erp.name} is already a vendor here")
    gstin = _gstin(erp.gstin)
    if gstin:
        vendors = await _active_vendors(session)
        known = await known_gstins(session, vendors)
        twin = next((v for v in vendors if gstin in known.get(v.id, set())), None)
        if twin is not None:
            raise ValueError(f"{erp.name} is already a vendor here (same GSTIN as {twin.name}). Link it instead of adding it again.")
    code = erp.code
    if (await session.execute(select(Vendor.id).where(Vendor.code == code).limit(1))).scalar_one_or_none() is not None:
        code = f"{company.code}-{erp.code}"
        if (await session.execute(select(Vendor.id).where(Vendor.code == code).limit(1))).scalar_one_or_none() is not None:
            raise ValueError(f"a vendor with the code {code} already exists; link it instead of adding a new one")
    vendor = Vendor(
        code=code[:100], name=erp.name[:200], gstin=(erp.gstin or None), contact_name=erp.contact_name,
        contact_phone=erp.phone, contact_email=erp.email, created_by=actor.id, updated_by=actor.id,
    )
    vendor.erp_links.append(VendorErpLink(company_id=company.id, erp_vendor_code=erp.code, created_by=actor.id))
    session.add(vendor)
    await session.flush()
    return vendor


async def link_vendor(session: AsyncSession, actor: AssetUser, source: ErpSource, vendor_id: int, company_id: int, erp_code: str) -> Vendor:
    vendor = await session.get(Vendor, vendor_id)
    if vendor is None or not vendor.is_active:
        raise LookupError("vendor not found")
    company = await company_for_erp(session, company_id)
    erp = await _erp_vendor(source, company, erp_code)
    other = await _link_row(session, company.id, erp_code)
    if other is not None:
        if other.vendor_id == vendor.id:
            return vendor
        owner = await session.get(Vendor, other.vendor_id)
        raise ValueError(f"{erp.name} is already linked to the vendor {owner.name if owner else other.vendor_id}")
    vendor.erp_links.append(VendorErpLink(company_id=company.id, erp_vendor_code=erp.code, created_by=actor.id))
    if not _gstin(vendor.gstin) and _gstin(erp.gstin):
        vendor.gstin = erp.gstin.strip()       # a vendor made before the ERP supplied GSTINs gets it now, so later matching works
    vendor.updated_by = actor.id
    await session.flush()
    return vendor


async def unlink_vendor(session: AsyncSession, actor: AssetUser, vendor_id: int, company_id: int, erp_code: str) -> Vendor:
    vendor = await session.get(Vendor, vendor_id)
    if vendor is None:
        raise LookupError("vendor not found")
    link = next((l for l in vendor.erp_links if l.company_id == company_id and l.erp_vendor_code == erp_code), None)
    if link is None:
        raise LookupError("that link was not found")
    vendor.erp_links.remove(link)
    vendor.updated_by = actor.id
    await session.flush()
    return vendor
