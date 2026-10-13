from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_asset_user, require_primary_owner
from app.masters.models import Company
from app.numbering.models import CodeRule
from app.numbering.schemas import CodeRuleIn, CodeRuleOut, CodeRulePreviewOut
from app.numbering.service import make_sole_active_rule, render_example, validate_rule

router = APIRouter(prefix="/api/code-rules", tags=["numbering"])


async def _company_code(session: AsyncSession, company_id: int | None) -> str | None:
    if company_id is None:
        return None
    company = await session.get(Company, company_id)
    return company.code if company else None


async def _out(session: AsyncSession, rule: CodeRule) -> CodeRuleOut:
    out = CodeRuleOut.model_validate(rule)
    out.example = render_example(
        rule.prefix_template, rule.suffix_template or "", rule.start_number, rule.pad_width,
        await _company_code(session, rule.company_id),
    )
    return out


async def _validated(session: AsyncSession, body: CodeRuleIn) -> dict:
    """S0.9: a rule is checked when it is saved (tokens, numbers, lengths), not
    at the first asset that uses it."""
    data = body.model_dump()
    if data["company_id"] is not None:
        company = await session.get(Company, data["company_id"])
        if company is None or not company.is_active:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The company you chose does not exist or is no longer active.")
    try:
        validate_rule(data["prefix_template"], data["suffix_template"] or "", data["start_number"], data["pad_width"])
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    return data


@router.get("", response_model=list[CodeRuleOut])
async def list_rules(session: AsyncSession = Depends(get_session), _h=Depends(get_current_asset_user)):
    stmt = select(CodeRule).where(CodeRule.is_active.is_(True)).order_by(CodeRule.id.desc())
    return [await _out(session, rule) for rule in (await session.execute(stmt)).scalars().all()]


@router.post("/preview", response_model=CodeRulePreviewOut)
async def preview_rule(body: CodeRuleIn, session: AsyncSession = Depends(get_session), _h=Depends(get_current_asset_user)):
    """S0.9: checks a code format and shows what its first code would look
    like, without saving anything."""
    data = await _validated(session, body)
    return CodeRulePreviewOut(example=render_example(
        data["prefix_template"], data["suffix_template"] or "", data["start_number"], data["pad_width"],
        await _company_code(session, data["company_id"]),
    ))


@router.post("", response_model=CodeRuleOut, status_code=201)
async def create_rule(body: CodeRuleIn, session: AsyncSession = Depends(get_session), _h=Depends(require_primary_owner())):
    """Creates a rule and makes it the ONLY active one in its scope (global, or
    one company): any previously active rule in that scope is deactivated.
    S0.9: head-office admin (Primary Owner) only; validated before saving."""
    rule = CodeRule(**await _validated(session, body))
    session.add(rule)
    await session.flush()
    await make_sole_active_rule(session, rule)
    await session.commit()
    await session.refresh(rule)
    return await _out(session, rule)


@router.put("/{rule_id}", response_model=CodeRuleOut)
async def update_rule(rule_id: int, body: CodeRuleIn, session: AsyncSession = Depends(get_session), _h=Depends(require_primary_owner())):
    """Edits a rule in place (the Code Rule screen's normal Save path) and makes it
    the single active rule of its -- possibly new -- scope. Head-office admin only."""
    rule = await session.get(CodeRule, rule_id)
    if rule is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This code rule was not found.")
    for key, value in (await _validated(session, body)).items():
        setattr(rule, key, value)
    await session.flush()
    await make_sole_active_rule(session, rule)
    await session.commit()
    await session.refresh(rule)
    return await _out(session, rule)
