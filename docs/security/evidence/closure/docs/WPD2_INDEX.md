# WP-D2 — Decisions paper and DRAFT policy pack: index

| | |
|---|---|
| Work package | WP-D2 (security closure programme), documents only |
| Date | 2026-10-16 |
| Code state read | HEAD `627ed73`; Alembic head `a3c5e7f9b1d4`; production still `3b5e842` |
| What was NOT done | No code, git, Docker, server, database or network action. Nothing was connected to production, 10.0.0.205, the NAS, the ERP or 10.0.1.12. No credential is written in any file |

## 1. Files produced

| File | What it is |
|---|---|
| `docs/security/CKAM_SECURITY_DECISIONS_REQUIRED.md` | 16 owner decisions (SD-01 … SD-16), each with current behaviour, risk, options A/B(/C), recommendation, impact, what to decide, deadline. **None decided** |
| `docs/security/policies/README.md` | Index and status table (15 documents: all DRAFT, 0 approved, 0 operating) |
| `docs/security/policies/01_Information_Security_Policy.md` … `14_Management_Review_Agenda.md` | 14 DRAFT policies / procedures / plans |
| `docs/security/policies/15_Statement_of_Applicability_Working_Draft.md` | 93 Annex A controls, generated from `CKAM_ISO27001_CONTROL_MATRIX.csv` (Applicable Y/N, justification, status, gap, policy, owner). Working draft, **not** the official SoA |
| `docs/security/policies/templates/*.md` (6) | Blank forms: access review, incident, change, restore test, vulnerability triage, joiner/mover/leaver |
| `docs/security/evidence/closure/docs/make_soa.mjs` | The script that generated doc 15 (`node make_soa.mjs <matrix.csv> <out.md>`); it checks there are exactly 93 rows. Run on 2026-10-16: 93 rows; Applicable YES 89 / PARTIAL 3 / NO 1; status READY 5 / PARTIAL 43 / MISSING 13 / NOT EVIDENCED 31 / N/A 1 (equal to `CKAM_ISO27001_READINESS.md` §5.1) |
| `docs/security/evidence/closure/docs/WPD2_INDEX.md` | This file |

Every policy and form carries `DRAFT — MANAGEMENT APPROVAL REQUIRED` and a "What this does NOT yet prove" note.
No status in any register or matrix was raised because of these drafts.

## 2. Contradictions found (between `docs/ai/` and the security reports, or inside them)

| # | Where | Contradiction | Suggested fix (for the WP-D documents writer / owner) |
|---|---|---|---|
| C-1 | `docs/ai/DECISIONS.md` vs `docs/ai/PRODUCTION_INFRASTRUCTURE.md` line 24 | The owner's deferral of HTTPS (2026-10-08) is recorded only in the infrastructure file; `DECISIONS.md` has no entry for it (the WP-D2 brief expected it there) | Add a dated entry to `DECISIONS.md` when SD-05 is decided (or record the 2026-10-08 deferral as history) |
| C-2 | `docs/ai/DECISIONS.md` 2026-09-24 AM-09 (8) and `docs/ai/PRODUCT_CONTEXT.md` "Deployment" | Both justify plain HTTP / `COOKIE_SECURE=false` by a **LAN-only, no internet exposure** design. Production is forwarded from the internet (`PRODUCTION_INFRASTRUCTURE.md` line 19) and the security reports rate this IF-02 **HIGH**. The premise of that decision no longer holds | Mark AM-09 (8) superseded when SD-04 / SD-05 are decided |
| C-3 | `docs/ai/PRODUCT_CONTEXT.md` (personas, business rules) and `DECISIONS.md` 2026-09-29 | Say ADMIN / Primary Owner are always unrestricted by work area, and describe a Docker Compose deployment. Superseded by `DECISIONS.md` 2026-10-14 (4) (a Full Admin can be limited to a work area) and by the Windows single-process production. The security reports follow the newer rule; `PRODUCT_CONTEXT.md` is stale | Refresh `PRODUCT_CONTEXT.md` (not in WP-D2 scope) |
| C-4 | `CKAM_EXTERNAL_SECURITY_ACTIONS.md` EXT-18, `CKAM_ISO27001_READINESS.md` §11 item 3 vs code | They say the quarterly review checks access level, companies, work area and the head-office flag from `GET /api/asset-users/export`. The export (`backend/app/asset_users/router.py` lines 44-70) holds only Company Code, Code, Name, Type, Location Code, Department, Email, Phone, Role — **not** Can sign in, work area, extra companies or the head-office flag. Doc 11 tells the reviewer to read those from the People & Places screens | Correct EXT-18 wording; optional small product improvement: an access-review export |
| C-5 | `CKAM_SOC2_READINESS.md` CC3 vs `CKAM_ISO27001_READINESS.md` §9 | SOC 2 file says the draft register has **31** risks; the ISO register has **33** (R-32, R-33 added later) | Fix in the OBS-DOCS refresh |
| C-6 | `docs/ai/LOGGING_AND_DIAGNOSTICS.md` §4 vs security reports | Logging doc says `ckam_purge_audit_log` refuses only a cut-off under 1 day; migration `a3c5e7f9b1d4` (security reports IF-06) adds a **5-year** floor | Update the logging doc when the closure register is updated |
| C-7 | `docs/ai/DECISIONS.md` 2026-10-13 (two-company plan) vs the security reports | The owner decided that an asset may be allotted across companies in both directions (not built; the engine refuses it). The security reports and the cross-company tests assume strict company isolation. Not a contradiction today, but building that decision changes the company-isolation tests and interacts with SD-02 | Decide SD-02 with this in mind |
| C-8 | `docs/security/CKAM_ISO27001_READINESS.md` §6 vs `CKAM_SECURITY_CLOSURE_REGISTER.md` | Readiness still lists N3 as ACCEPTED and IF-13 as OPEN EXTERNAL; the closure register reclassified both as OPEN — CODE FIXABLE (already recorded there as a change) | Covered by OBS-DOCS |

No contradiction was found between the **decided** items of `DECISIONS.md` and the security reports' recommendations:
D6 is open in both; push/deploy separation, backend-authoritative permissions, append-only history, store rooms and
store-login format, head-office-only code rules agree. The decisions paper does not contradict any decided item.

## 3. Assumptions made

* Role names (ISMS Lead, CKAM System Owner, Dev Lead, IT / Infra, Internal Auditor) are proposals; no person is named.
* Store logins are used by several staff in practice (from the WP-D2 brief and risk R-30); not measured.
* Deadlines are counted from 2026-10-16 (URGENT ≈ 1 week, then 30 / 90 days as in the external actions list).
* Fix deadlines (doc 06), RTO 1 working day / RPO 24 h (doc 08), backup retention 30 daily + 12 monthly (doc 07),
  session numbers (SD-14), lock-out numbers (SD-06) and `LOG_RETENTION_DAYS` ≈ 400 (SD-15) are proposals for
  Management, not facts.
* Production role names in SD-11 (`ckasset_owner`, `ckasset_migrator`, keep `ckassetapp` as runtime) are proposed to
  avoid the retired `ckam_app` name and to follow the production prefix; the throw-away WP-B stack may use other names.
* CERT-In's 2022 directions are cited with a 6-hour reporting window for listed incident types; applicability to
  CityKart is for Legal to confirm (EXT-31).
* Effort figures ("about 2-4 hours a month", "a few hundred MB") are estimates and marked as such.

## 4. Facts that could not be verified (no access by design)

* Whether stores reach CKAM over the internet, an MPLS link or a VPN; whether CityKart has a corporate VPN or a
  `*.citykartstores.com` wildcard certificate.
* Whether an open, unattended browser tab renews its session by itself (would make the 8-hour idle limit
  ineffective); not tested in WP-D2.
* How many head-office admin accounts exist in production and whether any is non-personal (production held "two
  admin accounts" on 2026-10-14 per `PRODUCTION_INFRASTRUCTURE.md`; the bootstrap account is named "Admin").
* NAS document backup; server patch level; EDR; physical security; HR screening / NDAs; GitHub ownership and MFA.
* Who owns the tables in the production database today (documented as `ckassetapp`, not inspected).
* Budget for an external VAPT; the data-use terms of the AI coding assistant plan in use.
* Any production log (no compromise assessment for IF-01 has been done; EXT-03).

## 5. Next steps (owner)

1. Answer SD-01 and SD-04 (urgent).
2. Decide SD-16 and name the ISMS Lead; review the README status table.
3. Use `templates/change_record.md` for the IF-01 deploy and `templates/incident_record.md` for EXT-03, so the first
   operating records exist.
