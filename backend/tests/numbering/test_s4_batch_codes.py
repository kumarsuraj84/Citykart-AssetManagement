"""S4: asset codes for a whole batch with one counter update per code prefix (generate_codes /
reserve_codes), continuing the same counters generate_code uses, unique and gap-free."""
from sqlalchemy import select

from app.core.db import SessionLocal
from app.numbering.models import CodeCounter, CodeRule
from app.numbering.service import generate_code, generate_codes, reserve_codes
from tests.purchase_orders.s4_world import Statements


async def test_a_batch_reserves_one_block_per_prefix_and_keeps_the_order_asked():
    async with SessionLocal() as s:
        rule = CodeRule(company_id=None, prefix_template="X/", suffix_template="-K", start_number=5, pad_width=3)
        s.add(rule)
        await s.flush()
        with Statements() as counted:
            codes = await generate_codes(s, rule, ["B/", "A/", "B/", "A/", "B/"])
        assert codes == ["B/005-K", "A/005-K", "B/006-K", "A/006-K", "B/007-K"]
        assert counted.count == 2                           # one statement per distinct prefix
        await s.commit()
        counters = dict((await s.execute(select(CodeCounter.resolved_prefix, CodeCounter.next_value))).all())
        assert counters == {"A/": 7, "B/": 8}


async def test_single_and_batch_codes_share_one_counter():
    async with SessionLocal() as s:
        rule = CodeRule(company_id=None, prefix_template="FA/{category.code}/", suffix_template="", start_number=1, pad_width=0)
        s.add(rule)
        await s.flush()
        tokens = {"category.code": "IT"}
        assert await generate_code(s, rule, tokens) == "FA/IT/1"
        assert await reserve_codes(s, rule, "FA/IT/", 3) == ["FA/IT/2", "FA/IT/3", "FA/IT/4"]
        assert await generate_code(s, rule, tokens) == "FA/IT/5"
        assert await reserve_codes(s, rule, "FA/IT/", 0) == []
        assert await generate_codes(s, rule, []) == []
        await s.rollback()
