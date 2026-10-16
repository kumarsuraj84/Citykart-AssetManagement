"""Security AU-08 (VAPT 2026-10): a new password may not be common, simple, the company / app name with numbers,
or contain the person's own name, login code or email."""
import pytest

from app.auth.password_policy import COMMON_PASSWORDS, password_problem
from tests.core.s0_world import PASSWORD, build_world, login

ME = {"code": "EMP4521", "email": "ravi.kumar@citykart.org", "name": "Ravi Kumar"}


def test_the_common_list_has_at_least_a_hundred_entries():
    assert len(COMMON_PASSWORDS) >= 100


@pytest.mark.parametrize("password", [
    "password", "Password@123", "PASSWORD1", "12345678", "qwerty123", "iloveyou", "Welcome@123", "admin@123",
])
def test_common_passwords_are_refused(password):
    assert "too common" in password_problem(password, **ME)


@pytest.mark.parametrize("password", ["aaaaaaaa", "11111111", "12345678", "abcdefgh", "87654321", "qwertyui", "ZYXWVUTS"])
def test_one_character_or_a_simple_run_is_refused(password):
    assert password_problem(password, **ME) is not None


@pytest.mark.parametrize("password", ["ckam2026", "CKAM12345", "Citykart2026", "citykart@123", "CityKart#99"])
def test_the_company_or_app_name_with_numbers_is_refused(password):
    assert "company or app name" in password_problem(password, **ME)


@pytest.mark.parametrize("password", ["emp4521!xyz", "Ravi.Kumar77", "kumar#2026!", "RAVI@city-9", "my-ravi.kumar"])
def test_the_persons_own_name_code_or_email_is_refused(password):
    assert "name, login code or email" in password_problem(password, **ME)


@pytest.mark.parametrize("password", ["Password@2026", "Welcome@2026", "Adm1n#123", "P@ssw0rd99", "Passw0rd!", "Letmein#1", "Qwerty@12345", "Delhi@1234"])
def test_a_common_word_with_digits_or_symbols_around_it_is_refused(password):
    assert "common word" in password_problem(password, **ME)


@pytest.mark.parametrize("password", [
    "BrandNew#2026", "Brand-New-Passw0rd", "Walker#2026x", "NewPassw0rd!", "TempPassw0rd!",
    "Citykart rocks 2026", "Ckam-store-tracker", "Sec#Test2026ok",
])
def test_reasonable_passwords_and_every_password_the_test_suite_uses_are_fine(password):
    assert password_problem(password, **ME) is None


# ---------------------------------------------------------------- closure WP-A1: the owner's revalidation list

OWNER_REFUSED = [
    "password", "password1", "Password@2026", "Welcome@2026", "Admin@2026", "Qwerty@123", "India@2026", "Citykart2026",
    "CKAM2026",
    # the person's own code / name / e-mail local part, with case, digits, symbols and look-alikes
    "EMP4521", "emp4521", "Emp4521#2026", "xx-EMP4521-yy", "ravikumar", "RaviKumar2026", "Ravi Kumar 2026!",
    "ravi.kumar", "ravi.kumar@2026", "Kumar@12345", "R@vi#2026xyz", "KUM4R-rocks-9", "sunny-ravi-day",
    # simple sequences and repeated characters
    "12345678", "123456789", "87654321", "abcdefgh", "abcdefgh1", "Abcdefg@1", "zyxwvuts", "qwertyui", "qwertyuiop1",
    "asdfghjkl", "1qaz2wsx", "aaaaaaaa", "AAAAaaaa", "11111111", "zzzzzzzz9", "Zz#123456", "xyz@2026", "!!!!!!!!",
]

OWNER_ACCEPTED = ["Blue-Sky-Over-Hills-42", "purple tractor eats 7 mangoes", "Walker#2026x", "Granite#Meadow-4418",
                  "correct horse battery staple", "mangoes ripen slowly", "k3m9q2z7v1", "Sec#Test2026ok",
                  "Green#Ladder2026"]


@pytest.mark.parametrize("password", OWNER_REFUSED)
def test_the_owners_list_of_weak_passwords_is_refused(password):
    problem = password_problem(password, **ME)
    assert problem is not None, password
    if password.lower() != "password":                               # (the sentences use the word itself)
        assert password not in problem                               # the sentence never repeats the password


@pytest.mark.parametrize("password", OWNER_ACCEPTED)
def test_strong_passphrases_are_accepted_without_any_symbol_rule(password):
    assert password_problem(password, **ME) is None, password


@pytest.mark.parametrize("password", ["bluesky mountain river", "lowercase only passphrase", "ALLCAPSBUTLONGENOUGH"])
def test_there_is_no_composition_rule(password):
    """No "must contain a capital / digit / symbol": a long passphrase of plain words is fine."""
    assert password_problem(password, **ME) is None


def test_a_name_part_found_only_after_look_alikes_are_undone_is_refused_but_not_short_parts():
    assert "name, login code or email" in password_problem("R@vi-and-friends-9", **ME)
    assert password_problem("Blue-Sky-0ver-Hills", code="SM1", email="sm.lam@citykartstores.com", name="Al Om") is None


def test_short_name_parts_do_not_block_ordinary_words():
    assert password_problem("Blue-Sky-Over-Hills", code="SM1", email="sm.lam@citykartstores.com", name="Al Om") is None


async def test_the_change_password_endpoint_refuses_a_weak_password_in_plain_words(client):
    w = await build_world()
    h = await login(client, w, "op_it")
    resp = await client.post("/api/auth/change-password", headers=h,
                             json={"old_password": PASSWORD, "new_password": "Password@123"})
    assert resp.status_code == 422
    body = resp.json()
    assert body["detail"] == "This password is too common and easy to guess. Choose a different one."
    assert body["request_id"]
    personal = await client.post("/api/auth/change-password", headers=h,
                                 json={"old_password": PASSWORD, "new_password": "operator-2026-x"})
    assert personal.status_code == 422 and "your name" in personal.json()["detail"]
    ok = await client.post("/api/auth/change-password", headers=h,
                           json={"old_password": PASSWORD, "new_password": "Green#Ladder2026"})
    assert ok.status_code == 204


async def test_a_wrong_current_password_is_still_the_400_whatever_the_new_one_is(client):
    w = await build_world()
    h = await login(client, w, "op_it")
    resp = await client.post("/api/auth/change-password", headers=h,
                             json={"old_password": "not-it", "new_password": "Password@123"})
    assert resp.status_code == 400
