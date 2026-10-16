# Backend dependency recheck (closure WP-A1, item 8)

Date: 2026-10-16. Scope: the pinned runtime set `backend/constraints.txt` (IF-11) and the installed environment of the
dev API image. No code or pin was changed by this recheck.

## How it was run

- Throw-away container of the dev API image (`docker run --rm ... ckam-build-api:latest`, removed afterwards), only
  network use = the advisory lookups of `pip-audit` (PyPI / OSV). No CKAM, ERP or production host was contacted.
- `pip-audit 2.10.1`:
  - `pip-audit -r constraints.txt --no-deps` (the exact pins, no resolution) — text and JSON;
  - `pip-audit` of the installed image environment (what actually runs in the container).
- Raw output: `raw/pip_audit_constraints.txt` (next to this file).
- Usage check: `grep` of `backend/app` and `backend/tests` for `jose`, `ecdsa`, `jwt.encode/decode`, `algorithms=`.

## Result

43 pinned packages audited. **3 advisory records in 2 packages** (same as the 2026-10-15 baseline in
`../../infra/dependency_audit.md`, which also found 3 records in 2 packages); none has a fixed version.

| Package | Version | Advisory | Fix available | Reachable in CKAM? | Decision |
|---|---|---|---|---|---|
| python-jose | 3.5.0 | PYSEC-2026-4298 (aliases GHSA-3qf3-8w2g-rqmx, CVE-2026-85394): HMAC verification accepts a DER public key as the secret, so a holder of the service's *public* key can forge HS256 tokens **when algorithms are not restricted** (incomplete fix of CVE-2024-33663) | none listed | **No.** CKAM has no asymmetric key at all; the only key is `settings.jwt_secret` (a random string, ≥ 32 characters / ≥ 8 distinct in production, IF-04). Every decode pins the algorithm: `jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])` (`backend/app/core/security.py::decode_token`); encode uses `algorithm="HS256"`. | ACCEPT (not exploitable); keep the pin. Regression tests added: `backend/tests/auth/test_jwt_algorithm_pinned.py` (HS384/HS512 with the right secret, `none`, `RS256`, `ES256` headers are all refused) |
| ecdsa | 0.19.2 | PYSEC-2026-1325 (GHSA-wj6h-64fc-37mp, CVE-2024-23342): Minerva timing side channel when SIGNING / generating keys on P-256; verification unaffected; upstream will not fix | none (upstream: out of scope) | **No.** Nothing in CKAM imports `ecdsa`; it is only a hard dependency of python-jose. python-jose is installed with its `cryptography` extra and its EC backend resolves to `jose.backends.cryptography_backend` (checked in the container). CKAM never creates or uses EC keys and never signs with ECDSA. | ACCEPT (not reachable) |

(`pip-audit` lists the ecdsa record twice because the advisory database carries two entries with the same id; it is
one advisory.)

## Safe-fix assessment

- No patched python-jose or ecdsa release exists, so there is no "safe patch/minor" update to apply. Dropping ecdsa
  is impossible while python-jose is used (it is a hard requirement of python-jose 3.5.0).
- The durable remedy is replacing python-jose with PyJWT (same HS256 tokens, `algorithms=["HS256"]`), which removes
  both advisories. That is a code change to `backend/app/core/security.py` and the two tests that mint tokens, and
  must go through the full suite: **recommended as a separate, low-risk follow-up**, not done here (item 8 allows code
  changes only for a safe patch/minor fix).
- Everything else in `constraints.txt` (incl. `cryptography 50.0.1`, `starlette 1.7.0`, `python-multipart 0.0.32`,
  `pillow 12.3.0`, `uvicorn 0.54.0`, `h11 0.16.0`): no known advisory.

## Status

Unchanged: OBS-level, ACCEPTED with reasons above (algorithm pinned, no asymmetric keys, ecdsa not reachable).
Re-run `pip-audit -r backend/constraints.txt --no-deps` at every pin change.
