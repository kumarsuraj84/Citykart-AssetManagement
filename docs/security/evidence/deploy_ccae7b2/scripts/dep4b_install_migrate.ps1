# F2 install, F3 switch settings, F4 migrate. CKAM must already be STOPPED. Never starts CKAM. Never prints a secret.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$ev = 'D:\CKAM_EVIDENCE_20261017_111445'
$rel = "$root\releases\ccae7b2"
$py = "$root\shared\venv\Scripts\python.exe"
if (@(Get-NetTCPConnection -LocalPort 3211 -State Listen -ErrorAction SilentlyContinue).Count -ne 0) { 'STOP: something still listens on 3211'; exit 2 }

"=== F2 pip install (constrained) $(Get-Date -Format 'HH:mm:ss')"
& $py -m pip install --disable-pip-version-check -c "$rel\backend\constraints.txt" -e "$rel\backend" 2>&1 | ForEach-Object { "$_" } | Out-File "$ev\pip-install.txt" -Encoding utf8
$pipExit = $LASTEXITCODE
"pip install exit code: $pipExit"
if ($pipExit -ne 0) { 'PIP FAILED - last lines:'; Get-Content "$ev\pip-install.txt" -Tail 25; 'STATE: branch=A; ckam_web=stopped; schema=untouched; exit=1'; exit 1 }
& $py -m pip check 2>&1 | ForEach-Object { "$_" } | Out-File "$ev\pip-check.txt" -Encoding utf8
"pip check: $(Get-Content "$ev\pip-check.txt" -Raw)"
& $py -m pip freeze 2>&1 | ForEach-Object { "$_" } | Out-File "$rel\pip-freeze.txt" -Encoding utf8
$freeze = Get-Content "$rel\pip-freeze.txt"
"pip freeze lines: $($freeze.Count)"
# every pin must be matched
$pins = @{}
foreach ($l in (Get-Content "$rel\backend\constraints.txt")) { if ($l -match '^\s*([A-Za-z0-9_.\-]+)==([^\s;#]+)') { $pins[$matches[1].ToLower().Replace('_','-')] = $matches[2] } }
$bad = 0
foreach ($l in $freeze) {
  if ($l -match '^([A-Za-z0-9_.\-]+)==(.+)$') {
    $n = $matches[1].ToLower().Replace('_','-'); $v = $matches[2]
    if ($pins.ContainsKey($n)) { if ($pins[$n] -ne $v) { "MISMATCH: $n installed $v pin $($pins[$n])"; $bad++ } } else { "NOT PINNED (note it): $n==$v" }
  } elseif ($l -notmatch '^-e ') { "other freeze line: $l" }
}
"pin mismatches: $bad"
$freeze | Select-String '^colorama==' | ForEach-Object { "colorama installed: $($_.Line)" }
$freeze | Select-String 'ckam' | ForEach-Object { "editable: $($_.Line)" }

"=== F3 switch settings $(Get-Date -Format 'HH:mm:ss')"
$envPath = "$root\shared\.env"
$raw = [IO.File]::ReadAllText($envPath)
$new = "$rel\frontend-dist"
foreach ($pair in @(@('FRONTEND_DIST_DIR', $new), @('APP_VERSION', 'ccae7b2'))) {
  $k = $pair[0]; $val = $pair[1]
  $cnt = ([regex]::Matches($raw, "(?m)^\s*$k\s*=")).Count
  if ($cnt -ne 1) { "STOP: $k appears $cnt times in .env"; 'STATE: branch=A; ckam_web=stopped; schema=untouched; exit=1'; exit 1 }
  $raw = [regex]::Replace($raw, "(?m)^(\s*$k\s*=)[^\r\n]*", { param($m) $m.Groups[1].Value + $val }.GetNewClosure())
}
[IO.File]::WriteAllText($envPath, $raw, (New-Object Text.UTF8Encoding($false)))
$b = [IO.File]::ReadAllBytes($envPath)
"BOM present: $($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)  (must be False)"
$allow = 'ENVIRONMENT_NAME','APP_VERSION','FRONTEND_DIST_DIR','LOG_DIR','UPLOAD_DIR','BASE_URL','COOKIE_SECURE','TRUSTED_PROXIES','PO_SOURCE_HOST','PO_SOURCE_PORT','PO_SOURCE_DB','PO_SOURCE_USER'
Get-Content $envPath | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') {
    if ($allow -contains $matches[1]) { '{0}={1}' -f $matches[1], $matches[2].Trim() } else { '{0}=<hidden, length {1}>' -f $matches[1], $matches[2].Trim().Length }
  }
}
# C3 / C4 re-check without printing
$line = @(Get-Content $envPath | Where-Object { $_ -match '^\s*JWT_SECRET\s*=' })
$v = ($line[0] -replace '^\s*JWT_SECRET\s*=\s*', '').Trim()
$set = New-Object 'System.Collections.Generic.HashSet[char]'; foreach ($c in $v.ToCharArray()) { [void]$set.Add($c) }
"JWT lines=$($line.Count) len>=32=$($v.Length -ge 32) distinct>=8=$($set.Count -ge 8) quoted=$(($v.Length -gt 0) -and (($v[0] -eq [char]34) -or ($v[0] -eq [char]39)))"
$d = @(Get-Content $envPath | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' }); $u = ($d[0] -replace '^\s*DATABASE_URL\s*=\s*', '').Trim()
$hostpart = if ($u -match '@([^:/@]+)(:(\d+))?/([^?]+)') { "host=$($matches[1]) port=$($matches[3]) database=$($matches[4])" } else { 'host part not recognised' }
"DATABASE_URL lines=$($d.Count) nonempty=$($u.Length -gt 0) $hostpart asyncpg=$($u.StartsWith('postgresql+asyncpg://'))"
Remove-Variable v, line, set, u, d

"=== F4 migrate $(Get-Date -Format 'HH:mm:ss')"
Get-Content $envPath | Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' } | ForEach-Object {
  $k, $v2 = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($k.Trim(), $v2, 'Process')
}
if (-not $env:DATABASE_URL) { 'STOP: DATABASE_URL not set'; exit 2 }
Set-Location "$rel\backend"
& $py -m alembic heads   2>&1 | ForEach-Object { "$_" } | Out-File "$ev\alembic-heads.txt" -Encoding utf8
& $py -m alembic current 2>&1 | ForEach-Object { "$_" } | Out-File "$ev\alembic-before.txt" -Encoding utf8
"heads  : $((Get-Content "$ev\alembic-heads.txt") -join ' | ')"
"before : $((Get-Content "$ev\alembic-before.txt") -join ' | ')"
$t0 = Get-Date
& $py -m alembic upgrade head 2>&1 | ForEach-Object { "$_" } | Out-File "$ev\alembic-upgrade.txt" -Encoding utf8
$upExit = $LASTEXITCODE
$secs = ((Get-Date) - $t0).TotalSeconds
"alembic upgrade exit code: $upExit  ($([math]::Round($secs,2)) s)"
Get-Content "$ev\alembic-upgrade.txt" | Select-String -NotMatch 'password|secret' | ForEach-Object { "  $($_.Line)" }
& $py -m alembic current 2>&1 | ForEach-Object { "$_" } | Out-File "$ev\alembic-after.txt" -Encoding utf8
"after  : $((Get-Content "$ev\alembic-after.txt") -join ' | ')"
$ok = ($upExit -eq 0) -and ((Get-Content "$ev\alembic-after.txt" -Raw) -match 'c6e8a0b2d4f6')
if (-not $ok) { 'MIGRATION NOT AT HEAD - DO NOT START CODE'; 'STATE: branch=B; ckam_web=stopped; exit=3'; exit 3 }
'STATE: migrated to c6e8a0b2d4f6 (head); ckam_web=stopped; ready for launcher + start'
exit 0
