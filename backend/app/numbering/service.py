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
    STOCK_POINT asset_user for Add Asset, the row's asset_user for an import). A missing
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


TOKEN_WORDS = {
    "company.code": "company code",
    "location.code": "location code",
    "cost_center.code": "cost centre code",
    "category.code": "category code",
    "subcategory.code": "sub-category code",
    "yyyy": "year",
    "yy": "year",
    "mm": "month",
}
SUPPORTED_TOKENS = tuple(TOKEN_WORDS)
MAX_START_NUMBER = 999_999_999
MAX_PAD_WIDTH = 20


def resolve_prefix(rule: CodeRule, tokens: dict[str, str]) -> str:
    def replace(match: re.Match) -> str:
        key = match.group(1)
        if key not in tokens:
            raise ValueError(f"The asset code format uses {{{key}}}, which CKAM does not know. Fix the code format in Settings.")
        value = tokens[key]
        if not value:
            raise ValueError(
                f"The asset code format needs the {TOKEN_WORDS.get(key, key)}, but this asset has none "
                "(for example no sub-category). Choose one, or change the code format."
            )
        return value

    return _TOKEN_RE.sub(replace, rule.prefix_template)


def sample_tokens(company_code: str | None = None) -> dict[str, str]:
    today = date.today()
    return {
        "company.code": company_code or "CKSPL",
        "location.code": "HO",
        "cost_center.code": "CC01",
        "category.code": "IT",
        "subcategory.code": "LAP",
        "yyyy": f"{today.year:04d}",
        "yy": f"{today.year % 100:02d}",
        "mm": f"{today.month:02d}",
    }


def render_example(prefix_template: str, suffix_template: str, start_number: int, pad_width: int,
                   company_code: str | None = None) -> str:
    """What the first asset code of a rule looks like, with sample values."""
    tokens = sample_tokens(company_code)
    prefix = _TOKEN_RE.sub(lambda m: tokens.get(m.group(1), m.group(0)), prefix_template)
    number = str(max(start_number, 0))
    if pad_width:
        number = number.zfill(pad_width)
    return f"{prefix}{number}{suffix_template}"


def validate_rule(prefix_template: str, suffix_template: str, start_number: int, pad_width: int) -> None:
    """S0.9: refuses a code format that could only fail later (at the first
    asset) or produce nonsense codes. Raises ValueError with a plain sentence."""
    if not (prefix_template or "").strip():
        raise ValueError("The code format needs a beginning, for example FA/{company.code}/.")
    if len(prefix_template) > 300:
        raise ValueError("The code format is too long (max 300 characters).")
    if len(suffix_template or "") > 100:
        raise ValueError("The code ending is too long (max 100 characters).")
    without_tokens = _TOKEN_RE.sub("", prefix_template)
    if "{" in without_tokens or "}" in without_tokens:
        raise ValueError("The code format has a { or } that is not part of a known value. Use values such as {company.code}.")
    unknown = [m.group(1) for m in _TOKEN_RE.finditer(prefix_template) if m.group(1) not in TOKEN_WORDS]
    if unknown:
        known = ", ".join("{" + t + "}" for t in SUPPORTED_TOKENS)
        raise ValueError(f"The code format uses {{{unknown[0]}}}, which CKAM does not know. You can use: {known}.")
    if "{" in (suffix_template or "") or "}" in (suffix_template or ""):
        raise ValueError("The code ending cannot contain values in { }; put them in the code format instead.")
    if start_number < 0 or start_number > MAX_START_NUMBER:
        raise ValueError(f"The starting number must be between 0 and {MAX_START_NUMBER:,}.")
    if pad_width < 0 or pad_width > MAX_PAD_WIDTH:
        raise ValueError(f"The number of digits must be between 0 and {MAX_PAD_WIDTH}.")


async def generate_code(session: AsyncSession, rule: CodeRule, tokens: dict[str, str]) -> str:
    [code] = await reserve_codes(session, rule, resolve_prefix(rule, tokens), 1)
    return code


async def generate_codes(session: AsyncSession, rule: CodeRule, prefixes: list[str]) -> list[str]:
    """S4: the codes for a whole batch of new assets (one resolved prefix per asset, in order) with ONE
    atomic counter update per distinct prefix -- a 100-unit receipt of one line is one statement, not 100.
    Prefixes are reserved in sorted order so two concurrent batches always lock the counter rows in the same
    order (no deadlock). Same guarantees as generate_code: numbers are unique and gap-free (the counter
    moves inside the caller's transaction, so a rolled-back receipt gives its numbers back)."""
    wanted: dict[str, int] = {}
    for prefix in prefixes:
        wanted[prefix] = wanted.get(prefix, 0) + 1
    reserved: dict[str, list[str]] = {}
    for prefix in sorted(wanted):
        reserved[prefix] = await reserve_codes(session, rule, prefix, wanted[prefix])
    out: list[str] = []
    taken: dict[str, int] = {}
    for prefix in prefixes:
        position = taken.get(prefix, 0)
        out.append(reserved[prefix][position])
        taken[prefix] = position + 1
    return out


async def reserve_codes(session: AsyncSession, rule: CodeRule, resolved_prefix: str, count: int) -> list[str]:
    """Reserves `count` consecutive numbers of one resolved prefix in a single statement and returns the
    finished codes, lowest first."""
    if count < 1:
        return []
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
    # and act on the same next_value. S4: the increment is `count` (a whole
    # batch at once) -- the block [new_next_value - count, new_next_value) is
    # this caller's alone.
    stmt = (
        insert(CodeCounter)
        .values(resolved_prefix=resolved_prefix, next_value=rule.start_number + count)
        .on_conflict_do_update(
            index_elements=[CodeCounter.resolved_prefix],
            set_={"next_value": CodeCounter.next_value + count},
        )
        .returning(CodeCounter.next_value)
    )
    result = await session.execute(stmt)
    new_next_value = result.scalar_one()
    first = new_next_value - count

    def code(number: int) -> str:
        number_str = str(number).zfill(rule.pad_width) if rule.pad_width else str(number)
        return f"{resolved_prefix}{number_str}{rule.suffix_template}"

    return [code(n) for n in range(first, new_next_value)]


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
        raise ValueError("No code rule (asset code format) is set up for this company yet. Ask the head-office admin to set one up in Settings > Code Rule.")
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
