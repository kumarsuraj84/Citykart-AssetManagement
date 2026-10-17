# ops/precheck — read-only checks to run on the production servers BEFORE the security deployment

These three scripts only READ. They change nothing on the server except one report file (or, for the evidence
script, a new evidence folder). They print no password. They are NOT part of the release package.

| Script | Run on | What it does |
|---|---|---|
| `precheck_app_server.ps1` | app server **10.0.1.98** (elevated PowerShell) | release folders, task `CKAM-Web`, launcher flags, running process flags, `shared\.env` readiness (ENVIRONMENT_NAME, JWT_SECRET strength, DATABASE_URL present — without showing any secret), file permissions, antivirus services, disk, logs, network reachability |
| `precheck_db_server.ps1` | DB server **10.0.0.205** (elevated PowerShell) | Alembic revision, database size and row counts, CKAM roles and table owners, logging settings, `pg_hba` rules, current connections, backup task and newest backup files, disk, antivirus services. Asks ONCE for the `postgres` password (hidden); queries run in a read-only session |
| `preserve_evidence_app_server.ps1` | app server **10.0.1.98** (elevated PowerShell) | COPIES CKAM's logs, the task definition and Windows event logs to an evidence folder with a SHA-256 list (runbook step B). Never copies `shared\.env` or `nas.pw` |

## How to run (on the server)

1. Copy the script to the server (for example `D:\CKAM_PRECHECK\`), open **Windows PowerShell as administrator**.
2. Syntax check first (reads only):
   `[void][System.Management.Automation.Language.Parser]::ParseFile('D:\CKAM_PRECHECK\precheck_app_server.ps1',[ref]$null,[ref]($e=$null)); $e`
   (no output = no errors).
3. If scripts are blocked: `powershell -ExecutionPolicy Bypass -File D:\CKAM_PRECHECK\precheck_app_server.ps1`
4. Send back the `ckam_precheck_*.txt` report. It contains no secret, but it contains server names and folder paths:
   share it only with the people running the deployment.

Not tested on a real server (written and reviewed on the dev PC; the dev PC's own PowerShell was removed by its
antivirus on 2026-10-17, so a parse check could not be run here). If the antivirus on the server interrupts a script,
stop and tell the release engineer (go/no-go Q18).
