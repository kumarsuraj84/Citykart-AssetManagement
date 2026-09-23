from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.db import get_session
from app.core.deps import get_current_holder, require_role
from app.numbering.models import CodeRule
from app.numbering.schemas import CodeRuleIn, CodeRuleOut

router = APIRouter(prefix="/api/code-rules", tags=["numbering"])


@router.get("", response_model=list[CodeRuleOut])
async def list_rules(session: AsyncSession = Depends(get_session), _h=Depends(get_current_holder)):
    stmt = select(CodeRule).where(CodeRule.is_active.is_(True))
    return (await session.execute(stmt)).scalars().all()


@router.post("", response_model=CodeRuleOut, status_code=201)
async def create_rule(body: CodeRuleIn, session: AsyncSession = Depends(get_session), _h=Depends(require_role("ADMIN"))):
    rule = CodeRule(**body.model_dump())
    session.add(rule)
    await session.commit()
    await session.refresh(rule)
    return rule


@router.put("/{rule_id}", response_model=CodeRuleOut)
async def update_rule(rule_id: int, body: CodeRuleIn, session: AsyncSession = Depends(get_session), _h=Depends(require_role("ADMIN"))):
    rule = await session.get(CodeRule, rule_id)
    if rule is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    for key, value in body.model_dump().items():
        setattr(rule, key, value)
    await session.commit()
    await session.refresh(rule)
    return rule
