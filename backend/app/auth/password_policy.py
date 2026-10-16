"""Security AU-08: what a person may choose as a new password (POST /api/auth/change-password -- the only place
anyone chooses one; resets and issued passwords are random).

On top of the length rule of the request schema (8 to 128 characters) a new password is refused, with a plain
sentence, when it is:

* one of the most common passwords (the list below, compared ignoring case);
* the same character over and over (aaaaaaaa), or a simple run (12345678, abcdefgh, qwertyui, 87654321);
* "ckam" or "citykart" followed only by digits / symbols (Citykart2026, ckam@123);
* nothing but a simple run of letters and a short or simple number (abcdefgh1, xyz@2026);
* containing the person's own login code, the part of their email before the @, their name, or a word of
  their name (each only when at least 4 characters long, ignoring case, also written with look-alikes: R@vi).
There is deliberately no "must contain a symbol / capital" rule: a long passphrase is stronger.
"""
from __future__ import annotations

import re

# The 100 most common passwords that the 8-character minimum still lets through (leaked-password lists, plus
# the local favourites seen in Indian office networks). Lower case; compared case-insensitively.
COMMON_PASSWORDS = frozenset("""
password password1 password12 password123 password1234 password@123 password@1 password! passw0rd p@ssw0rd p@ssword
p@ssword1 p@ssw0rd1 pass@123 pass@1234 pass1234 12345678 123456789 1234567890 0123456789 987654321 87654321
11111111 00000000 88888888 99999999 12341234 11223344 12121212 123123123 1q2w3e4r 1q2w3e4r5t 1qaz2wsx qazwsxedc
zaq12wsx zaq1zaq1 qwerty12 qwerty123 qwertyuiop asdfghjkl asdf1234 zxcvbnm1 iloveyou iloveyou1 sunshine sunshine1
princess football baseball welcome1 welcome123 welcome@123 welcome@1 admin123 admin@123 admin1234 administrator
abc12345 abcd1234 abc@1234 letmein1 trustno1 superman starwars whatever dragon12 master12 monkey123 shadow12
michael1 jennifer computer internet liverpool chelsea1 arsenal1 manchester hello123 hello@123 charlie1 freedom1
test1234 test@123 changeme changeme1 default1 secret12 mustang1 batman12 pokemon1 killer12 india123 india@123
bharat123 krishna1 ganesh123 jaishreeram omsairam saibaba1 123qweasd 1234qwer qwer1234
""".split())

# Words that, with only digits / symbols around them, are not a password (compared after look-alikes are undone).
COMMON_BASE_WORDS = frozenset("""
password passwd pass welcome admin administrator letmein qwerty qwertyui qwertyuiop india delhi mumbai
test testing user login changeme change temp temporary abcd secret system manager asset assets store
stores hello monkey dragon master shadow sunshine princess football iloveyou cricket krishna ganesh bharat
""".split())
_LOOKALIKES = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s"})

_AROUND = "0123456789 _-.,;:!?@#$%^&*()+=~/\\|<>[]{}'\""

_RUNS = ("abcdefghijklmnopqrstuvwxyz", "0123456789", "01234567890", "qwertyuiopasdfghjklzxcvbnm", "1qaz2wsx3edc4rfv")
_BRAND = re.compile(r"^(ckam|citykart)[\W\d_]*$", re.IGNORECASE)
_WORD = re.compile(r"[a-z0-9]+")
MIN_PERSONAL_PART = 4


def _is_run(value: str) -> bool:
    return any(value in run or value in run[::-1] for run in _RUNS)


def _personal_parts(code: str | None, email: str | None, name: str | None) -> list[str]:
    parts: list[str] = []
    for whole in (code, (email or "").split("@", 1)[0] if email else None, name):
        text = (whole or "").strip().lower()
        if not text:
            continue
        parts.append(text)
        parts.extend(_WORD.findall(text))
    return [p for p in dict.fromkeys(parts) if len(p) >= MIN_PERSONAL_PART]


def password_problem(new_password: str, *, code: str | None = None, email: str | None = None,
                     name: str | None = None) -> str | None:
    """A plain sentence saying why `new_password` may not be used, or None when it is fine."""
    lowered = (new_password or "").lower()
    if lowered in COMMON_PASSWORDS:
        return "This password is too common and easy to guess. Choose a different one."
    if len(set(lowered)) == 1 or _is_run(lowered):
        return "This password is too simple (the same character or a simple sequence). Choose a different one."
    # Security AU-08 (retest): a common word with digits / symbols around it is as easy to guess as the word
    # itself (Password@2026, Welcome@2026, Adm1n#123, P@ssw0rd99): look-alike characters are mapped back first.
    plain = re.sub(r"[^a-z]", "", lowered)
    core = lowered.strip(_AROUND).translate(_LOOKALIKES)             # 'P@ssw0rd99' -> 'p@ssw0rd' -> 'password'
    if plain in COMMON_BASE_WORDS or re.sub(r"[^a-z]", "", core) in COMMON_BASE_WORDS:
        return "A common word with a few numbers or symbols added is easy to guess. Choose a different password."
    if _BRAND.match(new_password or ""):
        return "A password made of the company or app name and numbers is easy to guess. Choose a different one."
    if _only_simple_sequences(lowered):
        return "This password is too simple (the same character or a simple sequence). Choose a different one."
    # AU-08 (closure WP-A1): also with look-alike characters undone (R@vi#2026 -> ravi, KUM4R -> kumar).
    variants = (lowered, lowered.translate(_LOOKALIKES))
    for part in _personal_parts(code, email, name):
        if any(part in variant for variant in variants):
            return "The password must not contain your name, login code or email. Choose a different one."
    return None


def _only_simple_sequences(lowered: str) -> bool:
    """AU-08 (closure WP-A1): a simple run of letters plus at most a short or simple number (abcdefgh1, xyz@2026,
    Zz#123456) -- symbols in between do not make it stronger. A real word anywhere makes this False."""
    letters = re.sub(r"[^a-z]", "", lowered)
    digits = re.sub(r"[^0-9]", "", lowered)
    letters_simple = letters == "" or len(set(letters)) == 1 or (len(letters) >= 3 and _is_run(letters))
    digits_simple = digits == "" or len(set(digits)) == 1 or _is_run(digits) or len(digits) <= 4
    return letters_simple and digits_simple and (len(letters) >= 3 or len(digits) >= 4)
