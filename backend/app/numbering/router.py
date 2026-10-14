from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_asset_user, require_primary_owner
from app.masters.models import Company
from app.numbering.models import CodeRule
from app.numbering.schemas import CodeRuleIn, CodeRuleOut, CodeRulePreviewOut
from app.numbering.service import company_example_tokens, make_sole_active_rule, render_example, validate_rule
from app.observability import events as obs_events
from app.observability import writer as obs_writer

router = APIRouter(prefix="/api/code-rules", tags=["numbering"])


async def _example_company(session: AsyncSession, company_id: int | None) -> int | None:
    """S7 fix 2 (N4): the company an example is shown for (`?company_id=`); an unknown one is a 404."""
    if company_id is None:
        return None
    company = await session.get(Company, company_id)
    if company is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This company was not found.")
    return company.id


async def _out(session: AsyncSession, rule: CodeRule, example_company_id: int | None = None) -> CodeRuleOut:
    """The rule with its example: in its own company's values (a company rule), or in `example_company_id`'s
    values (a rule for every company, shown for one company), else the generic sample."""
    out = CodeRuleOut.model_validate(rule)
    out.example = render_example(
        rule.prefix_template, rule.suffix_template or "", rule.start_number, rule.pad_width,
        tokens=await company_example_tokens(session, rule.company_id or example_company_id),
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
async def list_rules(company_id: int | None = None, session: AsyncSession = Depends(get_session),
                     _h=Depends(get_current_asset_user)):
    """The active rules. S7 fix 2 (N4): `?company_id=` shows each rule's example in that company's values
    (code, location, cost centre); a company's own rule always uses its own."""
    example_company = await _example_company(session, company_id)
    stmt = select(CodeRule).where(CodeRule.is_active.is_(True)).order_by(CodeRule.id.desc())
    return [await _out(session, rule, example_company) for rule in (await session.execute(stmt)).scalars().all()]


@router.post("/preview", response_model=CodeRulePreviewOut)
async def preview_rule(body: CodeRuleIn, company_id: int | None = None, session: AsyncSession = Depends(get_session),
                       _h=Depends(get_current_asset_user)):
    """S0.9: checks a code format and shows what its first code would look like, without saving anything.
    S7 fix 2 (N4): the example uses one company's own values (code, first location, first cost centre;
    the generic sample for what it does not have yet): `?company_id=` (e.g. the company being set up while
    the rule itself is for every company), else the rule's own `company_id`; neither = the generic sample."""
    data = await _validated(session, body)
    example_company = await _example_company(session, company_id) if company_id is not None else data["company_id"]
    return CodeRulePreviewOut(example=render_example(
        data["prefix_template"], data["suffix_template"] or "", data["start_number"], data["pad_width"],
        tokens=await company_example_tokens(session, example_company),
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
    await _security_row("created", rule)
    return await _out(session, rule)


async def _security_row(verb: str, rule: CodeRule) -> None:
    """S8: the asset-code format decides every new asset code, so a change is also a SECURITY row (besides
    the DATA row with the changed fields)."""
    scope = f"company {rule.company_id}" if rule.company_id else "every company"
    await obs_writer.security("CODE_RULE_CHANGED", f"{obs_events.who()} {verb} the asset code format for {scope}: "
                              f"'{rule.prefix_template}{rule.suffix_template or ''}'.", entity="code_rule",
                              entity_id=rule.id, company_id=rule.company_id,
                              changes={"prefix_template": rule.prefix_template, "suffix_template": rule.suffix_template,
                                       "start_number": rule.start_number, "pad_width": rule.pad_width})


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
    await _security_row("changed", rule)
    return await _out(session, rule)
