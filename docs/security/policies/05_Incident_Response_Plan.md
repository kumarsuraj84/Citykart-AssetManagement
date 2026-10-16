# 05 — CKAM Incident Response Plan

| | |
|---|---|
| Document | CKAM-ISMS-05, version 0.1, 2026-10-16 |
| Status | **DRAFT — MANAGEMENT APPROVAL REQUIRED.** Not approved, never exercised |
| Owner (proposed) | ISMS Lead (plan); Incident Lead for each incident = CKAM System Owner unless Management names another |
| Approver | Management |
| Review | Yearly table-top exercise; after every SEV1 / SEV2 incident |
| Maps to | ISO A.5.5, A.5.24-5.28, A.6.8, A.8.15, A.8.16; SOC 2 CC7.2-CC7.5, CC2.2; EXT-03, EXT-20, EXT-22 |

## 1. What counts as an incident

Anything that may have exposed, changed or blocked CKAM data or service: a secret or file read by someone who
should not (IF-01 is the first real case), a misused or suspicious login, data of one company seen by another,
missing or altered audit rows, ransomware, lost backups, a long outage.

## 2. Severity

| Level | Meaning | CKAM example | First response |
|---|---|---|---|
| **SEV1** | Confirmed or likely compromise of secrets, admin accounts or data; or a hole open to the internet | IF-01 on production; a forged head-office-admin session | Within 1 hour; Management told the same day |
| **SEV2** | Misuse limited to one account or company; CKAM down more than 4 working hours | Many `LOCKED` / `RATE_LIMITED` rows for store logins; a Full Admin acting outside their job | Same working day |
| **SEV3** | Suspicious but contained | One `SUSPICIOUS_INPUT` row; a user reports a phishing link to a fake CKAM page | Within 2 working days |
| **SEV4** | Weakness without signs of use | A new advisory for a package CKAM uses | Doc 06 instead |

## 3. How incidents are noticed (CKAM's own tools)

* **Report a problem** in CKAM (any signed-in person) → a `client_report` with a **reference**; the head-office
  admin sees it under Logs › client reports (`GET /api/admin/logs/client-reports`).
* Every error message shows **"Reference …"** (the request id, also in the `X-Request-ID` header).
* **Logs** (head-office admin): security rows `GET /api/admin/logs/audit?category=security` — `LOGIN_FAILED`,
  `LOCKED`, `PERMISSION_DENIED`, `INVALID_TOKEN`, `TOKEN_REFRESH_FAILED`, `RATE_LIMITED` (after deploy),
  `SUSPICIOUS_INPUT`, `ACCESS_CHANGED`, `PRIMARY_OWNER_GRANTED`; grouped errors `GET /api/admin/logs/errors?group=true`;
  system events (start / stop, `db connectivity_lost`, ERP `sync_failed`).
* Home error count; weekly 15-minute security-log review (EXT-22; see §8).
* IT: backup log, antivirus/EDR, router and firewall logs. Outside reports (staff, vendors, CERT-In).

## 4. Response steps

| # | Step | What to do in CKAM terms |
|---|---|---|
| 1 | **Log it** | Open `templates/incident_record.md`; give an id (`INC-2026-001`); note the reference / request ids |
| 2 | **Triage** | Incident Lead sets the severity (§2); for SEV1/SEV2 call Management and IT |
| 3 | **Contain** | Choose the smallest step that stops harm: switch off the router forward of 3211 (IT); stop **only** the `CKAM-Web` task on 10.0.1.98 (never another app's task); switch off **Can sign in** for a suspicious login (ends its sessions); for a stolen signing key, change `JWT_SECRET` (every session ends). Do not run attack probes against production to "check" (for example the UNC path probe) |
| 4 | **Preserve evidence** before changing more | (a) **Logs › by request** `GET /api/admin/logs/request/<id>` for each reference; (b) **Diagnostics › Copy bundle** `GET /api/admin/diagnostics/bundle?hours=24&request_id=<id>`; (c) export the audit trail for the period `GET /api/admin/logs/export?kind=audit&from=…&to=…&format=jsonl`, and `kind=system`, `kind=errors`, `kind=client`; (d) copy `logs\app\*.jsonl` and the launcher logs before rotation (20 MB × 11 per file); (e) note router/firewall and PostgreSQL log locations. Store copies off the server, write a SHA-256 hash of each file in the record. Secrets are redacted by CKAM, but bundles and exports hold personal data: share them only with the people handling the incident |
| 5 | **Eradicate** | Fix through doc 04 (emergency path allowed); rotate every secret that may be known (EXT-02: JWT, `ckassetapp`, NAS `ckappuser`, ERP `ckpost`); remove old copies such as `shared\.env.pre-<sha>` |
| 6 | **Recover** | Restart, smoke checks (doc 04 step 13); restore data from a verified dump if needed (doc 07) |
| 7 | **Notify** | Management (always for SEV1/SEV2). Users if they must act (for example sign in again). **CERT-In**: the 2022 CERT-In directions require reporting of listed incident types within a short window (6 hours from noticing); Legal confirms applicability and who reports (EXT-31). Personal-data breach duties under the DPDP Act 2023: Legal decides |
| 8 | **Review** | Within 10 working days: timeline, cause, what worked, actions with owners and dates; new findings go to the findings register / closure register; risk register updated (doc 12) |

## 5. The first case: IF-01 (open)

Treat IF-01 as **SEV1**: the live server could hand out its own settings file since 2026-09-30. Containment and
eradication = decision **SD-01** (deploy, then rotate secrets). Evidence check = EXT-03 (look for `/assets/` paths
with `..`, `%2e`, `%2f`, `%5c` or a leading `/` in `logs\app\app.jsonl`; admin actions from unknown addresses or
without a LOGIN row; database and NAS connection attempts from other hosts). Result goes in an incident record,
whether or not signs of use are found.

## 6. Contacts (to be filled by Management)

| Role | Name | Phone | Backup |
|---|---|---|---|
| Incident Lead (CKAM System Owner) | | | |
| IT / Infra (10.0.1.98, 10.0.0.205, NAS, router) | | | |
| Dev Lead | | | |
| ERP warehouse owner (10.0.1.69) | | | |
| Legal | | | |
| Management | | | |

## 7. Exercise

Once a year a 1-hour table-top: "a store reports that a stranger knew their CKAM password" or "the nightly backup
failed for a week". Record attendance and actions.

## 8. Evidence this plan would produce

Incident records with hashes of preserved files; weekly log-review notes; exercise records; post-incident actions
tracked to closure.

## 9. What this does NOT yet prove

* No incident has been recorded, including IF-01 (EXT-03 not done); no exercise has been held; contacts are blank.
* No alerting exists (EXT-22): incidents are seen only when someone looks or complains.
* The CERT-In window and DPDP duties are not yet confirmed by Legal.
