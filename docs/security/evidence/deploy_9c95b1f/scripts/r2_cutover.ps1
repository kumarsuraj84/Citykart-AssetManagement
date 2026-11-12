# Release 9c95b1f cutover: stop CKAM, install, switch settings, check the database head, start, wait for health.
# ONE additive migration in this release (b3d5f7a9c1e4 adds the column brand.work_areas and fills it from where each brand is used; the database moves from a9c1e3b5d7f2). If anything fails before
# the new release serves, the settings are put back and the PREVIOUS release (bdab644; it ignores the new column) is started again.
# No secret is printed.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$ev = 'D:\CKAM_EVIDENCE_20261017_111445\release_9c95b1f'
$rel = "$root\releases\9c95b1f"
$prev = "$root\releases\bdab644"
$py = "$root\shared\venv\Scripts\python.exe"
$envPath = "$root\shared\.env"
$newDist = "$rel\frontend-dist"
"cutover started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
if (-not (Test-Path "$rel\backend\app\main.py")) { 'STOP: release folder missing'; exit 2 }
if (-not (Test-Path "$prev\backend\app\main.py")) { 'STOP: previous release folder missing'; exit 2 }

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
  "!!! $why -> putting the previous release (bdab644) back"
  & $py -m pip install --disable-pip-version-check -c "$prev\backend\constraints.txt" -e "$prev\backend" 2>&1 | Out-Null
  Save-Env $script:rawBefore
  Start-ScheduledTask -TaskName 'CKAM-Web'
  if (Wait-Health) { 'STATE: previous release (bdab644) is serving again; exit=1' } else { 'STATE: previous release did NOT come back healthy; CKAM IS DOWN; exit=1' }
  exit 1
}

$rawBefore = [IO.File]::ReadAllText($envPath)
"before: release dist = $(Split-Path -Leaf (Split-Path -Parent (Get-Key $rawBefore 'FRONTEND_DIST_DIR').Trim())) ; APP_VERSION = $((Get-Key $rawBefore 'APP_VERSION').Trim()) ; PO_SOURCE_HOST = $((Get-Key $rawBefore 'PO_SOURCE_HOST').Trim())"
Copy-Item $envPath "$ev\env.before-9c95b1f" -Force       # holds live secrets: deleted at the end of this change

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
  $new = Set-Key $new 'APP_VERSION' '9c95b1f'
  Save-Env $new
} catch { Restore-Previous "settings edit failed: $($_.Exception.Message)" }
$b = [IO.File]::ReadAllBytes($envPath)
"BOM present: $($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)  (must be False)"
"FRONTEND_DIST_DIR now: $((Get-Key (Get-Content $envPath -Raw) 'FRONTEND_DIST_DIR').Trim())"
"APP_VERSION now: $((Get-Key (Get-Content $envPath -Raw) 'APP_VERSION').Trim())"

"=== database: ONE additive migration expected (a9c1e3b5d7f2 -> b3d5f7a9c1e4)"
Get-Content $envPath | Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' } | ForEach-Object { $k, $v2 = $_ -split '=', 2; [Environment]::SetEnvironmentVariable($k.Trim(), $v2, 'Process') }
Set-Location "$rel\backend"
$heads = (& $py -m alembic heads 2>&1 | ForEach-Object { "$_" }) -join ' | '
$cur = (& $py -m alembic current 2>&1 | ForEach-Object { "$_" }) -join ' | '
"heads: $heads"
"current: $cur"
if ($heads -notmatch 'b3d5f7a9c1e4') { Restore-Previous 'this release does not end at migration b3d5f7a9c1e4' }
if ($cur -notmatch 'a9c1e3b5d7f2') { Restore-Previous 'database is not at a9c1e3b5d7f2 before the migration' }
& $py -m alembic upgrade head 2>&1 | ForEach-Object { "$_" } | Out-File "$ev\alembic-upgrade.txt" -Encoding utf8
$upExit = $LASTEXITCODE
$ran = @(Select-String -Path "$ev\alembic-upgrade.txt" -Pattern 'Running upgrade').Count
"alembic upgrade exit: $upExit ; 'Running upgrade' lines: $ran (1 expected)"
if ($upExit -ne 0) { Restore-Previous 'the migration failed (transactional: nothing was applied)' }
$cur2 = (& $py -m alembic current 2>&1 | ForEach-Object { "$_" }) -join ' | '
"current after: $cur2"
if ($cur2 -notmatch 'b3d5f7a9c1e4' -or $ran -ne 1) { Restore-Previous 'the database is not at b3d5f7a9c1e4 after the migration' }

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
if ($j.details.version -ne '9c95b1f' -or -not $j.details.migration.matches) { Restore-Previous 'startup record is not 9c95b1f with matching database head' }
"STATE: 9c95b1f is serving; exit=0"
"cutover finished: $(Get-Date -Format 'HH:mm:ss')"
