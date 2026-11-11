# Release 0df67d3 cutover: stop CKAM, install, switch settings, run the two migrations, start, wait for health.
# Database: c6e8a0b2d4f6 -> d7f9b1c3e5a7 -> e8a0c2d4f6b8 (one transaction). The backup was taken just before (ckassetmanagement_20261111_124159.dump).
# If anything fails BEFORE the migration succeeds, the settings are put back and the PREVIOUS release (0b8c525, same schema as the database) starts again.
# If it fails AFTER the migration, the previous release is started as a stop-gap and the script says so (the schema is then the new one). No secret is printed.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$ev = 'D:\CKAM_EVIDENCE_20261017_111445\release_0df67d3'
$rel = "$root\releases\0df67d3"
$py = "$root\shared\venv\Scripts\python.exe"
$envPath = "$root\shared\.env"
$newDist = "$rel\frontend-dist"
$script:migrated = $false
"cutover started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
if (-not (Test-Path "$rel\backend\app\main.py")) { 'STOP: release folder missing'; exit 2 }

function Get-Key([string]$text, [string]$k) { ([regex]::Match($text, "(?m)^\s*$k\s*=([^\r\n]*)")).Groups[1].Value }
function Set-Key([string]$text, [string]$k, [string]$val) {
  if (([regex]::Matches($text, "(?m)^\s*$k\s*=")).Count -ne 1) { throw "$k appears not exactly once in .env" }
  [regex]::Replace($text, "(?m)^(\s*$k\s*=)[^\r\n]*", { param($m) $m.Groups[1].Value + $val }.GetNewClosure())
}
function Save-Env([string]$text) { [IO.File]::WriteAllText($envPath, $text, (New-Object Text.UTF8Encoding($false))) }
function Wait-Health {
  for ($i = 1; $i -le 24; $i++) { Start-Sleep 5; $h = & curl.exe -s --max-time 4 http://127.0.0.1:3211/api/health; if ($h -match '"ok"') { "health after $($i*5) s: $h"; return $true } }
  return $false
}
function Stop-Ckam {
  Stop-ScheduledTask -TaskName 'CKAM-Web'; Start-Sleep 3
  foreach ($p in @((Get-NetTCPConnection -LocalPort 3211 -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique)) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p"
    if ($proc.ExecutablePath -like "$root\shared\venv\*" -and $proc.CommandLine -like '*app.main:app*') { Stop-Process -Id $p -Force; "stopped CKAM python PID $p" } else { "NOT touching PID $p" }
  }
  Start-Sleep 3
  "listeners on 3211: $(@(Get-NetTCPConnection -LocalPort 3211 -State Listen -ErrorAction SilentlyContinue).Count)"
}
function Restore-Previous([string]$why) {
  "!!! $why -> putting the previous release (0b8c525) back"
  if ($script:migrated) { '!!! NOTE: the database is ALREADY at the new schema (e8a0c2d4f6b8); the previous release runs on it only as a stop-gap. Fix forward.' }
  # the previous release's own packages (nothing new to download; same pins)
  & $py -m pip install --disable-pip-version-check -c "$root\releases\0b8c525\backend\constraints.txt" -e "$root\releases\0b8c525\backend" 2>&1 | Out-Null
  Save-Env $script:rawBefore
  Start-ScheduledTask -TaskName 'CKAM-Web'
  if (Wait-Health) { 'STATE: previous release (0b8c525) is serving again; exit=1' } else { 'STATE: previous release did NOT come back healthy; CKAM IS DOWN; exit=1' }
  exit 1
}

$rawBefore = [IO.File]::ReadAllText($envPath)
"before: release dist = $(Split-Path -Leaf (Split-Path -Parent (Get-Key $rawBefore 'FRONTEND_DIST_DIR').Trim())) ; APP_VERSION = $((Get-Key $rawBefore 'APP_VERSION').Trim())"
Copy-Item $envPath "$ev\env.before-0df67d3" -Force       # holds live secrets: deleted at the end of this change

# logs before restart
robocopy "$root\logs" "$ev\logs-at-stop" /E /COPY:DAT /R:1 /W:1 /NP /NFL /NDL | Out-Null
"log copy robocopy exit: $LASTEXITCODE (0-7 = success)"

Stop-Ckam
if (@(Get-NetTCPConnection -LocalPort 3211 -State Listen -ErrorAction SilentlyContinue).Count -ne 0) { Restore-Previous 'port 3211 still busy' }

"=== pip install (constrained) $(Get-Date -Format 'HH:mm:ss')"
& $py -m pip install --disable-pip-version-check -c "$rel\backend\constraints.txt" -e "$rel\backend" 2>&1 | ForEach-Object { "$_" } | Out-File "$ev\pip-install.txt" -Encoding utf8
if ($LASTEXITCODE -ne 0) { Get-Content "$ev\pip-install.txt" -Tail 20; Restore-Previous 'pip install failed' }
"pip install exit: 0"
& $py -m pip check 2>&1 | ForEach-Object { "$_" } | Out-File "$ev\pip-check.txt" -Encoding utf8
"pip check: $((Get-Content "$ev\pip-check.txt") -join ' ')"
& $py -m pip freeze 2>&1 | ForEach-Object { "$_" } | Out-File "$rel\pip-freeze.txt" -Encoding utf8

"=== switch settings"
try {
  $new = Set-Key $rawBefore 'FRONTEND_DIST_DIR' $newDist
  $new = Set-Key $new 'APP_VERSION' '0df67d3'
  Save-Env $new
} catch { Restore-Previous "settings edit failed: $($_.Exception.Message)" }
$b = [IO.File]::ReadAllBytes($envPath)
"BOM present: $($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)  (must be False)"
"FRONTEND_DIST_DIR now: $((Get-Key (Get-Content $envPath -Raw) 'FRONTEND_DIST_DIR').Trim())"
"APP_VERSION now: $((Get-Key (Get-Content $envPath -Raw) 'APP_VERSION').Trim())"

"=== database: before"
Get-Content $envPath | Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' } | ForEach-Object { $k, $v2 = $_ -split '=', 2; [Environment]::SetEnvironmentVariable($k.Trim(), $v2, 'Process') }
Set-Location "$rel\backend"
$heads = (& $py -m alembic heads 2>&1 | ForEach-Object { "$_" }) -join ' | '
$cur = (& $py -m alembic current 2>&1 | ForEach-Object { "$_" }) -join ' | '
"heads: $heads"
"current: $cur"
if ($heads -notmatch 'e8a0c2d4f6b8') { Restore-Previous 'the new release does not have head e8a0c2d4f6b8' }
if ($cur -notmatch 'c6e8a0b2d4f6' -or $cur -match 'd7f9b1c3e5a7|e8a0c2d4f6b8') { Restore-Previous 'database is not at c6e8a0b2d4f6' }

"=== alembic upgrade head $(Get-Date -Format 'HH:mm:ss')"
& $py -m alembic upgrade head 2>&1 | ForEach-Object { "$_" } | Out-File "$ev\alembic-upgrade.txt" -Encoding utf8
$upExit = $LASTEXITCODE
Get-Content "$ev\alembic-upgrade.txt" | Select-String 'Running upgrade|ERROR|Error|Traceback' | ForEach-Object { $_.Line }
$cur2 = (& $py -m alembic current 2>&1 | ForEach-Object { "$_" }) -join ' | '
"alembic upgrade exit: $upExit ; current after: $cur2"
if ($upExit -ne 0 -or $cur2 -notmatch 'e8a0c2d4f6b8') {
  if ($cur2 -match 'c6e8a0b2d4f6' -and $cur2 -notmatch 'd7f9b1c3e5a7|e8a0c2d4f6b8') { Restore-Previous 'migration failed and rolled back (database still at c6e8a0b2d4f6)' }
  'STOP: the migration did not finish cleanly and the database is not at c6e8a0b2d4f6. CKAM stays STOPPED for a person to look at it. exit=3'
  exit 3
}
$script:migrated = $true
"upgrade lines: $(@(Select-String -Path "$ev\alembic-upgrade.txt" -Pattern 'Running upgrade').Count) (2 expected)"

"=== start $(Get-Date -Format 'HH:mm:ss')"
Start-ScheduledTask -TaskName 'CKAM-Web'
if (-not (Wait-Health)) { Restore-Previous 'new release not healthy within 120 s' }
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*app.main:app*' } | ForEach-Object { "PID $($_.ProcessId) : $($_.CommandLine)" }
$ll = Get-ChildItem "$root\logs" -Filter 'ckam-web_*.launcher.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Get-Content $ll.FullName | Select-String 'serving release|release id|NAS mapping' | ForEach-Object { $_.Line }
$err = Get-ChildItem "$root\logs" -Filter 'ckam-web_*.err.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
"stderr log size $($err.Length); Refusing/Traceback hits: $(@(Select-String -Path $err.FullName -Pattern 'Refusing to start|Traceback').Count)"
$j = (Select-String -Path "$root\logs\app\app.jsonl" -Pattern 'app_started' | Select-Object -Last 1).Line | ConvertFrom-Json
"app_started: ts=$($j.ts) version=$($j.details.version) env=$($j.details.environment) migration_matches=$($j.details.migration.matches) db_host=$($j.details.config.database_host) jwt_placeholder=$($j.details.config.jwt_signing_key_is_placeholder)"
if ($j.details.version -ne '0df67d3' -or -not $j.details.migration.matches) { Restore-Previous 'startup record is not 0df67d3 with matching database head' }
"STATE: 0df67d3 is serving; exit=0"
"cutover finished: $(Get-Date -Format 'HH:mm:ss')"
