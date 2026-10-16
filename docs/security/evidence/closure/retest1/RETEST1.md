# WP-R1 — CLOSURE re-attack of the LATE fixes (N1, N4, AU-08, RACE-1, IF-01, files, secrets)

Independent Senior Penetration Tester, 2026-10-16. Black-box re-attack (I did not write these fixes and did not
assume they work). Target: the **running** throw-away stack `ckam-sec` (web http://localhost:3411,
API http://127.0.0.1:8200, Postgres 127.0.0.1:25442) and its image `ckam-sec-api` (built from commit
d04790a / a3e8fce-parent, so it contains N1, N4, AU-08 follow-up, RACE-1, IF-01). The working tree was ignored
for behaviour (other engineers were editing it); every result below is from the running stack or throw-away
`docker run` containers of its image. No pytest. All attacks LOCAL only.

Cases: **137** (`tests.csv`, ids `CL1-T001..T137`). **PASS 133 · FAIL 1 · PARTIAL 2 · OBS 1**.
Scripts in `scripts/`, redacted raw output in `raw/`.

## Per-item verdict

| Item | Verdict | Notes |
|---|---|---|
| N1 request-size limits | **PASS** | 413 with the full envelope (`detail`,`errors`,`X-Request-ID`) + all security headers on every oversize body; auth 64 KB / JSON 5 MB / multipart 16 MB enforced; legit sizes pass; chunked (no Content-Length) counted & cut; huge/negative/malformed Content-Length refused (413 / 400); `Expect: 100-continue` refused without reading; slow-body did not hang other requests; container RSS stayed flat (143 664 kB) through 256 MB floods. |
| N4 environment fail-closed | **PASS with 1 FAIL** | Every production-treated name (blank, prd, live, prod-1, Production, ` PROD `, staging, arbitrary) **and** every weak secret (placeholder, change_me_too, short, 40 spaces, 40×'a', 31 chars, 32 chars/4 distinct) refuses to start (exit 3, no secret in the message); dev names start; prod+good starts with /docs,/redoc,/openapi.json = 404. **FAIL:** ENVIRONMENT_NAME *entirely unset* defaults to `development` and starts with the placeholder secret + /docs ON (fail-open on omission) — finding **CL1-N4-01**. |
| AU-08 password policy | **PASS** | All 19 weak/common/brand/personal candidates rejected 422 with plain messages; both strong passphrases accepted 204; change-password rate limit respected; test account deactivated. |
| RACE-1 same-name races | **PASS** | 10–20 truly-parallel identical-name POSTs to /masters/vendors and /masters/brands (×3 names) and case/whitespace variants each produced exactly **one** 201, the rest plain 422 "already exists", **zero 5xx**; DB confirmed exactly one active row per name. Cleaned up. |
| IF-01 Linux payloads | **PASS** | Every traversal (dot-dot, encoded, double-slash, absolute, quad-dot, prod `shared/.env` + `nas.pw` canaries) → 404, no leak, no 500. |
| IF-01 Windows-style payloads | **PASS** | `..%5c`, `%2e%2e%5c`, `C:%2f`, `C:%5c`, `%5c%5cserver%5cshare`, mixed slashes, double-encoded, sibling-prefix dir, symlink-out, NUL → all 404, no leak. Uniform `{"detail":"Not Found"}` body. |
| File / document security | **PASS (1 PARTIAL)** | Extension & content-signature spoofs, empty, oversize doc (422/10 MB) and import (413/15 MB) handled; reserved-name and traversal-in-filename stored as safe UUIDs; download authorization holds across company, work-area and self-service; downloads served with extension-derived type + `Content-Disposition: attachment` + `nosniff`. **PARTIAL:** content check is signature-prefix only, so a PDF-header/HTML-body or PNG-header/script polyglot is *stored* — but served safely (attachment+nosniff) — observation **CL1-OBS-FILES-01**. |
| Secret scan | **PASS (regex-only)** | No real JWT, private key, DB password, API key or NAS/ERP secret in the working tree or 293 commits of history — only committed placeholders, FAKE canaries and fake test fixtures. Limitation: no gitleaks/trufflehog image locally (brief forbids pulling), demo PNGs not OCR-scanned. One OBS: a clear-text **demo** password in the untracked walkthrough doc (**CL1-OBS-SECRET-01**). |

## Case table (summary — full list with evidence refs in `tests.csv`)

| id | item | attack | expected | actual | result |
|---|---|---|---|---|---|
| CL1-T001 | N1 | auth body 70 KB | 413 + envelope + headers | 413, detail+errors+X-Request-ID+CSP/nosniff/XFO | PASS |
| CL1-T012 | N1 | huge Content-Length 256 MB | 413, no body read, RSS flat | 413, RSS 143 664 kB unchanged | PASS |
| CL1-T015 | N1 | chunked oversized, no Content-Length | 413 (counting path) | 413 + security headers | PASS |
| CL1-T017 | N1 | slow-body stall + concurrent health | server not hung | health 200 in 0.00 s | PASS |
| CL1-T019 | N4 | ENVIRONMENT_NAME **unset** + placeholder | refuse (fail-closed) | **STARTED, /docs ON** | **FAIL** |
| CL1-T020-033 | N4 | prod-treated names / weak secrets | refuse | exit 3, refused, no secret printed | PASS |
| CL1-T034-036 | N4 | prod/prd/live + good secret | start, docs OFF | started, docs/redoc/openapi 404 | PASS |
| CL1-T037-044 | N4 | dev names + placeholder | start, docs ON | started, docs 200 swagger | PASS |
| CL1-T046 | N4 | refusal message wording | explains length AND diversity | only "placeholder or shorter than 32" | PARTIAL |
| CL1-T047-065 | AU-08 | 19 weak/common/brand/personal | 422 | 422 with plain message | PASS |
| CL1-T066-067 | AU-08 | 2 strong passphrases | 204 | 204 accepted | PASS |
| CL1-T069-076 | RACE-1 | parallel identical / variant names | one 201, rest 422, no 5xx | one 201, rest 422, 0×5xx | PASS |
| CL1-T077 | RACE-1 | DB active-row count | 1 per name | 1 active/1 total per name | PASS |
| CL1-T082-104 | IF-01 | traversal (Linux + Windows + enc + NUL) | 404, no leak, no 500 | 404, no leak, 0×500 | PASS |
| CL1-T109-115 | FILES | spoof / empty / oversize | 422 or 413 | 422 / 413 | PASS |
| CL1-T116-118 | FILES | MIME-spoof / polyglot | accepted but served safely | 201, served attachment+nosniff | PASS / PARTIAL |
| CL1-T121 | FILES | traversal in filename | stored UUID, no traversal | stored_path `/data/uploads/1/<uuid>.pdf` | PASS |
| CL1-T123-128 | FILES | download authZ matrix | cross-company/work-area/self 404; owner 200 | exactly so | PASS |
| CL1-T131-137 | SECRETS | tree + 293-commit history | no real secrets | placeholders/FAKE/test only | PASS / OBS |

---

## New finding (full format)

### CL1-N4-01 — ENVIRONMENT_NAME unset falls open to `development` (docs exposed, placeholder JWT secret accepted)

- **Severity:** Low–Medium (fail-open on configuration omission; depends on the production launcher always
  setting the variable, which it currently does).
- **CWE:** CWE-1188 (insecure default) / CWE-16 (configuration).
- **Component:** `backend/app/core/config.py` (`environment_name: str = "development"`) with
  `backend/app/main.py::is_production` / `refuse_to_start_with_insecure_secret` / `docs_urls`.
- **What N4 promised:** "anything else (prod, prd, live, a typo) is treated as production, so a mistyped
  ENVIRONMENT_NAME can never silently switch the production protections off."
- **What I observed (CL1-T019 vs CL1-T020):** a throw-away container of `ckam-sec-api` with **no**
  `ENVIRONMENT_NAME` set and the committed placeholder `JWT_SECRET=dev_secret_change_me` **started normally**
  (`health=200`, `/docs`,`/redoc`,`/openapi.json` all 200 with Swagger). The same container with
  `ENVIRONMENT_NAME=` (blank string) correctly **refused** (exit 3, "Refusing to start…"). So omitting the
  variable is *less* safe than setting it to an empty string: the pydantic default `"development"` is a known
  non-production name, so startup validation is skipped, the interactive API docs are published, and the
  placeholder/weak JWT secret is accepted.
- **Impact:** if a production host ever runs without `ENVIRONMENT_NAME` in its environment (e.g. a `.env`
  typo, a dropped line, a new launcher), CKAM silently comes up in development mode: forgeable-token JWT
  secret allowed, `/openapi.json` + Swagger exposed, and the other production protections off — with no
  refusal and only a log warning. The N4 control stops *typos* but not *omission*.
- **Reproduce:** `scripts/n4_matrix.sh` row "env=UNSET + placeholder" (`raw/n4_results.txt` line 2).
- **Suggested fix (documented only — I write no product code):** make the default fail-closed, e.g. default
  `environment_name` to an empty string / `"production"`, or have `is_production(None)` return `True` so a
  truly-unset value is treated as production like every other unknown value; keep the explicit dev names as the
  only opt-outs. Alternatively require `ENVIRONMENT_NAME` to be set explicitly and refuse to start if it is
  absent in a non-dev build.

## Observations (lower priority)

- **CL1-OBS-N4-02** — the refusal message ("…JWT_SECRET is a committed placeholder or shorter than 32
  characters…") does **not** mention the character-**diversity** rule, even though 40×'a' and a 32-char/4-distinct
  secret are refused *by* that rule (`len(set(value)) < 8`). An operator who sets a 40-character all-'a' secret
  is told it is "shorter than 32 characters", which is misleading. Suggest the message also state "and must use
  at least 8 different characters." (evidence `raw/n4_results.txt`).
- **CL1-OBS-FILES-01** — `content_matches_extension` only checks a signature **prefix** (`%PDF-` anywhere in the
  first 1 KB, PNG/JPEG magic bytes), so a polyglot such as a `%PDF-`-prefixed HTML/script body, or a PNG-magic
  file with an appended script, is accepted and stored under a `.pdf`/`.png` name (CL1-T116-118). This is
  **mitigated** on the only retrieval path (`GET /api/documents/{id}/download` serves the extension-derived
  type with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`, confirmed CL1-T129), so it
  is not XSS-exploitable today. It would become relevant only if a future screen renders a stored document
  inline. Suggest a stricter content sniff (reject files whose body also parses as HTML) if inline rendering is
  ever added.
- **CL1-OBS-SECRET-01** — `docs/ai/CKAM_DEMO_WALKTHROUGH.md` (currently **untracked**) contains a clear-text
  **demo** password (`sunita@demo.test` / a demo value) for an account created inside a local test copy; the
  file states the real head-office admin password was never used or changed. Real-looking but demo-only.
  Suggest removing the clear-text password or marking it demo-only before this file is committed.

## What I could not fully exercise (honesty)

- **Secret scanning depth:** no `gitleaks`/`trufflehog`/`trivy` image was present locally and the brief forbids
  pulling new images, so the secret scan is **regex-only** (ripgrep over the tree + `git log -S/-G` over all 293
  commits). It will miss high-entropy secrets that do not match my patterns. The 65 demo PNGs under
  `docs/ai/demo-screens/` were not OCR-scanned, so on-screen secrets in images were not checked (file names are
  benign UI labels; the demo uses fixture/test data).
- **IF-01 on real Windows paths:** the image is Linux, so `C:\…` / UNC payloads were replayed against a Linux
  filesystem (they correctly 404 on path resolution). The production host is Windows; the resolve-then-
  `is_relative_to` logic is OS-portable and `Path.resolve()` handles `..` on both, but I could not exercise a
  genuine Windows `win.ini` read — it is 404 on logic before any OS path lookup, which is the safe outcome.
- No safety-classifier hard stops were hit; the ≤20-request parallel bursts (RACE-1) ran against our own local
  test stack as authorised.
