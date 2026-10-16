# 02 — CKAM Access Control Policy

| | |
|---|---|
| Document | CKAM-ISMS-02, version 0.1, 2026-10-16 |
| Status | **DRAFT — MANAGEMENT APPROVAL REQUIRED.** Not approved, not in operation |
| Owner (proposed) | CKAM System Owner (application access); IT / Infra (server, database, NAS, network access) |
| Approver | Management |
| Review | Yearly; and when decisions SD-02, SD-03, SD-06, SD-07, SD-13 or SD-14 are taken |
| Maps to | ISO A.5.3, A.5.15-5.18, A.6.7, A.8.2-8.5, A.8.18, A.8.20; SOC 2 CC6.1-CC6.3, CC6.6; EXT-18, EXT-19, EXT-23, EXT-26, EXT-30 |

## 1. Purpose

Make sure every person and every system account can do only what their job needs, and that this can be shown.

## 2. Application access (what CKAM already enforces)

The server checks role, company and work area on **every** request (`backend/app/core/capabilities.py`,
`backend/app/core/deps.py`); `GET /api/auth/capabilities` answers the screen from the same rules.

| Access level (screen word) | For | Can |
|---|---|---|
| **Head-office Admin** (Full Admin + head-office flag) | The CKAM System Owner and at most one named deputy | Everything, including companies, Places, custom fields, code format, Bulk Import, ERP Inbox, Logs and Diagnostics, changing other head-office admins |
| **Full Admin** | IT / Admin team leads | Operational work and People & Places within their work area; today in every company (decision **SD-02**) |
| **Can Add & Move Assets** | Operators | Receive, add, move, print in own work area and companies; create small records in the flow |
| **View Only** | Auditors, managers | Read in own work area and companies |
| **Own Assets Only** | Employees, store logins | See the assets with them; change own password |

Full matrix: `docs/ai/CKAM_FINAL_OPERATING_MODEL.md` §11. **Work area** (IT Team / Admin / Non-IT Team / Both) and
**Company access** narrow every staff login. A limited Full Admin cannot give anyone more than they have.

## 3. Rules

1. **Grant on request only.** Access is given on a joiner or mover request (doc 03) naming access level, work
   area and companies. Default for a new employee is **Own Assets Only** with "Can sign in" off.
2. **Least privilege.** Prefer Can Add & Move Assets over Full Admin; prefer one work area over Both; tick only the
   companies the job needs.
3. **Head-office admin accounts** are kept to the minimum (target: the CKAM System Owner plus one named deputy for
   emergencies). Each belongs to one named person; a non-personal bootstrap account (if any) is used only as
   break-glass, its password sealed in the password manager. Every grant or removal writes
   `PRIMARY_OWNER_GRANTED` / `_REVOKED`.
4. **Passwords.** Chosen passwords pass the CKAM policy (8-128 characters; no common passwords, sequences,
   company-name-plus-digits, common words with digits around them, or the person's own name / code / email).
   Issued passwords are random, shown once, handed over in person or by phone, and must be changed at first
   sign-in. Expiry and rotation follow decision **SD-13**.
5. **Shared logins** are not allowed, except the store login under the rule of decision **SD-07**.
6. **Wrong-password protection** follows decision **SD-06** (today: 5 wrong → 15-minute lock; 20 attempts per
   minute per address; 10 per minute per login id).
7. **Sessions** follow decision **SD-14** (today: 15-minute access pass, 8 hours idle; sign-out, password change,
   access change and switching off a login end every session of that account at once).
8. **Second factor (MFA)** follows decision **SD-03**. Until MFA exists, head-office admin work is done from the
   office LAN or VPN where decision SD-04 allows.
9. **Logs and Diagnostics** are head-office-admin only; every use writes an ACCESS row (`LOGS_VIEWED`,
   `DIAGNOSTICS_VIEWED`, `DIAGNOSTICS_BUNDLE`).
10. **Reviews.** Every login is reviewed each quarter (doc 11).

## 4. Infrastructure and privileged access

| Asset | Rule |
|---|---|
| Windows logon to 10.0.1.98 / 10.0.0.205 | Named administrator accounts only; list kept by IT and reviewed quarterly (doc 11) |
| `CKAM-Web` task | Runs as a dedicated non-administrator service account, not SYSTEM (EXT-06; today SYSTEM, IF-07) |
| `shared\.env`, `shared\nas.pw` | Administrators + the CKAM service account only; values never printed |
| PostgreSQL superuser (`postgres`) on 10.0.0.205 | Typed only by the CKAM System Owner on the server; used only for planned steps (role changes, logging settings) |
| CKAM database roles | Runtime role cannot own tables, TRUNCATE, ALTER, DROP, disable triggers or purge audit rows; migrations run under a separate role (decision **SD-11**, EXT-07). Today `ckassetapp` does both |
| NAS user `ckappuser` | CKAM's folder only |
| ERP role `ckpost` | SELECT only on the views CKAM reads; read-only set on the role (EXT-25) |
| Source repository | Company-owned organisation, MFA for every member, protected default branch `claude/brave-euler-07879a` (EXT-28; today a personal account) |
| Remote access | According to decision **SD-04** (VPN or allow-list) |
| Secrets | Held in the company password manager with two named people and a sealed break-glass procedure (EXT-23); rotated on events (staff change, incident) and yearly |

## 5. Evidence this policy would produce

* Joiner / mover / leaver records (template `templates/joiner_mover_leaver_record.md`) matched to audit rows
  `CREATE` / `UPDATE` / `DEACTIVATE` on `asset_user`, `ACCESS_CHANGED`, `PASSWORD_RESET`.
* Quarterly access review sign-offs (doc 11).
* `audit_log` SECURITY rows: `LOGIN`, `LOGIN_FAILED`, `LOCKED`, `PERMISSION_DENIED`, `RATE_LIMITED` (after deploy).
* IT's list of server / database / NAS / repository accounts with review dates; secret-rotation notes (who, when,
  which secret; never the value).

## 6. What this does NOT yet prove

* The application rules in §2 are tested (217 routes × 11 kinds of user, zero escalation; retested), but the latest
  fixes are **not deployed**; production runs `3b5e842`.
* No access request, approval or review record exists yet; nothing shows that grants matched a job need.
* Infrastructure rules in §4 are targets: today the task runs as SYSTEM, the runtime database role owns the tables,
  the repository is under a personal account, and no password manager is evidenced.
* MFA, lock-out model, session lifetime, store logins and Full Admin company scope are **open decisions**.
