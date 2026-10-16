# IF-09 — dev PC: inspection and lock-down plan for `.env` and `backups\`

Finding IF-09 (MEDIUM, OPEN — EXTERNAL): on the development PC (10.0.0.47) the CKAM settings file and the database
dumps can be read, and changed, by every local account. This document is the **read-only inspection** made on
2026-10-16 and the **exact plan** for the owner (or IT) to run later, after explicit approval. **Nothing was
changed**: no ACL, no file moved or deleted. The `.env` file holds a real ERP password; it was **not opened** (only
its permissions and size were read), and no dump or text file in `backups\` was opened.

## 1. What was inspected (read-only commands)

Folder: `D:\ANKUR AI PROJECTS\Asset Management\.claude\worktrees\ckam-build` (the only CKAM checkout on this PC that
has a `.env` or a `backups\` folder; the main checkout and the other worktree have neither).

```
icacls ".env"
icacls "backups"          (plus three sample entries inside it, and the worktree folder itself)
Get-ChildItem backups -Recurse   (names, sizes, dates only)
(Get-Acl ...).Owner
Get-BitLockerVolume       -> "Access denied" (needs an elevated prompt; not retried)
whoami ; whoami /groups
```

Signed-in account: `CKHO-D-NEXTGEN\Ankur` (member of Administrators, docker-users, Users, Authenticated Users).
Owner of `.env` and `backups\`: `CKHO-D-NEXTGEN\Ankur`.

### Current permissions (all inherited from the drive, nothing set on purpose)

| Item | Entries |
|---|---|
| `.env` (674 bytes) | `BUILTIN\Administrators:(I)(F)`, `NT AUTHORITY\SYSTEM:(I)(F)`, **`NT AUTHORITY\Authenticated Users:(I)(M)`**, **`BUILTIN\Users:(I)(RX)`** |
| `backups\` and every file / folder in it | the same four, inheritable to children: Administrators F, SYSTEM F, **Authenticated Users M**, **Users RX / GR,GE** |
| the worktree folder itself | the same (so the whole source tree is readable and changeable by any signed-in local account) |

Meaning in plain words: any person or program that can sign in to this PC with **any** account can read the ERP
password and the JWT secret in `.env`, read every dump (which, judging by their size since 14-10, include the copied
ERP vendor and purchase-order data), and even change or replace them (`M` = modify).

### Contents of `backups\` (names, sizes, dates only — 36 entries at the top level)

| Entry | Size | Date | Unique or superseded? |
|---|---|---|---|
| `ckam_db_20261001_020000.sql.gz` … `ckam_db_20261013_020000.sql.gz` (13 files) | 17,744 – 22,049 B each | 01-10 … 13-10 07:30 | **Superseded.** Nightly dumps of the dev database before the 14-10 reset (small test data). `ops/backup.sh` deletes dumps older than 14 days on its own, so 01-10 and 02-10 go at the next nightly runs |
| `ckam_db_20261014_020000.sql.gz` | 1,544,376 B | 14-10 07:30 | Superseded by `ckam_dev_BEFORE_RESET_20261014` (taken 7 h later, same database) |
| `ckam_dev_BEFORE_RESET_20261014.sql.gz` | 1,539,864 B | 14-10 14:35 | **Unique**: the dev database just before the 14-10 reset (the only copy of that state). Keep, restricted |
| `ckam_dev_EMPTY_FRESH_20261014.sql.gz` | 1,523,994 B | 14-10 15:03 | **Unique**: the freshly reset baseline. Keep, restricted |
| `ckam_db_20261015_020000.sql.gz`, `ckam_db_20261016_020000.sql.gz` | 1,542,600 B, 1,572,459 B | 15-10, 16-10 07:30 | Current nightly dumps; keep the newest (rotated automatically after 14 days) |
| `ckam_uploads_20261001…20261014_020000.tar.gz` (14 files) | 178 B each | 01-10 … 14-10 | Superseded; each holds only the 18-byte test file `testdir/hello.txt` (same as below) |
| `ckam_uploads_20261015…16_020000.tar.gz` (2 files) | 93 B each | 15-10, 16-10 | Empty uploads volume; keep the newest only |
| `dev_files_before_reset_20261014\` (`logs\app.jsonl` 112,724 B, `logs\audit.jsonl` 5,087 B, `logs\error.jsonl` 17,134 B, `uploads\testdir\hello.txt` 18 B) | | 14-10 | **Unique but low value**: the only copy of the pre-reset dev logs (they contain sign-in ids and addresses of dev/test sessions). Keep restricted, or delete if the owner agrees nothing in them is still needed |
| `DEV_FIRST_LOGIN.txt` | 266 B | 14-10 14:44 | **A credential** by its name (first-sign-in details of the reset dev database; not opened). Should not sit in a shared folder: move its content into a password manager, then delete the file |

BitLocker state of C: and D: could not be read without elevation; the owner checks it with
`manage-bde -status` in an elevated prompt (step 6).

## 2. What could break (read before running anything)

| Who / what reads these files | After the change | Why |
|---|---|---|
| `docker compose` (reads `.env` as the signed-in user) | keeps working | the user `CKHO-D-NEXTGEN\Ankur` is granted Full control explicitly |
| Docker Desktop bind mount `./backups` for the `backup` container (WSL 2 backend, accesses Windows files in the user's context; the Docker Desktop service runs as SYSTEM) | keeps working | user and SYSTEM keep Full control |
| Programs started **without elevation** (VS Code, Git, Claude Code, a normal PowerShell) | keep working **only because the user is named explicitly** | with UAC, a non-elevated program does not use the Administrators group; if only Administrators + SYSTEM were kept, the developer's own tools would lose access |
| Other local accounts on this PC, scheduled tasks or services running as another account, a second developer account | **lose access** (intended) | that is the point of the fix; check none of them is needed (e.g. a backup tool running as another user) |
| Backup / antivirus / Windows Search running as SYSTEM | keep working | SYSTEM kept |
| A git checkout or `git stash` that recreates `.env` | not affected (`.env` and `backups\` are git-ignored, git never writes them) | |
| New nightly dump files written by the `backup` container | get the restricted permissions automatically | they inherit from `backups\` once inheritance from the drive is cut |

## 3. Plan for the owner / IT (run only after explicit approval)

Run in an **elevated** Windows PowerShell on the dev PC, from the worktree folder. Replace
`CKHO-D-NEXTGEN\Ankur` if the developer account is a different one. SIDs are used for SYSTEM (`*S-1-5-18`) and
Administrators (`*S-1-5-32-544`) so the commands work on any Windows language.

### Step 0 — go to the folder and keep a copy of today's permissions (rollback material)

```powershell
Set-Location 'D:\ANKUR AI PROJECTS\Asset Management\.claude\worktrees\ckam-build'
New-Item -ItemType Directory -Force "$env:USERPROFILE\ckam_acl_backup" | Out-Null
icacls ".env"    /save "$env:USERPROFILE\ckam_acl_backup\env.acl"
icacls "backups" /save "$env:USERPROFILE\ckam_acl_backup\backups.acl" /t /c
icacls ".env" ; icacls "backups"          # keep this output with the change record
```

### Step 1 — `.env`: only the developer, SYSTEM and Administrators

```powershell
icacls ".env" /inheritance:r /grant:r "CKHO-D-NEXTGEN\Ankur:(F)" "*S-1-5-18:(F)" "*S-1-5-32-544:(F)"
```

### Step 2 — `backups\` and everything in it

```powershell
icacls "backups" /inheritance:r /grant:r "CKHO-D-NEXTGEN\Ankur:(OI)(CI)(F)" "*S-1-5-18:(OI)(CI)(F)" "*S-1-5-32-544:(OI)(CI)(F)"
icacls "backups\*" /reset /t /c           # children take the new, restricted permissions of backups\
```

### Step 3 — check

```powershell
icacls ".env"              # exactly 3 entries, none marked (I), no Users / Authenticated Users / Everyone
icacls "backups"           # the same 3 entries, with (OI)(CI)
icacls "backups\DEV_FIRST_LOGIN.txt"    # 3 inherited entries, no Users / Authenticated Users
docker compose config -q   # .env still readable by the developer (prints nothing, exit 0)
docker compose exec backup sh /scripts/backup.sh    # the backup container can still write into backups\
Get-ChildItem backups | Sort-Object LastWriteTime | Select-Object -Last 2   # the two new files are there
```

### Step 4 — reduce what is kept (separate approval; nothing is deleted by steps 0-3)

Suggested, owner decides: delete the 14 superseded `ckam_db_20261001…20261014_020000.sql.gz` dumps and the 15
superseded `ckam_uploads_…tar.gz` files up to 15-10; keep `ckam_dev_BEFORE_RESET_20261014.sql.gz`,
`ckam_dev_EMPTY_FRESH_20261014.sql.gz` and the newest nightly pair; move the content of `DEV_FIRST_LOGIN.txt` into a
password manager and delete the file; keep or delete `dev_files_before_reset_20261014\`. These are dev-only
copies, not business records, but deleting them is still a separate, explicit owner approval.

### Step 5 — rollback (if anything above breaks a tool)

```powershell
Set-Location 'D:\ANKUR AI PROJECTS\Asset Management\.claude\worktrees\ckam-build'
icacls . /restore "$env:USERPROFILE\ckam_acl_backup\env.acl" /c
icacls . /restore "$env:USERPROFILE\ckam_acl_backup\backups.acl" /c
# or simply return to the inherited drive permissions (today's state):
icacls ".env" /reset ; icacls "backups" /reset /t /c
```

(`/restore` is run on the folder that CONTAINS `.env` and `backups`, because `/save` stores names relative to it.)

### Step 6 — disk encryption (IF-09 second half)

```powershell
manage-bde -status C: ; manage-bde -status D:      # elevated; "Protection On" expected for both
```

If D: is not encrypted, turning BitLocker on is an IT decision (recovery key stored with IT first).

### Optional, wider

The whole `D:\ANKUR AI PROJECTS` tree inherits `Authenticated Users:(M)` from the drive, so the source code itself
can be changed by any local account. Restricting the whole folder the same way (Step 1 command on the folder, with
`(OI)(CI)` and `/t`) is the stronger fix; it affects every project in that folder, so it is listed only as an option.

## 4. Done when

`icacls .env` and `icacls backups` show only the developer, SYSTEM and Administrators; `docker compose` and the
nightly backup still work; BitLocker is on for the drive holding the repository; the superseded dumps and
`DEV_FIRST_LOGIN.txt` are gone (owner decision). Tracked as EXT-10 in `docs/security/CKAM_EXTERNAL_SECURITY_ACTIONS.md`.
