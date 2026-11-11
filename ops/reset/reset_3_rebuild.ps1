# CKAM production reset, step 3 of 4: build the empty database's structure (all migrations) and check it.
# Run on the APP SERVER (10.0.1.98) after step 2. CKAM must still be stopped. Prints no secret.
#
# The migrations create the head-office admin ("Admin") and print its ONE-TIME temporary password. That text goes ONLY into an
# admin-only file on this server (Administrators and SYSTEM can read it); this script never prints it. The owner reads it there,
# signs in, is forced to choose a new password, and then deletes the file (step 4 reminds).
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$envPath = "$root\shared\.env"
$py = "$root\shared\venv\Scripts\python.exe"
function Get-Key([string]$text, [string]$k) { ([regex]::Match($text, "(?m)^\s*$k\s*=([^\r\n]*)")).Groups[1].Value }
$raw = [IO.File]::ReadAllText($envPath)
$dist = (Get-Key $raw 'FRONTEND_DIST_DIR').Trim()
$rel = Split-Path -Parent $dist
if (-not (Test-Path "$rel\backend\app\main.py")) { 'STOP: cannot find the live release folder from FRONTEND_DIST_DIR.'; exit 2 }
"=== reset step 3 (app server) $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')   release folder: $(Split-Path -Leaf $rel)"
if (@(Get-NetTCPConnection -LocalPort 3211 -State Listen -ErrorAction SilentlyContinue).Count -ne 0) { 'STOP: CKAM is still running. Run step 1 first.'; exit 2 }

Get-Content $envPath | Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' } | ForEach-Object { $k, $v = $_ -split '=', 2; [Environment]::SetEnvironmentVariable($k.Trim(), $v, 'Process') }
Set-Location "$rel\backend"
# the database version this release expects (its own newest migration)
$expectedHead = [regex]::Match(((& $py -m alembic heads 2>&1 | ForEach-Object { "$_" }) -join ' '), '\b([0-9a-f]{12})\b \(head\)').Groups[1].Value
if (-not $expectedHead) { 'STOP: cannot read the release''s migration head.'; exit 2 }
"this release expects database version: $expectedHead"

# a small read-only checker (no secret): counts what is in the database
$check = @'
import asyncio, os, re, sys
import asyncpg
async def main():
    url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    c = await asyncpg.connect(url, timeout=15, server_settings={"default_transaction_read_only": "on"})
    try:
        tables = await c.fetchval("select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")
        print("TABLES", tables)
        if tables:
            print("HEAD", await c.fetchval("select version_num from alembic_version"))
            print("PRIMARY_OWNERS", await c.fetchval("select count(*) from asset_user where is_primary_owner"))
            print("ASSET_USERS", await c.fetchval("select count(*) from asset_user"))
            for t in ("company", "location", "vendor", "asset", "asset_event", "purchase_order"):
                print(t.upper(), await c.fetchval(f"select count(*) from {t}"))
    finally:
        await c.close()
asyncio.run(main())
'@
$tmp = Join-Path $env:TEMP 'ckam_reset_check.py'
Set-Content -LiteralPath $tmp -Value $check -Encoding UTF8
function Check { (& $py -I $tmp 2>&1 | ForEach-Object { "$_" }) }

"--- before: the database must be EMPTY (step 2 done)"
$before = Check
$before
if (-not ($before -match '^TABLES 0\s*$')) { Remove-Item $tmp -Force; 'STOP: the database is not empty. Run step 2 first (or tell Claude).'; exit 2 }

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$dir = "$root\backup\reset-$stamp"
New-Item -ItemType Directory -Force $dir | Out-Null
$secret = "$dir\NEW-ADMIN-PASSWORD-READ-THEN-DELETE.txt"
"--- alembic upgrade head (all migrations from zero) $(Get-Date -Format 'HH:mm:ss')"
& $py -m alembic upgrade head 2>&1 | ForEach-Object { "$_" } | Out-File $secret -Encoding utf8
$exit = $LASTEXITCODE
# admin-only file: Administrators and SYSTEM, nobody else
& icacls.exe $secret /inheritance:r /grant:r '*S-1-5-32-544:(F)' '*S-1-5-18:(F)' | Out-Null
"alembic exit: $exit ; migrations run: $(@(Select-String -Path $secret -Pattern 'Running upgrade').Count)"
# progress without the secret: every line except the password line
Get-Content $secret | Where-Object { $_ -notmatch '(?i)temporary password' -and $_ -match 'Primary Owner|ERROR|Error|Traceback' } | ForEach-Object { "  $_" }
if ($exit -ne 0) { Remove-Item $tmp -Force; "STOP: the migrations failed (details in $secret). CKAM stays stopped."; exit 1 }

"--- after"
$after = Check
$after
Remove-Item $tmp -Force
$tableCount = [int](([regex]::Match(($after -join "`n"), '(?m)^TABLES (\d+)')).Groups[1].Value)
$ok = ($after -match "^HEAD $expectedHead\s*$") -and ($tableCount -ge 30) -and ($after -match '^PRIMARY_OWNERS 1\s*$') -and ($after -match '^ASSET_USERS 1\s*$') -and ($after -match '^COMPANY 0\s*$') -and ($after -match '^ASSET 0\s*$')
if (-not $ok) { "STOP: the new database is not as expected (version $expectedHead, about 40 tables, one head-office admin, nothing else). Tell Claude."; exit 1 }
"REBUILD_OK. The one-time password of the head-office admin ('Admin') is in this admin-only file (read it yourself, never paste it anywhere):"
"  $secret"
'Next: step 4 (start CKAM and verify).'
