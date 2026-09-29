from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_asset_user, require_role
from app.numbering.models import CodeRule
from app.numbering.schemas import CodeRuleIn, CodeRuleOut
from app.numbering.service import make_sole_active_rule

router = APIRouter(prefix="/api/code-rules", tags=["numbering"])


@router.get("", response_model=list[CodeRuleOut])
async def list_rules(session: AsyncSession = Depends(get_session), _h=Depends(get_current_asset_user)):
    stmt = select(CodeRule).where(CodeRule.is_active.is_(True)).order_by(CodeRule.id.desc())
    return (await session.execute(stmt)).scalars().all()


@router.post("", response_model=CodeRuleOut, status_code=201)
async def create_rule(body: CodeRuleIn, session: AsyncSession = Depends(get_session), _h=Depends(require_role("ADMIN"))):
    """Creates a rule and makes it the ONLY active one in its scope (global, or
    one company): any previously active rule in that scope is deactivated."""
    rule = CodeRule(**body.model_dump())
    session.add(rule)
    await session.flush()
    await make_sole_active_rule(session, rule)
    await session.commit()
    await session.refresh(rule)
    return rule


@router.put("/{rule_id}", response_model=CodeRuleOut)
async def update_rule(rule_id: int, body: CodeRuleIn, session: AsyncSession = Depends(get_session), _h=Depends(require_role("ADMIN"))):
    """Edits a rule in place (the Code Rule screen's normal Save path) and makes it
    the single active rule of its -- possibly new -- scope."""
    rule = await session.get(CodeRule, rule_id)
    if rule is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    for key, value in body.model_dump().items():
        setattr(rule, key, value)
    await session.flush()
    await make_sole_active_rule(session, rule)
    await session.commit()
    await session.refresh(rule)
    return rule
