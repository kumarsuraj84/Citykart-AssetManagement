"""IF-04 / N4: anything that is not a known non-production name is production, and production refuses to start with a
placeholder, short, blank or one-character-repeated JWT_SECRET."""
import pytest

from app.core.config import DEFAULT_DEV_JWT_SECRET
from app.main import docs_urls, is_production, refuse_to_start_with_insecure_secret

REAL = "k3Jx9Qm7" * 5   # 40 characters, 8 different ones, not a placeholder


@pytest.mark.parametrize("env", ["production", "Production", " prod ", "PROD", "prd", "live", "prod-1", "", None])
@pytest.mark.parametrize("secret", [DEFAULT_DEV_JWT_SECRET, "change_me_too", "short", "", " " * 40, "a" * 40])
def test_anything_that_is_not_a_known_dev_name_is_production_and_refuses_a_weak_secret(env, secret):
    assert is_production(env)
    with pytest.raises(RuntimeError, match="Refusing to start"):
        refuse_to_start_with_insecure_secret(env, secret)


@pytest.mark.parametrize("env", ["production", "prd", "live", ""])
def test_production_with_a_real_secret_starts_and_hides_the_docs(env):
    refuse_to_start_with_insecure_secret(env, REAL)
    assert docs_urls(env) == {"docs_url": None, "redoc_url": None, "openapi_url": None}


@pytest.mark.parametrize("env", ["development", "Dev", "uat", "security-test", "test", "local", "ci"])
def test_known_non_production_names_only_get_the_warning_and_keep_the_docs(env):
    assert not is_production(env)
    refuse_to_start_with_insecure_secret(env, DEFAULT_DEV_JWT_SECRET)
    assert docs_urls(env) == {}
