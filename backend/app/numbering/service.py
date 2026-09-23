import re
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from app.numbering.models import CodeCounter, CodeRule

_TOKEN_RE = re.compile(r"\{([a-zA-Z0-9_.]+)\}")


def resolve_prefix(rule: CodeRule, tokens: dict[str, str]) -> str:
    def replace(match: re.Match) -> str:
        key = match.group(1)
        if key not in tokens:
            raise ValueError(f"unknown token '{{{key}}}' in code rule template")
        value = tokens[key]
        if not value:
            raise ValueError(f"token '{key}' resolved to an empty value; asset is missing that field")
        return value

    return _TOKEN_RE.sub(replace, rule.prefix_template)


async def generate_code(session: AsyncSession, rule: CodeRule, tokens: dict[str, str]) -> str:
    resolved_prefix = resolve_prefix(rule, tokens)

    # Atomic allocate-and-increment: INSERT ... ON CONFLICT ... DO UPDATE ...
    # RETURNING performs the read-increment-write as a single statement at the
    # database level. Postgres takes a row lock on the target row (existing or
    # about to exist) for the duration of the statement, so two concurrent
    # transactions racing to generate a code for the same resolved_prefix are
    # serialized by the database itself -- the second transaction's statement
    # blocks until the first commits/rolls back, then proceeds against the
    # now-updated row. This is NOT an application-level read-then-write (which
    # would be vulnerable to a lost-update race); the increment happens inside
    # the single atomic UPSERT statement, so no two callers can ever observe
    # and act on the same next_value.
    stmt = (
        insert(CodeCounter)
        .values(resolved_prefix=resolved_prefix, next_value=rule.start_number + 1)
        .on_conflict_do_update(
            index_elements=[CodeCounter.resolved_prefix],
            set_={"next_value": CodeCounter.next_value + 1},
        )
        .returning(CodeCounter.next_value)
    )
    result = await session.execute(stmt)
    new_next_value = result.scalar_one()
    allocated_number = new_next_value - 1

    number_str = str(allocated_number).zfill(rule.pad_width) if rule.pad_width else str(allocated_number)
    return f"{resolved_prefix}{number_str}{rule.suffix_template}"


async def get_active_rule(session: AsyncSession, company_id: int) -> CodeRule:
    stmt = select(CodeRule).where(
        CodeRule.is_active.is_(True), (CodeRule.company_id == company_id) | (CodeRule.company_id.is_(None))
    ).order_by(CodeRule.company_id.desc().nullslast())
    rule = (await session.execute(stmt)).scalars().first()
    if rule is None:
        raise ValueError("no active code rule configured")
    return rule
