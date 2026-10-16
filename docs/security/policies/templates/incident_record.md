# Incident Record (CKAM) — blank form

> DRAFT — MANAGEMENT APPROVAL REQUIRED (form for doc 05). Copy, fill, keep the filled copy outside the repository.
> Never write a password, secret or key here (say "JWT secret rotated", never the value).

## A. Identification

| | |
|---|---|
| Incident id | INC-YYYY-NNN |
| Title (one line) | |
| Reported by / how (Report a problem, error Reference, Logs review, IT, outside) | |
| CKAM references / request ids | |
| Date and time noticed | |
| Date and time logged | |
| Incident Lead | |
| Severity (SEV1-SEV4) and why | |

## B. Timeline

| Date / time | What happened or was done | By |
|---|---|---|
| | | |

## C. Containment

| Step | Done? (Y/N, time) | By | Note |
|---|---|---|---|
| Router forward of 3211 closed | | | |
| `CKAM-Web` task stopped (only CKAM's) | | | |
| Login(s) switched off (which) | | | |
| `JWT_SECRET` changed (all sessions ended) | | | |
| Other | | | |

## D. Evidence preserved (store copies off the server)

| Item | Command / screen | File name | SHA-256 | Stored where | By |
|---|---|---|---|---|---|
| Request details | Logs › by request (`/api/admin/logs/request/<id>`) | | | | |
| Diagnostics bundle | Diagnostics › Copy bundle (`/api/admin/diagnostics/bundle?hours=…&request_id=…`) | | | | |
| Audit export | `/api/admin/logs/export?kind=audit&from=…&to=…&format=jsonl` | | | | |
| System / errors / client exports | `kind=system`, `kind=errors`, `kind=client` | | | | |
| App log files | `logs\app\app.jsonl`, `error.jsonl`, `audit.jsonl` (+ rotated) | | | | |
| Launcher logs | `logs\` | | | | |
| Router / firewall / PostgreSQL / NAS logs | IT | | | | |

## E. Analysis

| | |
|---|---|
| What was affected (data, accounts, companies, servers) | |
| Personal data involved? (Y/N, what) | |
| Cause (root cause) | |
| Was the weakness used? Evidence for / against | |

## F. Eradication and recovery

| | |
|---|---|
| Fix (change record id, doc 04) | CHG-… |
| Secrets rotated (names only: JWT, `ckassetapp`, NAS `ckappuser`, ERP `ckpost`, other) | |
| Data restored? (dump name, restore record id) | |
| Service back (date / time); smoke checks passed | |

## G. Notifications

| To | Required? | When sent | By | Reference |
|---|---|---|---|---|
| Management | | | | |
| Users | | | | |
| CERT-In (window confirmed by Legal) | | | | |
| Data Protection Board / affected persons (DPDP Act, per Legal) | | | | |
| ERP warehouse owner / other teams | | | | |

## H. Post-incident review (within 10 working days)

| | |
|---|---|
| Date held, attendees | |
| What worked | |
| What did not | |
| Actions (owner, due date) | |
| New / updated findings and risks (ids) | |
| Closed by (Incident Lead) and date | |
