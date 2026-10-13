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


# ---- S3a-2: matching a supplier by GSTIN, then PAN, then the stem of its name ----------------------

_PAN = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")


def pan_of(gstin: str | None) -> str | None:
    """The PAN inside a GSTIN (characters 3-12), when the GSTIN looks real: 15 characters, a two-digit
    state code, and a PAN of the usual shape (5 letters, 4 digits, 1 letter). Every GST registration of
    one business (one per state) carries the same PAN, so it ties the registrations together."""
    g = _gstin(gstin)
    if len(g) != 15 or not g[:2].isdigit():
        return None
    pan = g[2:12]
    return pan if _PAN.match(pan) else None


# Words that only say what kind of company it is; dropped from the END of a name.
LEGAL_WORDS = frozenset({"LTD", "LIMITED", "PVT", "PRIVATE", "P", "CO", "COMPANY", "INC", "LLP", "CORP", "CORPORATION", "AND"})
# A state, its usual short form, or a big city, as ERP suppliers tack them onto the name of one
# registration ("BLUE STAR LTD (MP)", "BLUE STAR LTD-KOLKATA", "BLUE STAR LIMITED : UP", "VANSH ENTERPRISES_DEL").
LOCATION_WORDS = frozenset({
    "UP", "MP", "HR", "DL", "DEL", "NCR", "WB", "BR", "BH", "RJ", "PB", "GJ", "MH", "MUM", "KA", "TN", "AP", "TS", "TG", "OD", "OR",
    "JH", "CG", "UK", "UA", "HP", "JK", "AS", "KL", "GA", "CH",
    "UTTARPRADESH", "MADHYAPRADESH", "HARYANA", "DELHI", "NEWDELHI", "WESTBENGAL", "BIHAR", "RAJASTHAN", "PUNJAB", "GUJARAT",
    "MAHARASHTRA", "KARNATAKA", "TAMILNADU", "ANDHRAPRADESH", "TELANGANA", "ODISHA", "ORISSA", "JHARKHAND", "CHHATTISGARH",
    "UTTARAKHAND", "UTTRAKHAND", "HIMACHALPRADESH", "JAMMUKASHMIR", "ASSAM", "KERALA", "GOA", "CHANDIGARH",
    "KOLKATA", "CALCUTTA", "MUMBAI", "BOMBAY", "NOIDA", "GURGAON", "GURUGRAM", "GHAZIABAD", "FARIDABAD", "LUCKNOW", "KANPUR",
    "PATNA", "JAIPUR", "INDORE", "BHOPAL", "AHMEDABAD", "BANGALORE", "BENGALURU", "CHENNAI", "HYDERABAD", "PUNE", "VARANASI",
    "AGRA", "MEERUT", "RANCHI", "DEHRADUN", "LUDHIANA", "AMRITSAR", "JAMSHEDPUR", "GORAKHPUR", "PRAYAGRAJ", "ALLAHABAD",
    "BAREILLY", "ALIGARH", "SONIPAT", "PANIPAT", "KARNAL", "ROHTAK", "HISAR", "AMBALA",
})
_TRAILING_BRACKET = re.compile(r"\s*\([^()]*\)\s*$")
_TRAILING_QUALIFIER = re.compile(r"^(?P<head>.*?)\s*[-:_/,]\s*(?P<tail>[A-Z][A-Z .]*)$")


def _ends_with_legal_word(text: str) -> bool:
    words = re.findall(r"[A-Z0-9]+", text)
    return bool(words) and words[-1] in LEGAL_WORDS - {"AND"}


def name_stem(name: str | None) -> str | None:
    """A supplier name reduced to what identifies the business, so the registrations of one supplier
    compare equal: upper case; a trailing "(...)" dropped; a trailing "-KOLKATA" / ": UP" / "_DEL" dropped
    when it is a state or city, or when it follows a company word (LTD, LIMITED...); punctuation ignored;
    "M/S" / "THE" in front and company words at the end (LTD, LIMITED, PVT, PRIVATE, P, CO, COMPANY, INC,
    LLP, CORP) dropped. "BLUE STAR LTD (MP)", "Blue Star Limited-KOLKATA" and "BLUE STAR LIMITED : UP" all
    give "BLUESTAR". None when too little is left (under 3 characters) to compare safely."""
    text = (name or "").upper().replace("&", " AND ").strip()
    while True:
        cut = _TRAILING_BRACKET.sub("", text)
        match = _TRAILING_QUALIFIER.match(cut)
        if match:
            tail = re.sub(r"[^A-Z]", "", match.group("tail"))
            if tail in LOCATION_WORDS or _ends_with_legal_word(match.group("head")):
                cut = match.group("head")
        if cut == text:
            break
        text = cut
    words = re.findall(r"[A-Z0-9]+", text)
    while words and words[0] in ("M", "MS", "THE") and len(words) > 1:
        if words[0] == "M" and words[1] == "S":
            words = words[2:]
        elif words[0] in ("MS", "THE"):
            words = words[1:]
        else:
            break
    while words:
        if words[-1] in LEGAL_WORDS:
            words.pop()
        elif words[-1] in LOCATION_WORDS and len(words) > 1 and words[-2] in LEGAL_WORDS:
            words.pop()
        else:
            break
    stem = "".join(words)
    return stem if len(stem) >= 3 else None


def group_key(company_code: str | None, erp_code: str, gstin: str | None) -> str:
    """The registrations of one supplier inside one company's ERP: company + PAN. A supplier without a
    usable PAN is a group of its own (company + "#" + its code)."""
    pan = pan_of(gstin)
    return f"{company_code}:{pan}" if pan else f"{company_code}:#{erp_code}"


REASON_ORDER = ("GSTIN", "PAN", "NAME")


def suggest_vendors(erp: ErpVendor, vendors: list[Vendor], gstins: dict[int, set[str]] | None = None) -> list[tuple[Vendor, str]]:
    """Every CKAM vendor that may be the same supplier, strongest first: the same GSTIN (its own, or one the
    ERP holds for a supplier it is linked to), then the same PAN (another state registration of the same
    business), then the same name or code, or the same name stem. Only suggestions: a person confirms."""
    known = gstins if gstins is not None else {v.id: ({_gstin(v.gstin)} - {""}) for v in vendors}
    out: list[tuple[Vendor, str]] = []
    seen: set[int] = set()

    def add(v: Vendor, reason: str) -> None:
        if v.id not in seen:
            seen.add(v.id)
            out.append((v, reason))

    gstin = _gstin(erp.gstin)
    if gstin:
        for v in vendors:
            if gstin in known.get(v.id, set()):
                add(v, "GSTIN")
    pan = pan_of(erp.gstin)
    if pan:
        for v in vendors:
            if any(pan_of(g) == pan for g in known.get(v.id, set())):
                add(v, "PAN")
    keys = {_norm(erp.name), _norm(erp.code)} - {""}
    for v in vendors:
        if _norm(v.name) in keys or _norm(v.code) in keys:
            add(v, "NAME")
    stem = name_stem(erp.name)
    if stem:
        for v in vendors:
            if name_stem(v.name) == stem:
                add(v, "NAME")
    return out


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
    """The CKAM vendor that is probably the same supplier: the same GSTIN, else (S3a-2) the same PAN, else
    the same name or code (or name stem). Reason in lower case ("gstin" / "pan" / "name"), as before."""
    found = suggest_vendors(erp, vendors, gstins)
    return (found[0][0], found[0][1].lower()) if found else (None, None)


def group_link_vendor(members: list[str], self_code: str, by_code: dict[str, Vendor]) -> int | None:
    """When the other registrations of a group are linked, and all to ONE vendor: that vendor's id."""
    linked = {by_code[c].id for c in members if c != self_code and c in by_code}
    return next(iter(linked)) if len(linked) == 1 else None


async def list_erp_vendors(session: AsyncSession, source: ErpSource, company_id: int) -> list[dict]:
    """Every ERP supplier of this company, with the CKAM vendor it is linked to or, when not linked, the
    vendor that looks like the same supplier (and why). S3a-2 (additive): the supplier's PAN and its PAN
    group in this company (`group_key`, `group_size`, and the one vendor the group's other registrations
    are already linked to, which is then the suggestion)."""
    company = await company_for_erp(session, company_id)
    erp = await source.vendors(company.erp_code)
    ckam = await _active_vendors(session)
    by_id = {v.id: v for v in ckam}
    by_code = {link.erp_vendor_code: v for v in ckam for link in v.erp_links if link.company_id == company.id}
    gstins = await known_gstins(session, ckam)
    groups: dict[str, list[str]] = {}
    for e in erp:
        groups.setdefault(group_key(company.erp_code, e.code, e.gstin), []).append(e.code)
    out = []
    for e in erp:
        linked = by_code.get(e.code)
        key = group_key(company.erp_code, e.code, e.gstin)
        sibling_vendor = group_link_vendor(groups[key], e.code, by_code)
        suggestion, reason = (None, None)
        if linked is None:
            if sibling_vendor is not None and sibling_vendor in by_id:
                suggestion, reason = by_id[sibling_vendor], "pan"
            else:
                suggestion, reason = suggest_vendor(e, ckam, gstins)
        out.append({
            "company_id": company.id, "erp_code": e.code, "name": e.name, "gstin": e.gstin, "contact_name": e.contact_name,
            "phone": e.phone, "email": e.email, "is_active": e.is_active,
            "linked_vendor_id": linked.id if linked else None, "linked_vendor_name": linked.name if linked else None,
            "suggested_vendor_id": suggestion.id if suggestion else None,
            "suggested_vendor_name": suggestion.name if suggestion else None, "suggestion_reason": reason,
            "pan": pan_of(e.gstin), "group_key": key, "group_size": len(groups[key]),
            "group_linked_to_vendor_id": sibling_vendor,
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


MAX_GROUP_CODES = 50


def _clean_codes(codes: list[str]) -> list[str]:
    out: list[str] = []
    for raw in codes or []:
        code = (raw or "").strip()
        if code and code not in out:
            out.append(code)
    if not out:
        raise ValueError("Choose at least one ERP supplier.")
    if len(out) > MAX_GROUP_CODES:
        raise ValueError(f"Choose at most {MAX_GROUP_CODES} ERP suppliers at a time.")
    return out


async def _erp_suppliers(source: ErpSource, company: Company, codes: list[str]) -> list[ErpVendor]:
    """The ERP suppliers with these codes in this company's ERP, in the order asked (one read of the list)."""
    found = {v.code: v for v in await source.vendors(company.erp_code)}
    missing = [c for c in codes if c not in found]
    if missing:
        raise ValueError(f"The ERP supplier {missing[0]} was not found in the ERP of {company.name}.")
    return [found[c] for c in codes]


async def _links_of(session: AsyncSession, company_id: int, codes: list[str]) -> dict[str, VendorErpLink]:
    rows = (await session.execute(
        select(VendorErpLink).where(VendorErpLink.company_id == company_id, VendorErpLink.erp_vendor_code.in_(codes))
    )).scalars().all()
    return {r.erp_vendor_code: r for r in rows}


async def link_codes(
    session: AsyncSession, actor: AssetUser, source: ErpSource, vendor_id: int, company_id: int, codes: list[str],
) -> dict:
    """S3a-2: links several ERP suppliers of ONE company to one existing, active vendor -- all or nothing.
    Every code must be a supplier of that company's ERP and not linked to another vendor (one already linked
    to this vendor is left as it is); a supplier whose GSTIN is already known for ANOTHER vendor is refused
    (it is that vendor). Nothing is ever linked without being asked for. Returns what was linked."""
    vendor = await session.get(Vendor, vendor_id)
    if vendor is None:
        raise LookupError("This vendor was not found.")
    if not vendor.is_active:
        raise ValueError(f"The vendor {vendor.name} is no longer active; choose another.")
    company = await company_for_erp(session, company_id)
    codes = _clean_codes(codes)
    suppliers = await _erp_suppliers(source, company, codes)
    existing = await _links_of(session, company.id, codes)
    others = {l.vendor_id for l in existing.values() if l.vendor_id != vendor.id}
    owners = {v.id: v for v in (await session.execute(select(Vendor).where(Vendor.id.in_(others)))).scalars().all()} if others else {}
    for s in suppliers:
        link = existing.get(s.code)
        if link is not None and link.vendor_id != vendor.id:
            owner = owners.get(link.vendor_id)
            raise ValueError(f"{s.name} is already linked to the vendor {owner.name if owner else 'another vendor'}.")
    vendors = await _active_vendors(session)
    known = await known_gstins(session, vendors)
    for s in suppliers:
        gstin = _gstin(s.gstin)
        twin = next((v for v in vendors if v.id != vendor.id and gstin and gstin in known.get(v.id, set())), None)
        if twin is not None:
            raise ValueError(f"{s.name} has the same GSTIN as {twin.name}, which is already a vendor here. Link it to {twin.name} instead.")
    linked, already = [], []
    for s in suppliers:
        if s.code in existing:
            already.append(s.code)
            continue
        vendor.erp_links.append(VendorErpLink(company_id=company.id, erp_vendor_code=s.code, created_by=actor.id))
        linked.append(s.code)
    if not _gstin(vendor.gstin):
        first = next((s.gstin.strip() for s in suppliers if _gstin(s.gstin)), None)
        if first:
            vendor.gstin = first       # as a single link does: later matching by GSTIN / PAN then works
    vendor.updated_by = actor.id
    await session.flush()
    return {"vendor": vendor, "linked": linked, "already_linked": already}


async def create_vendor_for_codes(
    session: AsyncSession, actor: AssetUser, source: ErpSource, company_id: int, codes: list[str], name: str | None = None,
) -> Vendor:
    """S3a-2: ONE new vendor for several registrations of a supplier in one company (or for one): named
    after the first one asked for (or `name`), with the first GSTIN and the first one's contact details, a
    code made from the name (as for any vendor added in the flow), and a link for every code -- all or
    nothing. Refused when a code is already linked, or when any registration's GSTIN is already a vendor
    here (link it instead)."""
    from app.core.codes import unique_code              # local: keeps this module's imports light
    company = await company_for_erp(session, company_id)
    codes = _clean_codes(codes)
    suppliers = await _erp_suppliers(source, company, codes)
    existing = await _links_of(session, company.id, codes)
    if existing:
        s = next(s for s in suppliers if s.code in existing)
        raise ValueError(f"{s.name} is already a vendor here (already linked). Link the others to that vendor instead.")
    vendors = await _active_vendors(session)
    known = await known_gstins(session, vendors)
    for s in suppliers:
        gstin = _gstin(s.gstin)
        twin = next((v for v in vendors if gstin and gstin in known.get(v.id, set())), None)
        if twin is not None:
            raise ValueError(f"{s.name} is already a vendor here (same GSTIN as {twin.name}). Link it instead.")
    first = suppliers[0]
    vendor_name = ((name or "").strip() or first.name.strip())[:200]
    if not vendor_name:
        raise ValueError("The vendor needs a name.")
    code = await unique_code(session, Vendor, vendor_name, max_length=30, fallback="VENDOR")
    gstin = next((s.gstin.strip() for s in suppliers if _gstin(s.gstin)), None)
    vendor = Vendor(
        code=code, name=vendor_name, gstin=gstin, contact_name=first.contact_name, contact_phone=first.phone,
        contact_email=first.email, created_by=actor.id, updated_by=actor.id,
    )
    for s in suppliers:
        vendor.erp_links.append(VendorErpLink(company_id=company.id, erp_vendor_code=s.code, created_by=actor.id))
    session.add(vendor)
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
