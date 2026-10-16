# 11 — CKAM Periodic Access Review Procedure

| | |
|---|---|
| Document | CKAM-ISMS-11, version 0.1, 2026-10-16 |
| Status | **DRAFT — MANAGEMENT APPROVAL REQUIRED.** No review has been done yet |
| Owner (proposed) | CKAM System Owner (reviewer for CKAM logins); IT / Infra (reviewer for server, database, NAS and repository accounts); ISMS Lead (checks it happened) |
| Approver | Management |
| Frequency | **Quarterly** (first one within 30 days of approval, EXT-18); also after a major incident |
| Maps to | ISO A.5.15, A.5.18, A.8.2; SOC 2 CC6.2, CC6.3, CC6.4; EXT-18 |

## 1. Purpose

Every three months, confirm that each person who can sign in to CKAM still needs to, with the right access level,
work area and companies, and that privileged infrastructure accounts are still right. Fix what is wrong and keep a
signed record.

## 2. What to look at (real CKAM screens and data)

| Check | Where | Note |
|---|---|---|
| Who can sign in, their access level and work area | **Settings › Users & Access** → **People & Places › Employees**: columns *Can sign in*, *Password set*, *Access*, *Work area*, *Company*. Filter by company if you work in more than one | One row per person |
| Extra companies a person may work in | Open the person → **Company access** | Not shown as a column |
| Head-office admin accounts | Rows marked "Head-office admin only" for non-head-office viewers; the head-office admin sees them directly | Keep to the minimum (doc 02 §3) |
| Store logins | **People & Places › Stores**: *Login email* (`sm.<code>@citykartstores.com`), *Can sign in*, *Password set* | Follow decision SD-07 |
| A file to sign | People & Places **export** (Excel; `GET /api/asset-users/export`, Full Admin / head-office admin; writes an EXPORT audit row) | **Limit:** the export holds Company Code, Code, Name, Type, Location Code, Department, Email, Phone and Role only. It does **not** contain Can sign in, Work area, Company access or the head-office flag; note those from the screens (a dedicated review export would be a small product improvement) |
| When each login was last used | **Logs › Audit** (head-office admin): category *security*, action *LOGIN*, filter by person (`GET /api/admin/logs/audit?category=security&action=LOGIN&actor_id=<id>&from=…&to=…`) | CKAM stores no "last sign-in" field; a login unused for 90 days is a candidate to switch off |
| What changed since the last review | Logs › Audit: SECURITY `ACCESS_CHANGED`, `PRIMARY_OWNER_GRANTED` / `_REVOKED`, `PASSWORD_RESET`; DATA `CREATE` / `DEACTIVATE` on `asset_user`; export with `GET /api/admin/logs/export?kind=audit&from=…&to=…` | Each change should match a joiner / mover / leaver record (doc 03) |
| Leavers | HR's list of people who left in the quarter | Anyone on it who can still sign in is a finding |
| Server, database, NAS, repository accounts | IT's list: Windows administrators on 10.0.1.98 and 10.0.0.205; who knows the `postgres` password; PostgreSQL roles used by CKAM; NAS `ckappuser`; GitHub members | Infrastructure part of the review |

## 3. Steps

1. **Prepare** (reviewer, about 1 hour): take the export, the leaver list, the LOGIN rows for the quarter and the
   changes list; open `templates/access_review_record.md`.
2. **Check each login-enabled person and store**: still employed / still needed? Access level right? Work area right?
   Companies right? Head-office flag only where intended? Used in the last 90 days?
3. **Decide per row:** Keep / Change / Switch off. A store login is kept if the store is open and the SD-07 rule is
   followed.
4. **Fix** in People & Places the same day (switch off *Can sign in*, change access level, work area or company
   access). Each fix writes an `ACCESS_CHANGED` or `UPDATE` row: write its date and time in the record.
5. **Infrastructure part:** IT reviews its list and fixes; secrets known by someone who no longer needs them are
   rotated (doc 02 §4).
6. **Sign:** reviewer signs; the ISMS Lead countersigns that the review is complete; findings that cannot be fixed
   at once become actions with owners and dates.
7. **Keep** the record, the export and the audit extract together for at least the review period plus one year.

## 4. Evidence this procedure would produce

Per quarter: signed review record with counts (reviewed / kept / changed / switched off), the export file used, the
audit extract showing the fixes, IT's account list with sign-off.

## 5. What this does NOT yet prove

* No access review has ever been done; no record exists.
* The export does not hold all access fields, so a reviewer must read part of the information from the screens;
  this is slower and easier to get wrong.
* Last-use information depends on the LOGIN rows in `audit_log`, which exist in production only since release
  `3b5e842` (2026-10-14).
