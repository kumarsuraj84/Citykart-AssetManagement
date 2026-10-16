# Joiner / Mover / Leaver Record (CKAM) — blank form

> DRAFT — MANAGEMENT APPROVAL REQUIRED (form for doc 03). Copy, fill, keep the filled copy outside the repository
> (it holds personal data). Never write a password here, not even a temporary one.

## A. Event

| | |
|---|---|
| Record id | JML-YYYY-NNN |
| Type | Joiner / Mover / Leaver / Store manager change |
| Person (name, employee code) or store (code) | |
| Company | |
| Requested by (line manager / HR / area manager), date | |
| Approved by, date | |
| Effective date | |

## B. CKAM access

| | Before | After (as approved) |
|---|---|---|
| Can sign in | | |
| Access level (Full Admin / Can Add & Move Assets / View Only / Own Assets Only) | | |
| Work area (IT Team / Admin / Non-IT Team / Both) | | |
| Extra companies (Company access) | | |
| Head-office admin | | |

| Step | Done (date / time) | By | Audit row seen (action, time) |
|---|---|---|---|
| Employee / store created or edited in People & Places | | | `CREATE` / `UPDATE` / `ACCESS_CHANGED` |
| Temporary password issued (shown once; handed over in person / by phone) | | | `PASSWORD_RESET` |
| Can sign in switched off (leaver, same day) | | | `ACCESS_CHANGED` |
| Head-office admin flag removed (if any) | | | `PRIMARY_OWNER_REVOKED` |

## C. Assets (leaver or mover)

| | |
|---|---|
| Assets with this person on the effective date (count; from Assets › Currently with) | |
| Returned / handed over (asset codes, Move date) | |
| Remaining (count; reason; due date) | |
| Person deactivated in CKAM (date) — only when nothing is held | |

## D. Secrets and other systems (only if the person knew any)

| Secret / account (names only) | Rotated / removed (date) | By |
|---|---|---|
| | | |

## E. Close

| Role | Name | Date |
|---|---|---|
| Done by (CKAM) | | |
| HR confirmation | | |
