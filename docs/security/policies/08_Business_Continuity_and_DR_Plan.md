# 08 — CKAM Business Continuity and Disaster Recovery Plan

| | |
|---|---|
| Document | CKAM-ISMS-08, version 0.1, 2026-10-16 |
| Status | **DRAFT — MANAGEMENT APPROVAL REQUIRED.** Recovery targets are proposals; nothing here has been tested |
| Owner (proposed) | CKAM System Owner (business side); IT / Infra (technical recovery) |
| Approver | Management |
| Review | Yearly; after every real outage longer than the recovery target |
| Maps to | ISO A.5.29, A.5.30, A.5.37, A.7.1-7.13 (inherited), A.8.6, A.8.14; SOC 2 A1.1-A1.3, CC7.5, CC9.1; EXT-29 |

## 1. How much CKAM matters (business impact)

CKAM is not the till: stores keep selling when CKAM is down. Without CKAM, people cannot receive POs into assets,
move or allot assets, print labels, or answer "who has this laptop". Nothing is lost if work waits a day and is
entered later (the Move form takes a date under **More**).

**Proposed targets (to be agreed, EXT-29):**

| | Proposal | Today's ability |
|---|---|---|
| Recovery time (RTO): how long CKAM may be down | 1 working day | Unknown (no drill) |
| Recovery point (RPO): how much recent work may be lost | 24 hours (daily dump) | 24 hours **only if** the database server's own disk survives (no off-server copy) |

## 2. Scenarios and recovery

| Scenario | First steps | Recovery |
|---|---|---|
| `CKAM-Web` stopped or crashed | Task Scheduler restarts it every minute (up to 999 times) | Read the launcher log and `system_event`; fix via doc 04 |
| A release is broken | Stop using the new feature; tell users | Rollback: previous `releases\<sha>` folder + restart; database restore only if the schema changed and only from a verified dump |
| 10.0.1.98 lost | Tell users; paper fallback (§3) | Rebuild a Windows server: Python 3.13, venv, last release from git, `shared\.env` from the password manager, NAS mapping, firewall rule, task. Steps must be in the Windows runbook (IF-15, EXT-13) |
| 10.0.0.205 lost (database) | Tell users | Restore the latest dump into PostgreSQL 18 on another server; update `DATABASE_URL`; **impossible today if the backups were on the same server** (IF-08) |
| NAS lost | Uploads fail; register still works | Restore the folder from its backup (not evidenced today) |
| Ransomware on a server | Doc 05 SEV1; isolate | Rebuild clean; restore from the offline / immutable copy (doc 07); rotate every secret |
| Compromise (IF-01 type) | Doc 05 | Fix, rotate secrets, check evidence |
| ERP warehouse 10.0.1.69 down | Nothing: CKAM works from its own ERP copy and shows "ERP data as of …" | Copy resumes by itself every 30 minutes |
| Internet or router down | LAN users unaffected; outside users wait (or VPN, decision SD-04) | IT restores the line |
| Certificate expired (after SD-05) | Browsers refuse the site | Renew; calendar alert |

**No standby server exists** (one app server, one database server). Management must either accept this in writing
(ISO A.8.14) or fund a standby.

## 3. Manual fallback

Stores and IT keep a dated paper or Excel note of asset hand-overs (asset code, from, to, date, signature) while
CKAM is down, and enter each one with **Move** (date under **More**) once CKAM is back. The note is kept until the
entries are checked.

## 4. Physical and environmental (inherited)

Server room access, power, cooling, fire protection and cabling for 10.0.1.98, 10.0.0.205 and the NAS are
CityKart IT / Facilities controls; IT confirms them once a year with a short checklist (ISO A.7, NOT EVIDENCED today).

## 5. Tests

| Test | When |
|---|---|
| Restore drill (doc 07) | Quarterly |
| Reboot test of 10.0.1.98: `CKAM-Web` returns and NAS uploads still work (open item in `PRODUCTION_INFRASTRUCTURE.md`) | Once now, then after every Windows patch window that reboots |
| Table-top of one scenario in §2 | Yearly |

## 6. Evidence this plan would produce

Approved RTO/RPO; reboot test record; restore records; table-top minutes; signed acceptance of "no standby".

## 7. What this does NOT yet prove

* No RTO/RPO is agreed; no recovery has ever been timed.
* The database scenario cannot be recovered today if 10.0.0.205's disks are lost (backups on the same server).
* The rebuild steps for 10.0.1.98 are not written for Windows; the reboot test is open; physical controls are not
  evidenced.
