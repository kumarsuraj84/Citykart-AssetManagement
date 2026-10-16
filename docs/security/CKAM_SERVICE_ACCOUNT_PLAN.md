# CKAM Service Account Plan (move CKAM-Web off SYSTEM) — EXT-06

| | |
|---|---|
| Date | 2026-10-16 (prepared during the security closure programme, WP-D1) |
| Status | **PREPARED, NOT DONE.** No account has been created, no task changed, no permission altered. All commands below are text for the owner/Infra to run on 10.0.1.98. **PRODUCTION REMAINS NOT REMEDIATED** for IF-07 until this is done and verified on the server |
| Closes | IF-07 (CKAM-Web runs as SYSTEM on a shared server), supports R-06/R-07 and the shared-server segregation goal (EXT-24) |
| Server | App server **10.0.1.98**, `D:\Citykart_Applications\Citykart_AssetManagement_App` (`<ROOT>`), shared with Spinwheel and Citykart Desk. Scheduled task `CKAM-Web` runs one uvicorn process on port 3211 |
| Sources | `docs/ai/PRODUCTION_INFRASTRUCTURE.md` (layout, launcher, NAS, backups), `CKAM_EXTERNAL_SECURITY_ACTIONS.md` EXT-06, `CKAM_SECURITY_CLOSURE_REGISTER.md` IF-07 row |

## In plain words

Today CKAM runs as **SYSTEM**, the highest account on a Windows server — and that server also runs Spinwheel and
Citykart Desk. If any bug in CKAM were exploited, the attacker would have full control of the whole server and all
three apps. The fix is to run CKAM as a **dedicated low-privilege account** that can touch **only** CKAM's own
files, logs, secrets and the CKAM NAS folder, and nothing of the other apps. Then a CKAM bug stays a CKAM problem.

Simple example: instead of giving the new cleaner a master key to the whole building, you give them a key to one
room. If that key is lost, only that one room is at risk.

---

## 1. Which kind of account

| Option | Pros | Cons | Fit |
|---|---|---|---|
| **Local standard user** on 10.0.1.98 (e.g. `svc_ckam`) | Simple; no domain dependency; the box already runs apps as local identities | A password exists that must be stored safely (password manager, EXT-23) and rotated; does not reach domain resources by itself | **Recommended if 10.0.1.98 is not domain-joined, or if the NAS accepts a local account's mapped-drive credential (it uses its own `ckappuser`, so it does)** |
| **Domain gMSA** (group Managed Service Account) | No password to store or rotate (AD manages it); strong for scheduled tasks | Needs the server domain-joined and the AD team to create it and grant "retrieve managed password" to the host; slightly more setup | **Recommended if the server is domain-joined and the AD team can create a gMSA** — it removes the stored-password risk entirely |

**Recommendation:** a **gMSA** if 10.0.1.98 is domain-joined and AD support is available (no password to leak);
otherwise a **local standard user** `svc_ckam`. Either way the account is **not an administrator**, **cannot log on
interactively**, and is used only to run the `CKAM-Web` task. The NAS is reached with the separate `ckappuser`
credential the launcher maps at run time (not this account's identity), so the service account does not itself need
NAS rights — see section 4.

The rest of this plan shows the **local-user** commands; for a gMSA, skip the password steps and grant the host the
right to retrieve the managed password instead (AD team), then set the task to run as `DOMAIN\gmsa_ckam$`.

---

## 2. Rights the account needs — and only these

| Resource | Right | Why |
|---|---|---|
| `<ROOT>\releases\` (all release folders) | **Read & execute** | run the packaged backend and serve `frontend-dist` |
| `<ROOT>\shared\venv\` | **Read & execute** | the Python interpreter and packages |
| `<ROOT>\shared\.env` | **Read** | the launcher loads settings (DB URL, JWT secret, paths) |
| `<ROOT>\shared\nas.pw` | **Read** | the launcher reads the NAS password to map the drive |
| `<ROOT>\shared\run_ckam_web.ps1` | **Read & execute** | the launcher script |
| `<ROOT>\logs\` (and `logs\app\`) | **Modify** (read/write/create) | write `app.jsonl` / `error.jsonl` / `audit.jsonl` and rotate them |
| `<ROOT>\backup\` (if the task writes there) | **Modify** only if used by CKAM | per local layout; otherwise none |
| Network: TCP to **10.0.0.205:5432** | allow (outbound) | the PostgreSQL database |
| Network: SMB to **\\\\10.0.0.25\\ckapplications_data\\CKASSETMANAGEMENT_DATA** | reach the share; the mapping authenticates as `ckappuser`, not as the service account | document uploads/downloads |
| Network: TCP to **10.1.0.69:5432 / 10.1.0.69** ERP (actually 10.0.1.69) | allow (outbound) | the ERP read copy |
| Inbound: listen on **127.0.0.1:3211** (or :3211) | allow | serve the app (a standard user may bind a high port on loopback without admin) |
| **"Log on as a batch job"** user right | grant | Task Scheduler needs it to run the task as this account non-interactively |

**Explicitly NO access to:**

- Spinwheel's and Citykart Desk's application folders under `D:\Citykart_Applications\` (anything that is not
  CKAM's own `Citykart_AssetManagement_App`).
- Those apps' databases on 10.0.0.205 (the account has no login there except CKAM's own DB role; it connects with
  the `DATABASE_URL` in `shared\.env`, which is CKAM's role only).
- Those apps' config, logs, NAS folders or secret files.
- **"Log on locally" / "Log on through Remote Desktop"** — deny; it is a service identity, not a person.
- Administrators group — never a member.

---

## 3. Create the account and grant the rights (TEXT — not run)

Run as Administrator on 10.0.1.98. For a gMSA, skip steps 1-2 and use the AD-provided account name.

```powershell
# 1. Create a local standard user (owner types the password; store it in the password manager, EXT-23).
$pw = Read-Host -AsSecureString "New svc_ckam password"      # typed on the server, never in a file
New-LocalUser -Name 'svc_ckam' -Password $pw -FullName 'CKAM service account' -Description 'Runs CKAM-Web only' -PasswordNeverExpires:$false -UserMayNotChangePassword:$true
# Do NOT add it to any group (it stays a plain Users member with no admin rights).

$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'

# 2. File rights (icacls). (OI)(CI) = applies to files and subfolders. RX = read+execute, M = modify.
icacls "$root\releases"            /grant:r 'svc_ckam:(OI)(CI)RX'
icacls "$root\shared\venv"         /grant:r 'svc_ckam:(OI)(CI)RX'
icacls "$root\shared\run_ckam_web.ps1" /grant:r 'svc_ckam:RX'
icacls "$root\shared\.env"         /grant:r 'svc_ckam:R'
icacls "$root\shared\nas.pw"       /grant:r 'svc_ckam:R'
icacls "$root\logs"                /grant:r 'svc_ckam:(OI)(CI)M'

# 3. Tighten the secret files: remove broad read (Everyone / Authenticated Users / Users) so only
#    Administrators, SYSTEM (if still needed) and svc_ckam can read them. Check current ACL first:
icacls "$root\shared\.env"
icacls "$root\shared\nas.pw"
#    Then, only after confirming svc_ckam:R is present, remove the broad entries, e.g.:
icacls "$root\shared\.env"   /remove:g 'Authenticated Users' 'Users' 'Everyone'
icacls "$root\shared\nas.pw" /remove:g 'Authenticated Users' 'Users' 'Everyone'

# 4. "Log on as a batch job" right for svc_ckam (needed to run the scheduled task as this account).
#    Use the local security policy. One way with secedit (export, edit SeBatchLogonRight, import):
secedit /export /cfg "$env:TEMP\secpol.cfg"
#    -> add svc_ckam's SID to the SeBatchLogonRight line, remove it from any "Deny log on ..." lines,
#       then: secedit /configure /db "$env:TEMP\secpol.sdb" /cfg "$env:TEMP\secpol.cfg" /areas USER_RIGHTS
#    (Or grant it via a Group Policy if the box is managed.)
```

Do not remove SYSTEM's own access in a way that breaks Windows itself; only narrow CKAM's own secret files.

---

## 4. NAS access

The launcher maps `\\10.0.0.25\ckapplications_data\CKASSETMANAGEMENT_DATA` using **`ckappuser`** and the password in
`shared\nas.pw` at run time (`net use` with explicit credentials, or `cmdkey` for `\\10.0.0.25`). So:

- The service account needs **network reach** to the NAS and permission to use a mapped drive, but **not** its own
  NAS rights — the SMB session authenticates as `ckappuser`.
- `cmdkey`-stored credentials are **per Windows profile**. If the task previously ran as SYSTEM and the NAS
  credential was stored in SYSTEM's profile, it must be **re-stored under `svc_ckam`'s profile** (or the launcher
  must map with explicit credentials from `nas.pw`, which the reference launcher in `ops/windows/` does). Confirm
  which approach the live launcher uses during the change; prefer explicit-credential mapping so there is no
  per-profile `cmdkey` dependency.
- `ckappuser`'s rights on the NAS folder must allow **modify** (upload/download/delete through the app). That is a
  NAS-side setting, unchanged by this plan.

---

## 5. Change the scheduled task to run as the account (TEXT — not run)

```powershell
# Inspect first (read-only):
Get-ScheduledTask -TaskName 'CKAM-Web' | Select-Object -ExpandProperty Principal

# Re-point the task's principal to svc_ckam, running whether or not the user is logged on,
# with the "batch logon" (S4U/password) type. Keep the existing triggers (AtStartup), action and
# restart settings. Owner types the password.
$pw = Read-Host "svc_ckam password"          # typed on the server
$p  = New-ScheduledTaskPrincipal -UserId 'svc_ckam' -LogonType Password -RunLevel Limited
Set-ScheduledTask -TaskName 'CKAM-Web' -Principal $p -User 'svc_ckam' -Password $pw
# RunLevel Limited = not elevated. For a gMSA: -LogonType Password is replaced by the gMSA logon
# (no password), e.g. Set-ScheduledTask ... -User 'DOMAIN\gmsa_ckam$'.
```

Keep the task's other settings as they are (restart every minute up to 999 times, no time limit, AtStartup).

---

## 6. Firewall (only CKAM's own rules)

- The existing inbound rule `CKAM-Web` (TCP 3211) is unchanged by the account switch. When HTTPS lands
  (`CKAM_HTTPS_IMPLEMENTATION_PLAN.md`), uvicorn moves to loopback and the 3211 rule is removed then — not here.
- Outbound from 10.0.1.98 to 10.0.0.205:5432, 10.0.1.69:5432 and the NAS must remain allowed (they already are).
- Do not touch Spinwheel's or Citykart Desk's firewall rules.

---

## 7. Test plan (owner/IT, after the change)

1. `Get-ScheduledTask -TaskName 'CKAM-Web' | Select Principal` shows `svc_ckam` (or the gMSA), RunLevel Limited.
2. Start the task; the launcher log shows `serving release: <sha>` and the NAS mapping line succeeded.
3. `GET /api/health` -> ok; sign in; the dashboard loads.
4. **Uploads/downloads work** (the NAS credential resolved under the new identity): upload a small test document
   and download it; delete it through the app afterwards.
5. **Logs are written**: a new access line appears in `logs\app\app.jsonl` after a request (proves `Modify` on
   `logs\`).
6. `GET /api/admin/diagnostics/health`: database connected, recent ERP copy, log dir writable.
7. **Least-privilege spot checks:** confirm `svc_ckam` is **not** in Administrators
   (`Get-LocalGroupMember Administrators`), cannot read a Spinwheel/Citykart Desk secret file
   (`icacls` shows no grant; an attempt as that user is denied), and `icacls "$root\shared\.env"` no longer lists
   `Users`/`Authenticated Users`/`Everyone`.
8. **Reboot test (ties to EXT-29):** restart 10.0.1.98; confirm `CKAM-Web` comes back as `svc_ckam`, the NAS maps,
   and uploads work. (Coordinate the reboot — the box is shared.)

Keep the `icacls` outputs and the task principal as evidence.

---

## 8. Rollback

- The task can be re-pointed to SYSTEM in one command
  (`Set-ScheduledTask -TaskName 'CKAM-Web' -Principal (New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest)`)
  and restarted. Keep the original principal export from section 5 step 1.
- The `icacls /grant` additions are additive and harmless; the `icacls /remove` of broad read can be re-granted if
  something else legitimately needed it (investigate why before re-granting — broad read on secrets is the problem
  being fixed).
- If uploads fail after the switch, it is almost always the NAS credential not being available under the new
  profile (section 4): fix the mapping (explicit credentials from `nas.pw`) rather than rolling back.

---

## 9. Sequencing relative to secret rotation and the DB role split

- **After the urgent IF-01 deploy and secret rotation** (`CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md`). Doing this
  during the same high-pressure window adds risk (NAS mapping and file rights must be right first time). EXT-06 is a
  **30-day** item, not URGENT; schedule it in its own window.
- **Independent of, but complementary to, the database role split (EXT-07).** EXT-07 changes *which database role*
  the app connects as (`ckam_app`); this plan changes *which Windows account* runs the process. They can be done in
  either order. If both are planned for one window, do the DB role split first (it only changes `DATABASE_URL` in
  `shared\.env`, which `svc_ckam` reads), then the account switch, so the final test exercises both.
- **Before or with EXT-23** (password manager): store `svc_ckam`'s password in the vault when it is created; a gMSA
  needs no vault entry.
- The NAS-credential handling here overlaps EXT-43 (a CKAM-only NAS account): if EXT-43 gives CKAM its own NAS
  account, use that in `nas.pw`; the service-account design is unchanged.

---

**Reminder:** this plan creates nothing by itself. Until Infra has created the account, re-pointed the task, and
the section 7 tests pass on 10.0.1.98, IF-07 stays open and CKAM still runs as SYSTEM.
