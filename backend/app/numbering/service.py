import re
from datetime import date
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from app.numbering.models import CodeCounter, CodeRule

_TOKEN_RE = re.compile(r"\{([a-zA-Z0-9_.]+)\}")


def build_code_tokens(*, company, location, cost_center, category, subcategory, purchase_date: date) -> dict[str, str]:
    """The full set of tokens a code rule template may use, filled with real values.
    Shared by Add Asset (procure_assets) and the Excel import (commit_import) so the
    two paths can never drift apart again -- each used to hard-code some tokens to
    "", which resolve_prefix then (correctly) rejects, turning any rule that used
    {company.code}/{location.code}/{yyyy}/{yy}/{mm} into an error on one path.

    `location` is the location of the asset_user the asset lands with (the initial
    IT_STOCK asset_user for Add Asset, the row's asset_user for an import). A missing
    optional master (e.g. no subcategory) maps to "" so resolve_prefix raises a
    clear "token resolved to an empty value" error only if the rule uses it."""
    return {
        "company.code": company.code if company else "",
        "location.code": location.code if location else "",
        "cost_center.code": cost_center.code if cost_center else "",
        "category.code": category.code if category else "",
        "subcategory.code": subcategory.code if subcategory else "",
        "yyyy": f"{purchase_date.year:04d}",
        "yy": f"{purchase_date.year % 100:02d}",
        "mm": f"{purchase_date.month:02d}",
    }


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
    """A company-specific active rule beats the global (company_id NULL) one.
    Within one scope there should only ever be a single active rule (see
    `make_sole_active_rule`), but `CodeRule.id.desc()` still makes the pick
    deterministic -- newest wins -- if duplicates exist anyway (e.g. rows saved
    before that invariant was enforced)."""
    stmt = select(CodeRule).where(
        CodeRule.is_active.is_(True), (CodeRule.company_id == company_id) | (CodeRule.company_id.is_(None))
    ).order_by(CodeRule.company_id.desc().nullslast(), CodeRule.id.desc())
    rule = (await session.execute(stmt)).scalars().first()
    if rule is None:
        raise ValueError("no active code rule configured for this company (set one up under Setup > Code Rule)")
    return rule


async def make_sole_active_rule(session: AsyncSession, rule: CodeRule) -> None:
    """Marks `rule` active and deactivates (never deletes) every other active rule
    in the same scope. Global rules (company_id NULL) and each company's rules are
    separate scopes, each allowed exactly one active rule."""
    rule.is_active = True
    scope = CodeRule.company_id.is_(None) if rule.company_id is None else CodeRule.company_id == rule.company_id
    stmt = update(CodeRule).where(scope, CodeRule.is_active.is_(True))
    if rule.id is not None:
        stmt = stmt.where(CodeRule.id != rule.id)
    await session.execute(stmt.values(is_active=False).execution_options(synchronize_session=False))
