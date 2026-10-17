# Release documentation pass, 2026-10-17 (second pass): what changed, assumptions, unknowns

Written by the release manager / technical writer. **Documents only.** I wrote no code and no scripts, ran no git
write and no docker, and did not contact any server. Nothing is approved or executed. `ops/windows/**` was not
touched (another engineer owns it).

## 1. New files

| File | State |
|---|---|
| `docs/security/CKAM_EMERGENCY_CHANGE_RECORD_DRAFT.md` | Complete DRAFT. Every approval is blank and `PENDING`. Status `DRAFT — NOT APPROVED — NOT EXECUTED — NOT COMPLETED` |
| `docs/security/CKAM_GITHUB_PUBLIC_REPO_OPTIONS.md` | Complete. Options A (recommended), B and C, each with risk, benefit, consequence and effort. No visibility change, no push |
| `docs/security/CKAM_PRODUCTION_SECURITY_GO_NO_GO.md` | Complete. 12 gates and 17 owner/infra questions. Verdict `TO BE FILLED BY LEAD` |
| `docs/security/CKAM_COMPROMISE_ASSESSMENT_PLAN.md` | **INCOMPLETE.** The writing session stopped partway through this file. Only the header, the facts and part of the evidence-preservation section were written, and the file ends mid-sentence. The lead must review it and either complete it or replace it. The runbook (steps B, K) and the go/no-go table (gate 9) still point to it |
| this file | — |

## 2. Files changed (each edit is marked "updated 2026-10-17, security release")

| File | Change |
|---|---|
| `docs/security/CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md` | `eed3de1` facts replaced by placeholders, with `eed3de1` kept only as the superseded candidate. GT-F01/F02/F04/F05/F06 corrected. Deploy-template warning: the automatic restart is being removed, so rely on no automatic rollback until the operator has read the fixed template. colorama is now pinned. `verify_release.ps1` gets launcher-flag checks. F4 timing filled from the gate rehearsal. H: mandatory GT-F05 checks, move as the real trigger test, default-label QR scan. Checklist and DO NOT list updated |
| `docs/security/CKAM_PRODUCTION_ROLLBACK_STRATEGY.md` | Placeholders. §2 table: old code on the migrated schema receives but cannot move/sell (GT-F01); new code on the old schema hides the failure (GT-F05). §3 facts: GT-F04, plus the old code on the pinned packages (Linux) from the gate rehearsal. Cases 1–3 corrected. §5: rehearsal results (only `downgrade -1`; never all four). §6: the template's automatic restart is being removed, no reliance on it, no acceptance on health alone. §8: timings filled where rehearsed |
| `docs/security/CKAM_SECRET_ROTATION_CHECKLISTS.md` | `eed3de1` → `<RELEASE-SHA>` only |
| `docs/security/CKAM_SECURITY_MASTER_HANDOVER.md` | §5 CL2-IF-04 "Which QR codes" (GT-F02). §6.3 row 4 (GT-F01). §9(a) rows 1, 10, 12, 13. §10 item 14 (GT-F02) and item 18 (GT-F01). §11.4 row 8. §11.5 (GT-F01, F04, F05, template). §11.6 pointer |
| `docs/security/CKAM_SECURITY_FINAL_CLOSURE_REPORT.md` | Part A, "What was still open": the label sentence (GT-F02) |
| `docs/security/CKAM_SECURITY_DECISIONS_REQUIRED.md` | SD-04 impact (GT-F02) |
| `docs/security/CKAM_THREAT_MODEL.md` | Fake-sticker row (GT-F02) |
| `docs/security/CKAM_HTTPS_IMPLEMENTATION_PLAN.md` | `BASE_URL` row (GT-F02; keep the old address redirecting) |
| `docs/security/CKAM_SECURITY_REMEDIATION_REPORT.md` | Migration table row 4 (GT-F01) |
| `docs/security/CKAM_EXTERNAL_SECURITY_ACTIONS.md` | EXT-01 "What" (steps A–N, placeholders). Matrix rows EXT-01 rollback/evidence (roll forward, GT-F01/F05) and EXT-44 (default-label scan) |
| `docs/security/CKAM_SECURITY_BASELINE.md` | Release smoke line (GT-F06, GT-F05) |
| `docs/security/CKAM_SERVICE_ACCOUNT_PLAN.md` | §9: production DB role `ckassetapp`, not the retired `ckam_app` |
| `docs/security/policies/04_Change_Management_Procedure.md` | Rows 13 (GT-F06/F05) and 14 (roll forward, no automatic rollback) |
| `docs/ai/PRODUCTION_INFRASTRUCTURE.md` | URL row and public-access note (GT-F02). Deploy steps 2 (`constraints.txt`, `VERSION`), 3 (`pip install -c …`, migrate before start, both flags, keep both release folders), 4 (replacement checks for `/openapi.json`, GT-F05) and 5 (roll forward). 2026-10-14 notes: the `/openapi.json` check no longer applies |
| `docs/ai/LOGGING_AND_DIAGNOSTICS.md` | §5: `ENVIRONMENT_NAME` defaults to `production` when unset |
| `docs/ai/CKAM_RELEASE_RUNBOOK.md` | §0 steps 3 and 4 (template restart, GT-F05/F06). Launcher line now has `--no-server-header` |

## 3. Placeholders left for the lead

`<RELEASE-SHA>` (short and full), `<ZIP-SHA256>`, `<ZIP-SIZE>`, `<CONTENT-HASH>`, plus four I added: `<FILE-COUNT>`,
`<ENTRY-COUNT>`, `<BUNDLE-JS>` / `<BUNDLE-JS-REGEX>` and `<BUNDLE-CSS>`. The JS bundle name changes with every build
because the bundle contains the release id. All `TO BE FILLED BY LEAD` markers remain, notably:

- the `git diff` scope against `fd34520`;
- the colorama version and the pin count;
- the regression run on `<RELEASE-SHA>`;
- whether the gate results carry over to the rebuilt package;
- the rebuilt package report path;
- the `verify_release.ps1` launcher-flag row names;
- the production timings and the maximum downtime;
- the go/no-go results and verdict.

## 4. Assumptions

- The rebuilt package changes only `ops/windows/**` and `backend/constraints.txt`. Application code, migrations and
  frontend source are the same as in `eed3de1`, so the gate-rehearsal behaviour (GT-F01…F06, timings) applies. The
  lead must confirm this.
- The fixed deploy template no longer restarts `3b5e842` after the migrations. I have not seen the fixed template, so
  every document says not to rely on any automatic rollback until the operator has read it.
- The fixed template keeps the `-Sha`, `-PackagePath` and `-BackupConfirmed` parameter names (the runbook says to
  confirm them).

## 5. Not changed, deliberately

- Historical evidence files: `PACKAGE_REPORT.md`, `GATE_REHEARSAL.md`, retest reports. They describe their own date
  and package.
- `ops/windows/README.md` (GT-F06 sentence): owned by the script engineer.
- `CKAM_SECURITY_COMPLETE_REPORT.md`: the superseded 2026-10-15 compilation. Its line about `/docs` "with the dist
  folder they get the SPA shell" records an earlier retest state.
- ISO/SOC 2 CSV matrices: I found no GT statement in them.

## 6. Unknowns and contradictions not resolved

1. **Compromise assessment plan incomplete** (see §1).
2. **The closure report has no "receives also fail" statement.** I found one only in the runbook, the rollback
   strategy, the handover and the remediation report, and corrected those.
3. **Review window before 2026-10-07.** IF-01 shipped on 2026-09-30, but CKAM moved to 10.0.1.98 only on
   2026-10-07. Before that it ran on the retired 10.0.1.12, which must not be touched. Whether its archive should
   ever be reviewed is an owner question that is not answered.
4. **Handover §9(a) step 0 vs the runbook.** The handover says "close or narrow the 3211 forward today". The runbook
   says closing it is not authorised and is the owner's separate decision. Both are left as written. The go/no-go
   list has it as Q10.
5. **Outdated phase numbers.** The handover and the EXT list still use the old "Phase 4/7" numbering in places. I
   added pointers to steps A–N but did not renumber everything.
6. **No Windows timing.** The gate rehearsal timed only the database part (Linux). Stop, `pip install`, start and
   the H checks on Windows are untimed.
