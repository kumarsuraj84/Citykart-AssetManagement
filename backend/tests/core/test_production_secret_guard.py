"""IF-04 / N4: anything that is not a known non-production name is production, and production refuses to start with a
placeholder, short, blank or one-character-repeated JWT_SECRET.

Closure WP-A1 (OBS-GUARD-MSG + revalidation): the refusal names BOTH strength rules (32 characters AND 8 different
characters) and never prints the secret; the real FastAPI start-up (the lifespan) is exercised, not only the
helper; an unset ENVIRONMENT_NAME counts as production."""
import pytest

from app.core.config import DEFAULT_DEV_JWT_SECRET, Settings, settings
from app.main import app, docs_urls, is_production, refuse_to_start_with_insecure_secret

REAL = "k3Jx9Qm7" * 5   # 40 characters, 8 different ones, not a placeholder

WEAK_SECRETS = [
    DEFAULT_DEV_JWT_SECRET, "change_me_too", "short", "", " " * 40, "a" * 40, "x" * 31,
    "Zq8#mK2v" * 3 + "Zq8#mK2",              # 31 characters, 8 different: too short by one
    "abababababababababababababababab",      # 32 characters, 2 different
    "abcdefgabcdefgabcdefgabcdefgabcdefg",   # 35 characters, 7 different
    "  " + DEFAULT_DEV_JWT_SECRET + "  ",    # the placeholder with spaces around it
]
PRODUCTION_NAMES = ["production", "Production", " Production ", " prod ", "PROD", "prd", "live", "prod-1", "",
                    "   ", None, "staging", "producton", "Live!", "x"]
NON_PRODUCTION_NAMES = ["development", "Dev", "dev", "uat", "UAT", "security-test", "test", "testing", "local", "ci",
                        " development "]


def _message_names_both_rules_and_hides(message: str, secret: str) -> None:
    assert "at least 32 characters" in message and "at least 8 different characters" in message
    assert "placeholder" in message
    hidden = (secret or "").strip()
    if hidden:
        assert hidden not in message


@pytest.mark.parametrize("env", PRODUCTION_NAMES)
@pytest.mark.parametrize("secret", WEAK_SECRETS)
def test_anything_that_is_not_a_known_dev_name_is_production_and_refuses_a_weak_secret(env, secret):
    assert is_production(env)
    with pytest.raises(RuntimeError, match="Refusing to start") as caught:
        refuse_to_start_with_insecure_secret(env, secret)
    _message_names_both_rules_and_hides(str(caught.value), secret)


@pytest.mark.parametrize("env", ["production", "prd", "live", "", "prod-1"])
def test_production_with_a_real_secret_starts_and_hides_the_docs(env):
    refuse_to_start_with_insecure_secret(env, REAL)
    refuse_to_start_with_insecure_secret(env, "Zq8#mK2v" * 4)            # exactly 32 characters, 8 different
    assert docs_urls(env) == {"docs_url": None, "redoc_url": None, "openapi_url": None}


@pytest.mark.parametrize("env", NON_PRODUCTION_NAMES)
def test_known_non_production_names_only_get_the_warning_and_keep_the_docs(env):
    assert not is_production(env)
    refuse_to_start_with_insecure_secret(env, DEFAULT_DEV_JWT_SECRET)
    assert docs_urls(env) == {}


def test_an_unset_environment_name_counts_as_production(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT_NAME", raising=False)
    fresh = Settings(_env_file=None)
    assert is_production(fresh.environment_name)
    with pytest.raises(RuntimeError, match="Refusing to start"):
        refuse_to_start_with_insecure_secret(fresh.environment_name, DEFAULT_DEV_JWT_SECRET)


# ---------------------------------------------------------------- the real start-up (FastAPI lifespan)

async def _start(monkeypatch, env, secret):
    monkeypatch.setattr(settings, "environment_name", env)
    monkeypatch.setattr(settings, "jwt_secret", secret)
    monkeypatch.setattr(settings, "erp_sync_enabled", False)
    async with app.router.lifespan_context(app):
        pass


@pytest.mark.parametrize("env", ["production", None, "", "  ", "prd", "live", "prod-1", "staging", "PROD"])
@pytest.mark.parametrize("secret", [DEFAULT_DEV_JWT_SECRET, "change_me_too", "short", "", " " * 40, "a" * 40,
                                    "abababababababababababababababab", "x" * 31])
async def test_the_real_start_up_refuses_a_weak_secret_in_production(monkeypatch, env, secret):
    with pytest.raises(RuntimeError, match="Refusing to start") as caught:
        await _start(monkeypatch, env, secret)
    _message_names_both_rules_and_hides(str(caught.value), secret)


async def test_the_real_start_up_with_an_unset_environment_name_refuses_the_placeholder(monkeypatch):
    monkeypatch.delenv("ENVIRONMENT_NAME", raising=False)
    with pytest.raises(RuntimeError, match="Refusing to start"):
        await _start(monkeypatch, Settings(_env_file=None).environment_name, DEFAULT_DEV_JWT_SECRET)


@pytest.mark.parametrize("env", ["development", "dev", "test", "testing", "uat", "security-test", "local", "ci"])
async def test_the_real_start_up_runs_in_development_names_even_with_the_placeholder(monkeypatch, env):
    await _start(monkeypatch, env, DEFAULT_DEV_JWT_SECRET)


@pytest.mark.parametrize("env", ["production", "prd", None])
async def test_the_real_start_up_runs_in_production_with_a_real_secret(monkeypatch, env):
    await _start(monkeypatch, env, REAL)
