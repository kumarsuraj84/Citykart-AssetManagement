# CKAM Security Policy Pack (DRAFT)

> **Every document in this folder is DRAFT — MANAGEMENT APPROVAL REQUIRED.** None is approved, none has been
> communicated, and none is operating. A draft policy is not a control: it proves nothing until it is approved and
> its records exist. CKAM is **not** ISO/IEC 27001 certified and has **no** SOC 2 report.

Written 2026-10-16 by work package WP-D2 of the security closure programme (documents only; no code, server or
database change). Inputs: `../CKAM_ISO27001_READINESS.md`, `../CKAM_SOC2_READINESS.md`, both control matrices,
`../CKAM_EXTERNAL_SECURITY_ACTIONS.md`, `../CKAM_SECURITY_CLOSURE_REGISTER.md`, `docs/ai/DECISIONS.md`,
`docs/ai/PRODUCTION_INFRASTRUCTURE.md`, `docs/ai/LOGGING_AND_DIAGNOSTICS.md`, `docs/ai/CKAM_FINAL_OPERATING_MODEL.md`.
Owner decisions these documents wait for are in `../CKAM_SECURITY_DECISIONS_REQUIRED.md` (SD-01 … SD-16).

## In plain words

These are the written rules an auditor asks for first (who may do what, how changes go live, what to do in an
emergency, how backups are tested, and so on), written for CKAM as it really runs. They are short on purpose. To
make them real: management approves them (decision SD-16), names the people, and the routines start producing
records (the blank forms are in `templates/`).

## Status table

| # | Document | Proposed owner | Review | Status | Approved by / date | Operating since | First record expected |
|---|---|---|---|---|---|---|---|
| 01 | [Information Security Policy](01_Information_Security_Policy.md) | ISMS Lead | Yearly | DRAFT | — | Not operating | Acknowledgement list |
| 02 | [Access Control Policy](02_Access_Control_Policy.md) | CKAM System Owner; IT / Infra | Yearly | DRAFT | — | Not operating | JML records, account list |
| 03 | [Joiner / Mover / Leaver Procedure](03_Joiner_Mover_Leaver_Procedure.md) | HR + CKAM System Owner + IT | Yearly | DRAFT | — | Not operating | `templates/joiner_mover_leaver_record.md` |
| 04 | [Change Management Procedure](04_Change_Management_Procedure.md) | Dev Lead; CKAM System Owner | Yearly | DRAFT (flow followed in practice; records not kept) | — | Not operating | `templates/change_record.md` (first: the IF-01 deploy) |
| 05 | [Incident Response Plan](05_Incident_Response_Plan.md) | ISMS Lead; Incident Lead | Yearly exercise | DRAFT | — | Not operating | `templates/incident_record.md` (first: IF-01, EXT-03) |
| 06 | [Vulnerability Management Procedure](06_Vulnerability_Management_Procedure.md) | Dev Lead; IT / Infra | Yearly | DRAFT | — | Not operating | `templates/vulnerability_triage_record.md` |
| 07 | [Backup and Restore Policy](07_Backup_Restore_Policy.md) | IT / Infra | Yearly | DRAFT | — | Not operating | `templates/restore_test_record.md` |
| 08 | [Business Continuity and DR Plan](08_Business_Continuity_and_DR_Plan.md) | CKAM System Owner; IT / Infra | Yearly | DRAFT | — | Not operating | Reboot test record |
| 09 | [Supplier Security Review](09_Supplier_Security_Review.md) | ISMS Lead | Yearly | DRAFT | — | Not operating | Reviewed register |
| 10 | [Security Awareness Plan](10_Security_Awareness_Plan.md) | ISMS Lead; HR | Yearly | DRAFT | — | Not operating | Attendance list |
| 11 | [Periodic Access Review Procedure](11_Periodic_Access_Review_Procedure.md) | CKAM System Owner; IT | Quarterly | DRAFT | — | Not operating | `templates/access_review_record.md` |
| 12 | [Risk Management Procedure](12_Risk_Management_Procedure.md) | ISMS Lead | Yearly + triggers | DRAFT (register exists as a draft: 33 risks) | — | Not operating | Approved register version |
| 13 | [Internal Audit Checklist](13_Internal_Audit_Checklist.md) | ISMS Lead; independent auditor | Yearly | DRAFT | — | Not operating | Audit report |
| 14 | [Management Review Agenda](14_Management_Review_Agenda.md) | Management; ISMS Lead | Yearly | DRAFT | — | Not operating | Minutes |
| 15 | [Statement of Applicability — working draft](15_Statement_of_Applicability_Working_Draft.md) | ISMS Lead | After risk approval, then yearly | WORKING DRAFT (not the official SoA) | — | — | Approved SoA |

Counts: **15 documents, 0 approved, 0 operating, 0 records.**

## Blank record forms (`templates/`)

| Form | Used by |
|---|---|
| [access_review_record.md](templates/access_review_record.md) | Doc 11 (quarterly) |
| [incident_record.md](templates/incident_record.md) | Doc 05 |
| [change_record.md](templates/change_record.md) | Doc 04 (every production change) |
| [restore_test_record.md](templates/restore_test_record.md) | Doc 07 (quarterly) |
| [vulnerability_triage_record.md](templates/vulnerability_triage_record.md) | Doc 06 |
| [joiner_mover_leaver_record.md](templates/joiner_mover_leaver_record.md) | Doc 03 |

Copy a form, fill it, and keep the filled copies **outside this repository** if they contain personal data (names,
phone numbers); the repository keeps only the blank forms. Never write a password, secret or key into any form.

## How a document becomes approved

1. Management reads it, changes what it wants, and signs (name, date) in this table and in the document header
   (status "APPROVED v1.0").
2. Its decisions marked "SD-xx" are taken first or the text says "pending SD-xx".
3. The first record is produced; the "Operating since" column gets that date.
4. The ISMS Lead reviews it on the cadence shown.
