import asyncio

import pytest
from app.numbering.service import resolve_prefix, generate_code
from app.core.db import SessionLocal
from app.numbering.models import CodeRule


def _rule(**overrides):
    defaults = dict(company_id=None, prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_",
                    suffix_template="", start_number=1, pad_width=0)
    defaults.update(overrides)
    return CodeRule(**defaults)


def test_resolve_prefix_substitutes_tokens():
    rule = _rule()
    tokens = {"cost_center.code": "HO01", "category.code": "IT", "subcategory.code": "LAP"}
    assert resolve_prefix(rule, tokens) == "FA/HO01/IT/LAP/CK_"


def test_resolve_prefix_rejects_empty_token():
    rule = _rule(prefix_template="FA/{cost_center.code}/{category.code}/{subcategory.code}/CK_")
    tokens = {"cost_center.code": "HO01", "category.code": "IT", "subcategory.code": ""}
    with pytest.raises(ValueError, match="subcategory"):
        resolve_prefix(rule, tokens)


def test_resolve_prefix_rejects_unknown_token():
    rule = _rule(prefix_template="FA/{not_a_real_token}/CK_")
    with pytest.raises(ValueError, match="unknown token"):
        resolve_prefix(rule, {})


async def test_generate_code_separate_counter_per_prefix():
    rule = _rule(pad_width=0)
    async with SessionLocal() as session:
        code_a1 = await generate_code(session, rule, {"cost_center.code": "HO01", "category.code": "IT", "subcategory.code": "LAP"})
        code_a2 = await generate_code(session, rule, {"cost_center.code": "HO01", "category.code": "IT", "subcategory.code": "LAP"})
        code_b1 = await generate_code(session, rule, {"cost_center.code": "BAC01", "category.code": "IT", "subcategory.code": "MOU"})
        await session.commit()

    assert code_a1 == "FA/HO01/IT/LAP/CK_1"
    assert code_a2 == "FA/HO01/IT/LAP/CK_2"
    assert code_b1 == "FA/BAC01/IT/MOU/CK_1"


async def test_generate_code_concurrent_calls_never_collide():
    """Fires many concurrent generate_code calls at the same resolved prefix,
    each in its own session/transaction (simulating separate concurrent
    requests), and asserts the atomic UPSERT-based counter hands out a
    strictly unique, gapless set of numbers with no duplicates. This is the
    core correctness property of the numbering module: two IT staff saving
    assets at the same moment must never receive the same code.
    """
    rule = _rule(pad_width=0)
    tokens = {"cost_center.code": "HO01", "category.code": "IT", "subcategory.code": "SRV"}

    async def _one():
        async with SessionLocal() as session:
            code = await generate_code(session, rule, tokens)
            await session.commit()
            return code

    n = 25
    codes = await asyncio.gather(*[_one() for _ in range(n)])

    assert len(codes) == len(set(codes)), f"duplicate codes generated: {codes}"

    numbers = sorted(int(c.rsplit("_", 1)[1]) for c in codes)
    assert numbers == list(range(1, n + 1)), f"expected a gapless 1..{n} sequence, got {numbers}"
