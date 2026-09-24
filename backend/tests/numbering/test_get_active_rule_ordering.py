"""AM-05 §36: dedicated coverage for get_active_rule's ordering (a
company-specific active rule beats the global one) and its no-rule-found
error -- a documented gap (REVIEW_FINDINGS.md) since AM-01, since it was
previously only exercised indirectly through asset creation."""
import pytest
from app.core.db import SessionLocal
from app.masters.models import Company
from app.numbering.models import CodeRule
from app.numbering.service import get_active_rule


def _rule(**overrides):
    defaults = dict(company_id=None, prefix_template="FA/GAR_", suffix_template="", start_number=1, pad_width=0)
    defaults.update(overrides)
    return CodeRule(**defaults)


async def test_company_specific_rule_beats_global_rule():
    async with SessionLocal() as session:
        co = Company(code="GAR1", name="GAR1 Co")
        session.add(co)
        await session.flush()
        global_rule = _rule(prefix_template="FA/GLOBAL_")
        company_rule = _rule(company_id=co.id, prefix_template="FA/COMPANY_")
        session.add_all([global_rule, company_rule])
        await session.commit()

        picked = await get_active_rule(session, co.id)
        assert picked.prefix_template == "FA/COMPANY_"


async def test_falls_back_to_global_rule_when_no_company_specific_rule_exists():
    async with SessionLocal() as session:
        co = Company(code="GAR2", name="GAR2 Co")
        session.add(co)
        await session.flush()
        global_rule = _rule(prefix_template="FA/GLOBAL_")
        session.add(global_rule)
        await session.commit()

        picked = await get_active_rule(session, co.id)
        assert picked.prefix_template == "FA/GLOBAL_"


async def test_ignores_another_companys_rule():
    async with SessionLocal() as session:
        co_a = Company(code="GAR3A", name="GAR3A Co")
        co_b = Company(code="GAR3B", name="GAR3B Co")
        session.add_all([co_a, co_b])
        await session.flush()
        global_rule = _rule(prefix_template="FA/GLOBAL_")
        other_company_rule = _rule(company_id=co_b.id, prefix_template="FA/OTHER_")
        session.add_all([global_rule, other_company_rule])
        await session.commit()

        picked = await get_active_rule(session, co_a.id)
        assert picked.prefix_template == "FA/GLOBAL_"


async def test_ignores_an_inactive_company_specific_rule():
    async with SessionLocal() as session:
        co = Company(code="GAR4", name="GAR4 Co")
        session.add(co)
        await session.flush()
        global_rule = _rule(prefix_template="FA/GLOBAL_")
        inactive_company_rule = _rule(company_id=co.id, prefix_template="FA/INACTIVE_", is_active=False)
        session.add_all([global_rule, inactive_company_rule])
        await session.commit()

        picked = await get_active_rule(session, co.id)
        assert picked.prefix_template == "FA/GLOBAL_"


async def test_raises_a_clear_error_when_no_active_rule_exists_at_all():
    async with SessionLocal() as session:
        co = Company(code="GAR5", name="GAR5 Co")
        session.add(co)
        await session.commit()

        with pytest.raises(ValueError, match="no active code rule configured"):
            await get_active_rule(session, co.id)
