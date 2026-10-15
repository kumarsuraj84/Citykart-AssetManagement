"""IF-04: a server whose ENVIRONMENT_NAME says production refuses to start with a placeholder or short JWT_SECRET."""
import pytest

from app.core.config import DEFAULT_DEV_JWT_SECRET
from app.main import refuse_to_start_with_insecure_secret

REAL = "k3Jx9" * 8   # 40 characters, not a placeholder


@pytest.mark.parametrize("env", ["production", "Production", " prod ", "PROD"])
@pytest.mark.parametrize("secret", [DEFAULT_DEV_JWT_SECRET, "change_me_too", "short", ""])
def test_production_with_a_weak_secret_does_not_start(env, secret):
    with pytest.raises(RuntimeError, match="Refusing to start"):
        refuse_to_start_with_insecure_secret(env, secret)


def test_production_with_a_real_secret_starts():
    refuse_to_start_with_insecure_secret("production", REAL)


@pytest.mark.parametrize("env", ["development", "uat", "security-test", "", "test"])
def test_other_environments_only_get_the_warning_not_a_refusal(env):
    refuse_to_start_with_insecure_secret(env, DEFAULT_DEV_JWT_SECRET)
