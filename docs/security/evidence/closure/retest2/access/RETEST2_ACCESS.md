# RETEST2 — ACCESS area (second independent retest)

Independent Senior Penetration Tester, 2026-10-16. Black-box + grey-box (source read only to hunt bypasses; I
did **not** write any fix and did **not** derive my tests from the developers' tests). Target: the running
throw-away stack **`ckam-sec`** rebuilt from the FINAL committed code (**HEAD 734fd19**, Alembic head
**c6e8a0b2d4f6** — both confirmed live in the DB) plus a throw-away production-layout container of its image
`ckam-sec-api`. Everything LOCAL only. One login per persona, tokens cached, logins paced ≥4 s; **no 429 hit**
in any run (the shared-IP rate limit was respected). No git writes, no pytest, no docker up/build/down/restart.

**Cases: 319 (`tests.csv`, ids `CL2-AC-T001..T319`). PASS 318 · OBS 1 · FAIL 0.**
Route matrix: **217 routes × 14 identities = 3 038 cells, 0 escalations, 0 deviations from the guard model.**
Scripts in `scripts/`, redacted raw output in `raw/`, full observed matrix + derived intent in `authz_matrix.csv`.

## Result table (by scope item)

| Area | Attack | Expected | Actual | Verdict | Evidence |
|---|---|---|---|---|---|
| Route matrix | every route (217) as no-token, malformed, SECSELF, SPA, SECVIEW, SECOPIT, SECOPNIT, SECOPX, SECFAIT, SECFANIT, SECFABOTH, SECOTHER, SECHO, SECMUST | each cell = the role/company/work-area/custody guard | every cell matches; 0 escalations; Full-Admin work-area scoping holds (SECFANIT 404 on IT asset); SECHO-only on admin logs | **PASS** | `authz_matrix.csv`, `raw/matrix_raw.csv`, `raw/matrix_analysis.json` |
| Auth state | locked / deactivated / login-disabled / must-change sign-in | 423 / 401 / 401 / (login 200 then 403) | SECLOCK 423, SECDIS 401, SECNOLOGIN 401, SECMUST login ok but **403 on every authenticated route** | **PASS** | `raw/bootstrap.json` |
| Token revocation | deactivated user replays still-cached access token (throw-away) | 401 | before 200 → deactivate 204 → replay **401** "Account not found or inactive"; write path also 401 | **PASS** | `raw/throwaways.json` |
| Token revocation | login-disabled user replays still-cached access token (throw-away) | 401 | before 200 → disable 200 → replay **401** "Your session has ended" | **PASS** | `raw/throwaways.json` |
| **WP-B DB guard** | raw UPDATE of asset status / holder / status_since outside the ledger | DB EXCEPTION | all three refused by `forbid_asset_lifecycle_write`; permitted only with `ckam.lifecycle_writer` marker; non-lifecycle columns unaffected | **PASS** | `raw/db_guard.txt` |
| **WP-B via API** | inject status / current_asset_user_id / status_since / is_active / id / token_version on create, PUT (body+query), corrections, bulk | ignored, no stray write, no 500 | every injected lifecycle field **ignored**; created/edited asset keeps server-derived status IN_STOCK, holder = stock room, today's date; **0×500** | **PASS** | `raw/mass_assign.json` |
| Mass assignment | asset-user create/PUT: is_primary_owner, token_version, password_hash, id, role, company, work-area | ignored / not escalatable | id auto-assigned, `is_primary_owner` stays **false**; PUT cannot grant PO flag; a non-PO ADMIN (SECFABOTH) gets **403** on the dedicated primary-owner route | **PASS** | `raw/mass_assign.json` |
| IDOR/BOLA | cross-company PO read (po1 CKSPL ↔ po5 CKVPL) + sub-routes | 404 | other company's PO and every sub-route = **404** | **PASS** | `raw/idor.json` |
| IDOR/BOLA | ERP PO draft cross-company (9001001/9002001) | 404, grant→200 | SECOPIT/SECOTHER **404** on the other company; SECOPX (grant) **200** — IF-03 holds | **PASS** | `raw/idor.json` |
| IDOR/BOLA | custom-field company filtering, `?company_id=2` widening | own company only | SECOPIT=[1], SECOTHER=[2], widen refused — AC-2 holds | **PASS** | `raw/idor.json` |
| IDOR/BOLA | idempotency key reuse across actors (SECOPIT replays SECHO's seed key) | no replay of another actor's response | **no `Idempotency-Replay` header**, request ran as the caller's own (422) — keys are per-actor | **PASS** | `raw/idor.json` |
| IDOR/BOLA | custody: SECSELF/SPA read not-owned / cross-company assets | 404 | own asset 200, everything else 404 | **PASS** | `raw/idor.json` |
| File sec (prod container) | 23 traversal payloads incl Windows forms (`..%5c`, `C:%2f…`, `%5c%5c…`, ADS `::$DATA`, `CON`, trailing dot/space, 8.3, NUL, 300-char, symlink-out, double-encoded) | uniform plain 404, no leak | **all 404, identical body (len 70), 0 canary leaks, 0×500** | **PASS** | `raw/prod_file_probe.json` |
| File sec (prod container) | legit hashed asset / root file / SPA fallback | 200 | all 200 with correct bodies | **PASS** | `raw/prod_file_probe.json` |
| File sec (prod container) | `/docs` `/redoc` `/openapi.json` `/docs/oauth2-redirect` in production mode | JSON 404 | all **404** JSON (docs off); server booted with the good 40-char secret | **PASS** | `raw/prod_file_probe.json` |
| File sec | unknown `/api/...` path | JSON 404 | 404 "This API address does not exist" | **PASS** | `raw/prod_file_probe.json` |
| Upload | HTML-as-.pdf, `.html`, `.svg`, double-ext, empty, 11 MB doc | 422 | all **422** with plain messages | **PASS** | `raw/upload.json` |
| Upload | valid PDF/PNG; traversal / reserved (`CON.pdf`) filename | 201, stored as UUID | 201; stored under a UUID name (no traversal) | **PASS** | `raw/upload.json` |
| Upload | 16 MB import | 413 | **413** (request-size limit) | **PASS** | `raw/upload.json` |
| Download | authorization + headers on a real doc | attachment + server type + nosniff | `Content-Disposition: attachment`, `application/pdf`, `X-Content-Type-Options: nosniff` | **PASS** | `raw/upload.json` |
| Upload | PDF-header + HTML-body polyglot | accepted (prefix check) but served safely | 201; signature-prefix check accepts, but only ever served as an `application/pdf` attachment+nosniff | **OBS** | `raw/upload.json` |
| Input | SQLi on assets q/status/sort_by/sort_dir (×7) + vendors/items/POs/ERP/logs search + limit/offset abuse | no 500, no cross-table leak | **0×500**, all 200/422/400 | **PASS** | `raw/input_logic.json` |
| Input | formula injection in vendor xlsx export | leading `=` neutralised | stored as `inlineStr` **`'=cmd…`** (apostrophe-prefixed), never an `<f>` formula | **PASS** | `raw/vend_export.xlsx` |
| Stored XSS | payloads in vendor/item/employee names + asset description, rendered in the real UI as SECHO (vendors, items, people, assets list, asset detail) | escaped, no script exec | **`window.__xss_cl2` never set**, payloads render as inert escaped text, 0 page errors | **PASS** | `raw/playwright_xss.json` |
| Business logic | double-scrap, move a terminal (scrapped) asset | 422 | both **422** "This asset has been scrapped…" | **PASS** | `raw/input_logic.json` |
| Business logic | move a CKSPL asset to a CKVPL holder | 422 | **422** "Assets can only move within their own company." | **PASS** | `raw/input_logic.json` |
| Business logic | duplicate PO number, receive cancelled PO, over / negative receive qty | refused | all refused (409/422) | **PASS** | `raw/input_logic.json` |

## Matrix diff vs the previous retest (`../../retest/authz_matrix_retest.csv`)

22 cells differ; **every one is explained by two deliberate test-input changes I made, not a behaviour change**:

1. **SECSELF on `GET /api/assets/{id}` and its sub-routes (changes/qr/label/events/documents): 404 → 200.** The
   previous matrix probed asset **id 2** (UNDER_REPAIR, held by the stock room); mine probes asset **id 1**,
   which SECSELF actually holds. Self-service custody is working in both runs — a different object id, not a
   regression. Confirmed: SECSELF still gets 404 on asset 2 (not held) and asset 9 (CKVPL).
2. **All staff personas on `GET /api/reports/movements/preview` and `/export/movements`: 422 → 200.** The
   previous matrix sent no `from_date`/`to_date` (required) → 422; mine supplies them → the request is valid →
   200, scoped to the caller's own company (verified: SECOTHER's result contains no CKSPL rows).

No persona gained access it did not have before. **0 escalations across all 3 038 cells.** The 14-identity
matrix also adds SPA, SECOPX and SECMUST columns that the previous run did not have — all consistent with the
guards (store logins = self-service; SECOPX reads its granted CKVPL assets; SECMUST = 403 on every authed route).

## New findings (full format)

**None.** No lower-privilege identity passed a guard; no cross-company, cross-work-area or cross-custody read
or write succeeded; the WP-B lifecycle-field guard holds at both the API and the database layer; mass
assignment of privileged fields is ignored; production file-serving, docs-off and upload/download controls hold.

### CL2-AC-OBS-01 — PDF-prefixed polyglot is stored (observation, not a finding; = CL1-OBS-FILES-01)
`content_matches_extension` checks only a signature **prefix** (`%PDF-` within the first 1 KB), so a file whose
body is `%PDF-…<html><script>…` is accepted and stored under `.pdf`. **Mitigated and not exploitable today:** the
only retrieval path (`GET /api/documents/{id}/download`) always serves the extension-derived `application/pdf`
with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` (verified this run). It would only
matter if a future screen rendered a stored document inline. Suggest a stricter content sniff then. Unchanged
since retest1.

## Confirmed-intended behaviours worth recording (not findings)
- **D6 (Full Admin not company-scoped):** SECFAIT/SECFANIT/SECFABOTH (home CKSPL) read CKVPL data; this is the
  documented open product decision, and they **are** still limited by work area (SECFANIT 404 on an IT asset).
- **Admin logs / diagnostics / item-maps are head-office-only:** every staff ADMIN that is not the Primary Owner
  (SECFAIT etc.) gets 403, only SECHO 200. Stricter than role=ADMIN.
- The append-only ledger correctly **refuses to hard-delete** a CL2 asset that had moved (my scrapped CL2 asset
  19 cannot be removed) — a positive control, left in its terminal state.

## What I could not exercise (honesty)
- **Genuine Windows path semantics:** the image is Linux, so `C:\…`, UNC, ADS, 8.3 and device-name payloads are
  refused **lexically before any filesystem call** (and 404 on logic). I verified the lexical rules in
  `static_safety.py` reject every Windows form, but a real `win.ini` read on a Windows host was not reproducible
  here (same limitation as retest1). The resolve-then-`is_relative_to` logic is OS-portable.
- **Owner/migrator/runtime DB role split (EXT-07):** out of the ACCESS area and not tested. The WP-B guard's own
  docstring states the application role can set the marker itself, so the guard is defence-in-depth against
  stray/ad-hoc writes, not a malicious DBA; that barrier is the role split.
- **A couple of business-logic probes (receive-cancelled, over/negative receive)** were refused at *input
  validation* before the specific state/quantity business rule ran; they were still refused (no mutation), and
  the state rule itself is proven by the terminal-asset and cross-company-move cases.
- The dead/disabled tokens were sampled against representative routes (capabilities + a write), not the full
  3 038-cell matrix (the tokens are rejected at authentication, so every route is identical 401).

## Cleanup / fixture integrity
All objects I created are tagged `CL2`. After the run: 23 SEC personas intact, exactly **2 primary owners**
(no new one created), no SEC persona password changed. My throw-away users (46, 47, 61, 62, 63) are
deactivated; my CL2 assets are soft-deleted except asset 19 (terminally SCRAPPED — the ledger forbids deleting
a moved asset, so it is left dead). Users 48–60 (`CL2R*`, `CL2PWPOL`, `CL2TIM`, `CL2OTHER`) belong to the other
concurrent retest agent and were left untouched. No token or password is stored in the repo (the cache lives in
the scratchpad only).
