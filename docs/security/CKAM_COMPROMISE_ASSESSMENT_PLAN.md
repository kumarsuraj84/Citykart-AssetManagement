# CKAM Compromise Assessment Plan — did anyone use IF-01 before it was closed?

| | |
|---|---|
| Status | **READ-ONLY / NOT EXECUTED. PREPARED — OWNER APPROVAL PENDING.** Nothing in this plan has been run. Every command is text to read and adapt, marked `NOT EXECUTED`. No command here changes anything: they only copy, hash, read and count |
| Date | 2026-10-17 |
| When | **Evidence preservation (§2): runbook step B, BEFORE any change on the servers** (and the top-up at F0). **The review itself (§3–§8): runbook step K, AFTER the fix is deployed and verified (H) and the secrets are rotated (I/J).** It is done on the preserved **copies**, never on the live files |
| Who | SEC (security reviewer; may be the owner) leads. IT (10.0.1.98), DBA (10.0.0.205, the owner types the `postgres` password), NAS-ADMIN (10.0.0.25), Infra (router/firewall) supply their logs. The APPROVER signs the decision |
| Scope | Only CKAM's own systems and CKAM's own records: the CKAM folder and task on 10.0.1.98, the database `ckassetmanagement` and CKAM's roles on 10.0.0.205, the NAS folder `CKASSETMANAGEMENT_DATA`, and the network devices' records of traffic to TCP 3211 on 10.0.1.98. **Never read or change another app's database, files or config** (Spinwheel, Citykart Desk); their owners are told (§10) and review their own systems. **10.0.1.12 (retired) is out of scope and is not touched** |
| Related | `CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md` steps B, F0, K, L · `CKAM_SECRET_ROTATION_CHECKLISTS.md` · `policies/templates/incident_record.md` · `docs/ai/LOGGING_AND_DIAGNOSTICS.md` · EXT-03, EXT-21, EXT-27, EXT-31, EXT-41 |

## 1. In plain words

The live CKAM server had a hole (IF-01): anyone who could reach port 3211 could ask it for any file on the server
and get it, without signing in. That includes `shared\.env` (the database password, the login-signing key, the ERP
password) and `shared\nas.pw` (the NAS password). Because CKAM runs as **SYSTEM**, the hole could also hand out files
of the **other apps on the same server**.

Closing the hole does not tell us whether somebody already used it. This plan looks for traces in the logs. It can
give one of three answers: **no evidence**, **suspicious**, or **compromised**. It can **never** prove "not used",
because CKAM's own access logs only exist since **2026-10-14**.

Example: after you find the back door was open, you check the CCTV. If the camera was only installed on Monday, the
recording can show a burglar after Monday, but it cannot prove that nobody came in before.

### Facts the plan depends on

| Fact | Consequence |
|---|---|
| The IF-01 code shipped on **2026-09-30**. CKAM has run on 10.0.1.98 since the move of **2026-10-07** (before that on the retired 10.0.1.12, out of scope) | The review window on 10.0.1.98 is **from CKAM's first start on 10.0.1.98 (2026-10-07) until the old code stopped (runbook F1)** |
| CKAM's request log (`app.jsonl`, one JSON line per request) and the database `audit_log` exist only since the **2026-10-14** deploy of `3b5e842` | 2026-10-07 → 2026-10-14 has **no CKAM access log at all**. Use outside sources (router, Windows, PostgreSQL, NAS) for that week, and write the gap down |
| The app log files rotate by size (20 MB × 10 per file) | Old lines disappear as new traffic arrives. Preserve them **before** the deploy (§2) |
| A forged login made with a stolen `JWT_SECRET` creates **no `LOGIN` row** | Look for actions **without** a matching sign-in (§4.2) |
| `pg_hba.conf` is documented to allow `ckassetapp` only from `10.0.1.98/32` | A stolen DB password is directly usable only from 10.0.1.98 itself; attempts from elsewhere show up as **rejections** in the PostgreSQL log (if logging is on) |
| The old code could be made to open **SMB connections to a host named in the URL** (UNC paths, handover §5.3) | Look for **outbound** TCP 445/139 from 10.0.1.98 to anything other than the NAS 10.0.0.25 (§7) |
| The access log stores the **decoded** path (`scope["path"]`): `..%2f` appears as `../`, `%5c` as `\` (written `\\` inside JSON), `%252e` as `%2e` | Search for the decoded **and** the encoded forms (§3) |
| The live launcher lacks `--no-proxy-headers` (EXT-38), but uvicorn trusts `X-Forwarded-For` only from `127.0.0.1` | A logged client address can be faked only by a process on 10.0.1.98 itself. Treat the `ip` field as reliable for outside clients |

---

## 2. Evidence preservation (runbook step B, BEFORE any change; top-up at F0)

**Rule: copy first, hash, then read only the copies.** Every source is copied to the admin-only `<EVIDENCE-DIR>` on
its own server and then to `<OFFSERVER-EVIDENCE>` (an encrypted drive or admin-only share that is **not** the CKAM
NAS folder). The logs contain staff names and IP addresses (personal data): keep the copies access-restricted, and
never paste them into chat, tickets or AI tools. Write in the incident record every source that **could not** be
preserved and why (for example "router keeps 24 hours only").

### 2.1 What to copy

| # | Source | Where | Who | Why it matters |
|---|---|---|---|---|
| E1 | CKAM app logs `app.jsonl`, `error.jsonl`, `audit.jsonl` and their rotated copies (`.1` … `.10`) | `LOG_DIR` = `<ROOT>\logs\app` on 10.0.1.98 | IT | Every request since 2026-10-14 (path, status, bytes, client address, signed-in user) |
| E2 | Launcher and uvicorn logs (`ckam-web_*.launcher.log`, `*.out.log`, `*.err.log`), older deploy logs | `<ROOT>\logs\` on 10.0.1.98 | IT | Restarts, NAS mapping, start-up errors, anything before 2026-10-14 |
| E3 | Windows event logs: `Security`, `System`, `Application`, `Microsoft-Windows-TaskScheduler/Operational`, `Microsoft-Windows-PowerShell/Operational`, `Microsoft-Windows-SMBClient/Security` and `/Connectivity`, `Microsoft-Windows-Windows Firewall With Advanced Security/Firewall`, `Microsoft-Windows-TerminalServices-LocalSessionManager/Operational` (if present) | 10.0.1.98 | IT | Logons, new local accounts, group changes, new services or tasks, PowerShell use, outbound SMB, remote-desktop sessions |
| E4 | Task Scheduler definition and history of `CKAM-Web` (XML export + `Get-ScheduledTaskInfo`) | 10.0.1.98 | IT | Unexpected changes to CKAM's task (only CKAM's task) |
| E5 | Windows Firewall log file, if logging is enabled (`%SystemRoot%\System32\LogFiles\Firewall\pfirewall.log`) | 10.0.1.98 | IT | Connections to 3211 and outbound 445 |
| E6 | Database copies of CKAM's own log tables: `audit_log`, `system_event`, `error_log`, `client_report` for the window | `ckassetmanagement` on 10.0.0.205 | DBA (read-only export) or the head-office admin export `/api/admin/logs/export?kind=audit\|system\|errors\|client&format=jsonl` | Who did what; restarts; errors from probe attempts |
| E7 | PostgreSQL server logs (incl. connection and authentication lines, if enabled) and the non-secret logging settings | `log_directory` of the PostgreSQL 18 instance on 10.0.0.205 (often `D:\POSTGRESQL DB\log` or `<data>\log`; confirm) | DBA | Connections by `ckassetapp` and from which address; failed authentications; DDL |
| E8 | A copy of `pg_hba.conf` (contains rules, no passwords) | data directory on 10.0.0.205 | DBA | Proves which hosts may connect as `ckassetapp`; detects a changed rule |
| E9 | Windows event logs of 10.0.0.205 (`Security`, `System`) | 10.0.0.205 | DBA | Logons to the database server |
| E10 | NAS connection / access / audit log export for `ckappuser` and the folder `CKASSETMANAGEMENT_DATA` | NAS 10.0.0.25 (its own admin console) | NAS-ADMIN | Who opened CKAM's documents, from which host |
| E11 | Router / firewall / NAT logs for the public forward of TCP 3211 → 10.0.1.98:3211, and for outbound TCP 445/139 from 10.0.1.98 | the internet router / firewall | Infra | Who reached 3211 from the internet, how often; outbound SMB |
| E12 | Any reverse-proxy, load-balancer or IDS logs in front of 10.0.1.98 (none is documented; confirm) | wherever they run | Infra | Same as E11 |
| E13 | ERP warehouse login log for the CKAM role (`PO_SOURCE_USER`), if the ERP owner keeps one | 10.0.1.69 (ERP-OWNER only) | ERP-OWNER | Use of the ERP password from hosts other than 10.0.1.98 |

### 2.2 Commands (examples; READ-ONLY / NOT EXECUTED)

E1, E2, E3 and E4 on 10.0.1.98 are in the runbook, step B (robocopy of `logs\` with a SHA-256 list, `wevtutil epl`
of the event logs, the `CKAM-Web` task export). The extra event logs of E3 (`NOT EXECUTED`):

```powershell
# READ-ONLY / NOT EXECUTED — 10.0.1.98, elevated; $ev = '<EVIDENCE-DIR>'
foreach ($log in 'Microsoft-Windows-PowerShell/Operational',
                 'Microsoft-Windows-SMBClient/Security',
                 'Microsoft-Windows-SMBClient/Connectivity',
                 'Microsoft-Windows-Windows Firewall With Advanced Security/Firewall',
                 'Microsoft-Windows-TerminalServices-LocalSessionManager/Operational') {
  $name = ($log -replace '[/ ]','_')
  wevtutil epl $log "$ev\eventlog_$name.evtx" 2>$null
  "wevtutil $log exit code: $LASTEXITCODE  (non-zero = log not present or not enabled; write it down)"
}
if (Test-Path "$env:SystemRoot\System32\LogFiles\Firewall\pfirewall.log") {
  Copy-Item "$env:SystemRoot\System32\LogFiles\Firewall\pfirewall.log*" "$ev\" }
Get-ChildItem $ev -File -Recurse | Get-FileHash -Algorithm SHA256 | Export-Csv "$ev\evidence.sha256.csv" -NoTypeInformation
```

E7 and E8 on 10.0.0.205 (DBA; `NOT EXECUTED`). Find the log folder first, read-only:

```
-- READ-ONLY / NOT EXECUTED — psql as postgres on 10.0.0.205 (password typed at the prompt)
SET default_transaction_read_only = on;
SHOW data_directory;  SHOW log_directory;  SHOW log_filename;  SHOW logging_collector;
SHOW log_connections; SHOW log_disconnections; SHOW log_statement; SHOW log_line_prefix;
SHOW log_rotation_age; SHOW log_rotation_size; SHOW hba_file;
```

```powershell
# READ-ONLY / NOT EXECUTED — 10.0.0.205; $pglog = the folder from log_directory (absolute, or relative to data_directory)
$ev = '<EVIDENCE-DIR-DB>'
New-Item -ItemType Directory -Force $ev | Out-Null
robocopy '<PG-LOG-DIR>' "$ev\pglog" /E /COPY:DAT /R:1 /W:1 /NP /LOG:"$ev\robocopy-pglog.txt"
Copy-Item '<HBA-FILE>' "$ev\pg_hba.conf.copy"
wevtutil epl Security "$ev\eventlog_Security_db.evtx"; wevtutil epl System "$ev\eventlog_System_db.evtx"
Get-ChildItem $ev -File -Recurse | Get-FileHash -Algorithm SHA256 | Export-Csv "$ev\evidence_db.sha256.csv" -NoTypeInformation
```

The PostgreSQL log folder holds the log of **every** database on that server (it is shared). Copy it whole for
integrity, but in §5 read only lines about `ckassetmanagement` and CKAM's roles. If other apps' lines must be
looked at, their owners decide (§10).

E6, CKAM's own log tables (DBA, read-only `\copy` to a CSV on the DB server; `NOT EXECUTED`):

```
-- READ-ONLY / NOT EXECUTED — psql connected to ckassetmanagement
SET default_transaction_read_only = on;
\copy (SELECT * FROM audit_log    WHERE at >= '2026-10-07' ORDER BY id) TO '<EVIDENCE-DIR-DB>\audit_log.csv'    CSV HEADER
\copy (SELECT * FROM system_event WHERE at >= '2026-10-07' ORDER BY id) TO '<EVIDENCE-DIR-DB>\system_event.csv' CSV HEADER
\copy (SELECT * FROM error_log    WHERE at >= '2026-10-07' ORDER BY id) TO '<EVIDENCE-DIR-DB>\error_log.csv'    CSV HEADER
```

E10 (NAS), E11/E12 (router, firewall, proxy) and E13 (ERP): the device's own export function, by its admin. Ask
for the period **2026-10-07 until the deploy**, and for the export file's SHA-256 at the time it is made. Never ask
for, or send, a password with the request.

**Verification:** every copied file is in a hash list; the hash list is re-checked at `<OFFSERVER-EVIDENCE>`; the
incident record lists each source as "preserved (file, SHA-256)" or "not available (why)".

---

## 3. CKAM access-log searches (step K, on the COPIES)

Work on the preserved copy, e.g. `<OFFSERVER-EVIDENCE>\logs-before-deploy\app\` plus the rotated files `app.jsonl.1`
… `app.jsonl.10`. Each line of `app.jsonl` is one request as JSON (time, method, path, status, bytes, client address,
signed-in user, request id). The goal of this section is to find requests for the **static-file address** `/assets/…`
that look like somebody was asking for something that is not a normal website file.

### 3.1 What a normal request looks like, and what is unusual

A normal request is `GET /assets/index-<hash>.js` or `.css` or a font file, answered 200, a few hundred KB at most.
Unusual and worth a closer look:

| Signal | Why it is unusual |
|---|---|
| Any `/assets/…` path that contains a double dot, a backslash, a colon, or a percent sign (`%2e`, `%2f`, `%5c`, `%252e`) | Normal file names never contain these |
| Any `/assets/…` path whose last part is not a hashed `.js`, `.css`, `.woff2`, `.png`, `.svg` file name | Normal pages only ask for the hashed files |
| An `/assets/…` answer with status 200 and a file size that is not one of the known bundle sizes | The old code served what it was asked for; a 200 with an odd size means a file left the folder |
| Very long `/assets/…` paths, or the same client asking for many different `/assets/…` names within a minute | Looks like somebody trying names in a row |
| Names such as `.env`, `nas.pw`, `win.ini`, `web.config`, `passwd` anywhere in a path | Names of files that hold settings or secrets |
| A client address that is not an office address and not a known staff address, with many requests | Possible outside visitor |

### 3.2 Read-only search examples (`NOT EXECUTED`)

```powershell
# READ-ONLY / NOT EXECUTED — run on the COPY of app.jsonl*, in a PowerShell window; nothing is changed
$logs = Get-ChildItem '<OFFSERVER-EVIDENCE>\logs-before-deploy\app' -Filter 'app.jsonl*'
# 1. every /assets request that is not a plain hashed file name (candidates for review)
$logs | Select-String -Pattern '"path":"/assets/[^"]*(\.\.|\\\\|:|%)' | Select-Object Path,LineNumber,Line | Export-Csv "$env:TEMP\assets-odd-paths.csv" -NoTypeInformation
# 2. requests naming files that hold settings or secrets
$logs | Select-String -Pattern '\.env|nas\.pw|win\.ini|web\.config' | Select-Object Path,LineNumber,Line | Export-Csv "$env:TEMP\assets-sensitive-names.csv" -NoTypeInformation
# 3. count of /assets requests per client address (look for one address with a high count of unusual names)
$logs | ForEach-Object { Get-Content $_.FullName } | Where-Object { $_ -match '"path":"/assets/' } |
  ForEach-Object { ($_ | ConvertFrom-Json).ip } | Group-Object | Sort-Object Count -Descending | Select-Object -First 20 Name,Count
```

If `jq` is installed the same search can be written as: select lines where `.path` starts with `/assets/` and the
name is not a hashed file (`select(.path|startswith("/assets/")) | select(.path|test("[.][.]|[\\\\:%]"))`).

**Reading the result.** A line with status 404 for an odd path means somebody asked and **got nothing** (the new
code answers 404; the old code answered 404 only when the file did not exist). A line with status **200** for an odd
path is the important one: note the time, address and size, keep it as evidence, and go to §8 (decision rules).
`GET /assets/<number>` (an asset page opened from a QR label) is **normal** and was answered 404 by the old code
(CL2-IF-04), so many 404s on `/assets/<number>` are not suspicious by themselves.

---

## 4. CKAM's own records: what was done inside the application (step K, on the COPIES or read-only on a copy database)

If the login-signing key (`JWT_SECRET`) was read, a stranger could have made a valid admin token for any account
**without a password**, and such a sign-in writes **no `LOGIN` row**. So the useful question is: **are there
actions by someone who never signed in?** The records are the `audit_log` table (who, what, when, from which
address, outcome) and the access lines in `app.jsonl`. All queries below only read (`NOT EXECUTED`; run them on a
copy of the exported tables or with `SET default_transaction_read_only = on`).

### 4.1 Sign-in history and unknown people

```sql
-- READ-ONLY / NOT EXECUTED — columns of audit_log: at, request_id, actor_id, actor_code, actor_role, ip, category, action, entity, summary, outcome
SET default_transaction_read_only = on;
-- (a) every account that appears as an actor, with its first/last action and number of distinct addresses
SELECT actor_id, actor_code, actor_role, min(at) AS first_seen, max(at) AS last_seen, count(*) AS actions, count(DISTINCT ip) AS addresses
FROM audit_log WHERE at >= '2026-10-14' GROUP BY 1,2,3 ORDER BY last_seen DESC;
-- (b) accounts that did things but have NO sign-in row in the same period (a forged token leaves no LOGIN row)
SELECT a.actor_id, a.actor_code, count(*) AS actions_without_login_row
FROM audit_log a
WHERE a.at >= '2026-10-14' AND a.actor_id IS NOT NULL AND a.action NOT IN ('LOGIN','LOGIN_FAILED','LOCKED')
  AND NOT EXISTS (SELECT 1 FROM audit_log l WHERE l.actor_id = a.actor_id AND l.action = 'LOGIN' AND l.at <= a.at)
GROUP BY 1,2 ORDER BY 3 DESC;
-- (c) addresses used for sign-in, and addresses that appear only once or outside the office range
SELECT ip, count(*) AS n, min(at) AS first_seen, max(at) AS last_seen FROM audit_log WHERE action = 'LOGIN' GROUP BY ip ORDER BY first_seen;
```

Note: a refresh of a running session (renewing a token) is not a `LOGIN` row either, so a long-running real session
can show up in (b); compare the address and the time with the real person. The head-office admin (Primary Owner)
has no company and no code; look at it separately.

### 4.2 Changes that an attacker with admin rights would make

```sql
-- READ-ONLY / NOT EXECUTED
-- people/logins created, roles or access changed, passwords reset or issued, logins switched on or off
SELECT at, actor_code, ip, action, entity, entity_id, summary FROM audit_log
WHERE at >= '2026-10-07' AND (entity IN ('asset_user','user','people') OR action ILIKE '%PASSWORD%' OR action ILIKE '%ROLE%' OR action ILIKE '%ACCESS%' OR summary ILIKE '%login%')
ORDER BY at;
-- exports and reports downloaded, imports run
SELECT at, actor_code, ip, action, summary FROM audit_log WHERE at >= '2026-10-14' AND (action ILIKE '%EXPORT%' OR action ILIKE '%IMPORT%' OR summary ILIKE '%export%') ORDER BY at;
-- administrative actions at unusual hours (before 06:00 or after 22:00 local time) or on days the office was closed
SELECT at, actor_code, ip, action, summary FROM audit_log
WHERE at >= '2026-10-14' AND (extract(hour FROM at AT TIME ZONE 'Asia/Kolkata') < 6 OR extract(hour FROM at AT TIME ZONE 'Asia/Kolkata') >= 22) ORDER BY at;
-- bursts of failed sign-ins and locks
SELECT date_trunc('hour', at) AS hour, ip, count(*) FROM audit_log WHERE action IN ('LOGIN_FAILED','LOCKED') GROUP BY 1,2 HAVING count(*) >= 5 ORDER BY 1;
-- application restarts and start-up events (a restart you did not make is a question)
SELECT at, level, component, event, message FROM system_event WHERE at >= '2026-10-07' AND event IN ('app_started','app_stopped') ORDER BY at;
```

The action names above are the common ones; check the real names with
`SELECT DISTINCT category, action FROM audit_log ORDER BY 1,2;` first and adjust the filters (this is a **read-only**
query). Asset movements and receipts by someone with no business reason (an asset moved to an unknown person, many
assets sold or scrapped) are also in `audit_log` and in the asset history; ask the business owners to review the
Reports → History view for the period.

---

## 5. Database server records (10.0.0.205, DBA reads the COPIES from §2; only lines about CKAM)

The database password could have been read from `shared\.env`. `pg_hba.conf` is documented to allow the CKAM role
only from 10.0.1.98, so a password used from another machine would show up as a **refused** connection, if
connection logging is on. What to look for in the copied PostgreSQL log (only lines that name the database
`ckassetmanagement` or CKAM's role; **do not read other apps' lines**):

| Check | Read-only example (`NOT EXECUTED`) | Meaning |
|---|---|---|
| Connection attempts by CKAM's role from an unexpected address | `Select-String -Path "<EVIDENCE-DIR-DB>\pglog\*" -Pattern 'ckassetapp' \| Select-String -NotMatch '10\.0\.1\.98'` | Any address other than the app server is a question |
| Authentication failures for the CKAM role | `Select-String -Path "<EVIDENCE-DIR-DB>\pglog\*" -Pattern 'password authentication failed.*ckassetapp\|no pg_hba.conf entry.*ckassetapp'` | Somebody tried the password from a host that is not allowed |
| Changes to the database structure or roles | `Select-String -Path "<EVIDENCE-DIR-DB>\pglog\*" -Pattern 'ALTER ROLE\|CREATE ROLE\|DROP \|TRUNCATE\|ALTER TABLE'` (only if `log_statement` was at least `ddl`) | Unexpected structure changes |
| Unusually large reads by the CKAM role | slow-statement lines (`duration:`) for `ckassetmanagement` outside normal hours | Possible bulk copy of data |
| Changed access rules | compare the copied `pg_hba.conf` with the documented rule set | A new line that allows another host |

Live, read-only on the database server (DBA, `NOT EXECUTED`): `SELECT usename, client_addr, application_name, state, backend_start FROM pg_stat_activity WHERE datname = 'ckassetmanagement';`
and `SELECT rolname, rolcreatedb, rolcreaterole, rolsuper, rolvaliduntil FROM pg_roles WHERE rolname LIKE 'ck%';`
(a role that should not exist, or one with extra rights, is a finding). If `log_connections` and `log_statement` were
off, write "PostgreSQL gave no evidence either way" in the incident record.

---

## 6. NAS records (10.0.0.25, NAS-ADMIN exports from its own console)

The NAS password could have been read from `shared\nas.pw`. Ask the NAS administrator for the access / connection /
audit log of the account CKAM uses and of the folder `CKASSETMANAGEMENT_DATA` for 2026-10-07 until the deploy:
connections from any address other than 10.0.1.98 and the NAS administrators' own machines; reads or copies of many
files in a short time; new, deleted or renamed files outside the normal upload pattern (documents are written by the
application only). **First answer the open question:** is that NAS account used only by CKAM? (`OWNER / INFRA
CONFIRMATION REQUIRED`, EXT-43.) If it is shared with other apps, the NAS log also contains their normal use; the
reviewer separates the traffic by source address and folder, and the other apps' owners are told (§10).

---

## 7. Server and network records (10.0.1.98, router, firewall)

| Source | What to look for | Read-only example (`NOT EXECUTED`) |
|---|---|---|
| Windows `Security` log | New local accounts, group changes, logons from unexpected hosts, remote-desktop logons, service installs (event ids 4720, 4722, 4728, 4732, 4624 type 10, 4697) | `Get-WinEvent -Path '<EVIDENCE-DIR>\eventlog_Security.evtx' -FilterXPath '*[System[(EventID=4720 or EventID=4732 or EventID=4697)]]'` |
| `Task Scheduler` and `System` logs | CKAM's task changed, a new task or service created, unexpected reboots | `Get-WinEvent -Path '<EVIDENCE-DIR>\eventlog_TaskScheduler.evtx' \| Where-Object { $_.Message -match 'CKAM' }` |
| `SMBClient` / firewall logs | Outbound connections on TCP 445/139 from 10.0.1.98 to anything other than the NAS 10.0.0.25 (the old file-serving code could be pointed at another host) | read the exported firewall log and filter `DST-PORT 445` where the destination is not 10.0.0.25 |
| Router / firewall / NAT | Who reached the public forward of TCP 3211 and how much traffic; spikes; unfamiliar countries or hosting providers | the device's own export, summarised by source address and by day |
| `PowerShell/Operational` | Commands run on the server that nobody can account for | read the exported log with the people who administer the server |

Any one finding here does not prove misuse, but an **unexplained** new account, task, service, or outbound SMB
connection is a strong signal: go to §8.

---

## 8. Decision rules

| Result | Condition | What to do |
|---|---|---|
| **NO EVIDENCE OF USE** | Every source was reviewed, no odd `/assets` request answered 200, no action without a sign-in, no unexpected database/NAS/network connection, **and** the incident record states which sources were not available | Close the check **but still keep the rotation (it is already done) and write "cannot be ruled out for 2026-10-07 → 2026-10-14 (no CKAM access log)"** |
| **SUSPICIOUS** | One or more odd requests, an action without a sign-in, a new admin or role change nobody can explain, odd-hour admin use, a login burst from one address, a refused database connection from another host | Keep the evidence, widen the review (the whole period, the other sources), ask the people concerned, review every account with admin rights, force a password reset for the affected accounts (Issue login passwords), tell management, and decide with the owner whether the incident is declared |
| **COMPROMISED** | An odd request answered 200 for a settings/secrets file, or activity that clearly used a forged or stolen credential, or an unexplained new account/task/service | Treat **all** CKAM secrets as exposed (rotation done in step I must be verified to have happened **after** the fix), keep the internet forward closed, declare the incident, notify management, the Spinwheel and Citykart Desk owners, and legal / regulator contacts as management decides; review business data (assets, history, exports) for tampering; consider restoring from the pre-deploy backup only as an owner decision |

---

## 9. Missing or incomplete logs

CKAM's request log and `audit_log` start on 2026-10-14. For 2026-10-07 → 2026-10-14 there is **no CKAM log**: write
"no evidence available, use of the hole cannot be ruled out" and rely on the secrets rotation. Router, firewall and
Windows logs may cover that week if they are kept; ask for them. If a log source was rotated away before it was
preserved, record it in the incident record and do not guess. **Missing logs are never treated as "nothing happened".**

---

## 10. Telling the owners of the other apps

CKAM runs as the SYSTEM account on a **shared** server (10.0.1.98), so the file-read hole could in principle have
handed out files of the other apps there (Spinwheel, Citykart Desk). That is inferred from how the hole worked, not
tested. The CKAM owner should tell those app owners in plain words, with the dates, so that they can review their
own logs and decide whether to rotate their own secrets. **CKAM staff do not read or change those apps' files,
databases or configuration.** The same applies to the shared database server 10.0.0.205 and the NAS.

---

## 11. Incident record fields (use `docs/security/policies/templates/incident_record.md`)

Date and time found; who found it; systems in scope; the review window; every source with `preserved (file, SHA-256)`
or `not available (why)`; the queries run and their results (counts, not raw personal data); each finding with time,
address, account, request id; the decision (no evidence / suspicious / compromised) and who approved it; the
people and the other-app owners told, with dates; the rotation evidence (dates of each secret change **after** the
fix was verified); follow-ups (HTTPS, service account, backups, log shipping); the date of the next review.