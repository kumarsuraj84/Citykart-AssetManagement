# 13 — CKAM Internal Audit Checklist

| | |
|---|---|
| Document | CKAM-ISMS-13, version 0.1, 2026-10-16 |
| Status | **DRAFT — MANAGEMENT APPROVAL REQUIRED.** No internal audit has been performed |
| Owner (proposed) | ISMS Lead (programme); the auditor is someone **independent of CKAM development and of the System Owner** (another CityKart team or an outside firm) |
| Approver | Management |
| Frequency | Yearly (first one within 12 months, EXT-36); extra audit after a SEV1 incident |
| Maps to | ISO/IEC 27001:2022 clause 9.2; A.5.35, A.5.36, A.8.34; SOC 2 CC4.1, CC4.2 |

## 1. How to use

For each line: ask for the evidence, look at a **sample** (sizes suggested), mark **C** (conforms), **NC** (does
not conform) or **OBS** (observation), and note what you saw. An NC needs an action with owner and date, tracked
in the management review (doc 14). The auditor must not change anything in production; read-only access to the Logs
screens is given by a head-office admin sitting with the auditor.

## 2. Checklist

| # | Area (doc) | Question | Evidence to ask for | Sample | Result | Notes |
|---|---|---|---|---|---|---|
| 1 | Policy (01) | Is the policy pack approved, versioned and communicated? | Signed README status table; acknowledgement list | All docs | | |
| 2 | Roles (01) | Are ISMS Lead, System Owner, IT, Internal Auditor named? | Appointment notes | — | | |
| 3 | Risk (12) | Was the register reviewed and approved in the last 12 months? Are Critical risks treated? | Approved register; minutes | All Critical/High | | |
| 4 | Risk (12) | Is every risk acceptance written and dated by Management? | `docs/ai/DECISIONS.md` entries | All acceptances | | |
| 5 | SoA (15) | Does the SoA match the current risk register and control matrix? | SoA version, matrix CSV | 10 controls | | |
| 6 | Access (02, 11) | Were four quarterly access reviews done and signed? | Review records + exports | All 4 | | |
| 7 | Access (11) | Do review fixes appear in the audit trail? | `ACCESS_CHANGED` rows | 5 fixes | | |
| 8 | JML (03) | Was every leaver's login switched off on the last day and assets returned? | HR leaver list vs CKAM rows | 5 leavers | | |
| 9 | JML (03) | Did each new login have an approved request with access level, work area, companies? | JML records vs `CREATE` rows | 5 joiners | | |
| 10 | Privileged (02) | How many head-office admin accounts exist; is each tied to one person? | People & Places; `PRIMARY_OWNER_*` rows | All | | |
| 11 | Privileged (02) | Does `CKAM-Web` run as a non-administrator account? Is the runtime DB role not the table owner? | Task Scheduler screenshot; `pg_roles` / owner query | — | | |
| 12 | Decisions | Are SD-02, SD-03, SD-06, SD-07, SD-13, SD-14 decided and, where built, deployed? | `docs/ai/DECISIONS.md`; closure register | — | | |
| 13 | Change (04) | Does every production release have a complete change record (two approvals, tests, backup name, migration, smoke, result)? | Change records vs `system_event` `app_started` | 2 releases | | |
| 14 | Change (04) | Were emergency changes recorded within one working day and reviewed? | Emergency records | All | | |
| 15 | Change (04) | Is the production install pinned (`pip freeze` = tested set)? | `releases\<sha>\` freeze file | 2 releases | | |
| 16 | Change (04) | Are launcher and release script in git and equal to the server copy? | Diff by IT | — | | |
| 17 | Vulnerability (06) | Were monthly npm audit / pip-audit runs recorded and items fixed within the deadlines? | Audit outputs; triage records | 3 months | | |
| 18 | Vulnerability (06) | Were servers patched monthly? | Patch reports | 3 months × 2 servers | | |
| 19 | Vulnerability (06, SD-10) | Was an independent VAPT done; are its findings tracked? | Report; tracker | — | | |
| 20 | Incident (05) | Is there an incident record for IF-01 (EXT-03)? Were incidents handled per plan? | Incident records | All SEV1/SEV2 | | |
| 21 | Incident (05) | Was the yearly exercise held? | Exercise record | — | | |
| 22 | Monitoring (05) | Were weekly security-log reviews done? | Review notes | 4 weeks | | |
| 23 | Backup (07) | Is there a daily off-server encrypted copy and an offline / immutable copy? | Copy logs | 5 days | | |
| 24 | Backup (07) | Were four restore drills done with times and row counts? | Restore records | All | | |
| 25 | BC/DR (08) | Are RTO/RPO approved; was the reboot test done; is "no standby" accepted? | Plan; test record | — | | |
| 26 | Supplier (09) | Was each supplier in the register reviewed this year? | Register with dates | All Critical/High | | |
| 27 | Awareness (10) | Does every login holder have a training / acknowledgement record? | Attendance list vs user list | 10 users | | |
| 28 | Logging | Is log retention set as decided (SD-15) and are monthly exports kept off-server with hashes? | `LOG_RETENTION_DAYS`; export store | 3 months | | |
| 29 | Transport | Is CKAM HTTPS-only with a valid certificate; refresh cookie `Secure`; renewal date tracked? (after SD-05) | TLS check; calendar | — | | |
| 30 | Exposure | Is the internet forward as decided in SD-04? | Router config export | — | | |
| 31 | Secrets | Were secrets rotated after IF-01 and on staff changes; are they in the password manager with two holders? | Rotation notes; vault entry names | — | | |
| 32 | Dev PC | Are `.env` and `backups\` restricted and the disk encrypted on 10.0.0.47? | `icacls`; BitLocker status | — | | |
| 33 | Testing safety | Were security tests run only on throw-away stacks, never on production without written approval? | Evidence folders; approvals | — | | |

## 3. Audit report (summary)

| | |
|---|---|
| Audit period | |
| Auditor (name, team) and independence statement | |
| Lines C / NC / OBS | |
| Major nonconformities | |
| Actions agreed (owner, date) | |
| Signed (auditor / ISMS Lead) | |

## 4. What this does NOT yet prove

Nothing has been audited. Many lines will be NC on a first audit, because the records they ask for do not exist yet
(see the "What this does NOT yet prove" note in each document).
