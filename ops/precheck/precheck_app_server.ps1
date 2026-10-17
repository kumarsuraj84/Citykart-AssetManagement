<#
.SYNOPSIS
  READ-ONLY pre-deployment check of the CKAM APPLICATION server (10.0.1.98). Changes nothing. Prints no secret.

.DESCRIPTION
  Answers the "live precheck" questions of docs/security/CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md step C:
    * which release is live, how the CKAM-Web task and the launcher are set up, and whether the running uvicorn
      process already has --no-proxy-headers / --no-server-header
    * whether shared\.env is ready for the new release (ENVIRONMENT_NAME, JWT_SECRET strength, DATABASE_URL present),
      WITHOUT printing any secret (only lengths, counts and yes/no)
    * who may read shared\.env (file permissions)
    * antivirus / endpoint-protection products that could interrupt a deploy (Seqrite, Defender ...)
    * free disk space, how old the logs are, whether the server can reach the database, the NAS and the Python
      package index
  It only reads files, services, tasks and the network. It starts, stops, writes and deletes nothing, except one
  report file in -OutDir. Run it in an ELEVATED Windows PowerShell (Run as administrator) so that the command line of
  the process started by the SYSTEM task can be read.

.PARAMETER AppRoot   CKAM's folder. Default D:\Citykart_Applications\Citykart_AssetManagement_App
.PARAMETER Port      The CKAM port. Default 3211
.PARAMETER TaskName  The scheduled task. Default CKAM-Web
.PARAMETER OutDir    Where the report file is written. Default: your Desktop
.PARAMETER TestErp   Also test the TCP connection to the ERP host named in shared\.env (off by default)

.EXAMPLE
  .\precheck_app_server.ps1
  .\precheck_app_server.ps1 -OutDir D:\CKAM_EVIDENCE

.NOTES
  The report file contains no secret, but it does contain server names and folder paths: share it only with the
  people running the deployment. Status words: PASS / WARN / FAIL / INFO.
#>
[CmdletBinding()]
param(
  [string]$AppRoot  = 'D:\Citykart_Applications\Citykart_AssetManagement_App',
  [int]$Port        = 3211,
  [string]$TaskName = 'CKAM-Web',
  [string]$OutDir   = ([Environment]::GetFolderPath('Desktop')),
  [switch]$TestErp
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Continue'
$rows = New-Object System.Collections.Generic.List[object]
function Add-Row([string]$Check, [string]$Result, [string]$Detail) {
  $rows.Add([pscustomobject]@{ Check = $Check; Result = $Result; Detail = $Detail }) | Out-Null
}
function Test-Tcp([string]$HostName, [int]$PortNumber, [int]$TimeoutMs = 5000) {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $c.BeginConnect($HostName, $PortNumber, $null, $null)
    if ($iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false) -and $c.Connected) { $c.EndConnect($iar); return $true }
    return $false
  } catch { return $false } finally { $c.Close() }
}
function Mask([string]$Text) {
  if (-not $Text) { return $Text }
  return ($Text -replace '(?i)(password|passwd|pwd|secret|token|PGPASSWORD)\s*[=:]\s*("[^"]*"|''[^'']*''|\S+)', '$1=<masked>')
}

Add-Row 'Report' 'INFO' ("CKAM app-server precheck, READ-ONLY, run at {0} on {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'), $env:COMPUTERNAME)

# ---------------------------------------------------------------- 1. host
try {
  $os = Get-CimInstance Win32_OperatingSystem
  Add-Row 'Host' 'INFO' ("{0}, build {1}, last boot {2}" -f $os.Caption, $os.BuildNumber, $os.LastBootUpTime)
} catch { Add-Row 'Host' 'WARN' "could not read the operating system: $($_.Exception.Message)" }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) { Add-Row 'Elevated PowerShell' 'PASS' 'running as administrator' }
else { Add-Row 'Elevated PowerShell' 'WARN' 'NOT elevated: the command line of the SYSTEM task process and some ACLs cannot be read. Re-run as administrator' }

# ---------------------------------------------------------------- 2. folders and disk
if (Test-Path -LiteralPath $AppRoot) {
  Add-Row 'AppRoot' 'PASS' $AppRoot
  try {
    $drive = (Get-Item -LiteralPath $AppRoot).PSDrive
    $freeGb = [math]::Round($drive.Free / 1GB, 1)
    $res = if ($freeGb -ge 5) { 'PASS' } else { 'WARN' }
    Add-Row 'Free disk on the CKAM drive' $res ("{0}: {1} GB free (the release needs about 0.1 GB, logs and backups more)" -f $drive.Name, $freeGb)
  } catch { Add-Row 'Free disk' 'WARN' $_.Exception.Message }
} else {
  Add-Row 'AppRoot' 'FAIL' "$AppRoot not found: pass -AppRoot with the real folder"
}
$shared = Join-Path $AppRoot 'shared'
$releasesDir = Join-Path $AppRoot 'releases'
if (Test-Path -LiteralPath $releasesDir) {
  $rel = Get-ChildItem -LiteralPath $releasesDir -Directory | Sort-Object LastWriteTime
  Add-Row 'Release folders' 'INFO' (($rel | ForEach-Object { "{0} ({1:yyyy-MM-dd})" -f $_.Name, $_.LastWriteTime }) -join ', ')
} else { Add-Row 'Release folders' 'WARN' "$releasesDir not found" }

# ---------------------------------------------------------------- 3. antivirus / endpoint protection
try {
  $pat = 'seqrite|quick ?heal|defender|crowdstrike|sophos|symantec|norton|mcafee|trend ?micro|kaspersky|eset|cylance|sentinel|carbon ?black|bitdefender|malwarebytes|cortex|cybereason|webroot|endpoint'
  $svc = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match $pat -or $_.Name -match $pat }
  if ($svc) {
    Add-Row 'Endpoint protection services' 'WARN' (($svc | ForEach-Object { "{0} [{1}]" -f $_.DisplayName, $_.Status }) -join '; ')
    Add-Row 'Endpoint protection action' 'INFO' 'Behaviour blocking may stop deploy scripts (it removed PowerShell on the dev PC on 2026-10-17). Ask IT for an exclusion for the CKAM folder and the deploy scripts for the window (go/no-go Q18)'
  } else { Add-Row 'Endpoint protection services' 'INFO' 'no known antivirus service name found (check the product list with IT)' }
  if (Get-Command Get-MpComputerStatus -ErrorAction SilentlyContinue) {
    $mp = Get-MpComputerStatus -ErrorAction SilentlyContinue
    if ($mp) { Add-Row 'Windows Defender' 'INFO' ("enabled={0}, real-time={1}, signatures {2:yyyy-MM-dd}" -f $mp.AntivirusEnabled, $mp.RealTimeProtectionEnabled, $mp.AntivirusSignatureLastUpdated) }
    $pref = Get-MpPreference -ErrorAction SilentlyContinue
    if ($pref -and $pref.ExclusionPath) { Add-Row 'Defender path exclusions' 'INFO' (($pref.ExclusionPath) -join '; ') }
  }
} catch { Add-Row 'Endpoint protection' 'WARN' $_.Exception.Message }

# ---------------------------------------------------------------- 4. scheduled task and launcher
$launcherPath = $null
try {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
  $act = @($task.Actions)[0]
  Add-Row "Task $TaskName" 'PASS' ("state={0}, runs as {1} (run level {2}), last run {3}, last result {4}" -f $task.State, $task.Principal.UserId, $task.Principal.RunLevel, $info.LastRunTime, $info.LastTaskResult)
  Add-Row "Task $TaskName action" 'INFO' (Mask ("{0} {1}" -f $act.Execute, $act.Arguments))
  if ($task.Principal.UserId -match 'SYSTEM') { Add-Row 'Task identity' 'WARN' 'runs as SYSTEM (IF-07): plan in docs/security/CKAM_SERVICE_ACCOUNT_PLAN.md' }
  $m = [regex]::Match([string]$act.Arguments, '(?i)-File\s+"?([^"\s]+\.ps1)"?')
  if ($m.Success) { $launcherPath = $m.Groups[1].Value }
} catch { Add-Row "Task $TaskName" 'FAIL' "not found or not readable: $($_.Exception.Message)" }
if (-not $launcherPath) { $launcherPath = Join-Path $shared 'run_ckam_web.ps1' }
if (Test-Path -LiteralPath $launcherPath) {
  $lf = Get-Item -LiteralPath $launcherPath
  $hash = (Get-FileHash -LiteralPath $launcherPath -Algorithm SHA256).Hash
  Add-Row 'Launcher file' 'INFO' ("{0}, {1} bytes, modified {2:yyyy-MM-dd HH:mm}, SHA-256 {3}" -f $lf.FullName, $lf.Length, $lf.LastWriteTime, $hash)
  $text = Get-Content -LiteralPath $launcherPath -Raw
  foreach ($flag in '--no-proxy-headers', '--no-server-header') {
    if ($text -match [regex]::Escape($flag)) { Add-Row "Launcher has $flag" 'PASS' 'yes' }
    else { Add-Row "Launcher has $flag" 'WARN' 'NO: add it at the deploy window (EXT-38)' }
  }
  # judge the two "must not" flags on CODE only: the reviewed launcher explains them in its comments (block and # lines)
  $code = (([regex]::Replace($text, '(?s)<#.*?#>', '') -split "`r?`n") | Where-Object { $_.TrimStart() -notmatch '^#' }) -join "`n"
  if ($code -match '(?<![\w-])--proxy-headers') { Add-Row 'Launcher has --proxy-headers' 'FAIL' 'must not be present' }
  if ($code -match '--workers') { Add-Row 'Launcher uses --workers' 'WARN' 'the in-process rate limits and logs assume ONE process' }
  $secretLines = @(Select-String -LiteralPath $launcherPath -Pattern '(?i)(password|passwd|secret|token)\s*[=:]\s*["'']?\w' | ForEach-Object { $_.LineNumber })
  if ($secretLines.Count -gt 0) { Add-Row 'Launcher text' 'WARN' ("lines {0} look like a literal password/secret assignment (values not shown). Do not send this file to anyone" -f ($secretLines -join ',')) }
  else { Add-Row 'Launcher text' 'PASS' 'no literal password/secret assignment found (safe to send for review after you have looked yourself)' }
} else { Add-Row 'Launcher file' 'WARN' "$launcherPath not found" }

# ---------------------------------------------------------------- 5. the running process
try {
  $listen = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
  Add-Row "Listener on port $Port" 'INFO' (("{0} listener(s): PID {1}; address {2}" -f $listen.Count, (($listen | ForEach-Object { $_.OwningProcess } | Select-Object -Unique) -join ','), (($listen | ForEach-Object { $_.LocalAddress } | Select-Object -Unique) -join ',')))
  foreach ($procId in ($listen | ForEach-Object { $_.OwningProcess } | Select-Object -Unique)) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$procId"
    $cmd = [string]$p.CommandLine
    if ($cmd) {
      Add-Row "Process $procId command line" 'INFO' (Mask $cmd)
      foreach ($flag in '--no-proxy-headers', '--no-server-header') {
        if ($cmd -match [regex]::Escape($flag)) { Add-Row "Running process has $flag" 'PASS' 'yes' } else { Add-Row "Running process has $flag" 'WARN' 'NO (live launcher lacks it)' }
      }
    } else { Add-Row "Process $procId command line" 'WARN' 'not readable (run elevated)' }
  }
} catch { Add-Row "Listener on port $Port" 'WARN' "nothing listening or not readable: $($_.Exception.Message)" }
try {
  $logsDir = Join-Path $AppRoot 'logs'
  $launcherLog = Get-ChildItem -LiteralPath $logsDir -Filter '*launcher*.log' -ErrorAction Stop | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($launcherLog) {
    $serving = Select-String -LiteralPath $launcherLog.FullName -Pattern 'serving release' | Select-Object -Last 1
    Add-Row 'Launcher log: serving release' 'INFO' ("{0}: {1}" -f $launcherLog.Name, $(if ($serving) { Mask $serving.Line.Trim() } else { 'no "serving release" line' }))
  }
} catch { Add-Row 'Launcher log' 'INFO' 'no launcher log found in <AppRoot>\logs' }

# ---------------------------------------------------------------- 6. shared\.env (NO values are printed except non-secret ones)
$envPath = Join-Path $shared '.env'
$cfg = @{}
if (Test-Path -LiteralPath $envPath) {
  $bytes = [System.IO.File]::ReadAllBytes($envPath)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { Add-Row '.env encoding' 'WARN' 'starts with a UTF-8 BOM (the first key may be misread): rewrite without BOM' }
  $dupes = @{}
  foreach ($line in (Get-Content -LiteralPath $envPath)) {
    if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { continue }
    $k = $Matches[1]; $v = $Matches[2].Trim()
    if ($cfg.ContainsKey($k)) { $dupes[$k] = 1 }
    $cfg[$k] = $v
  }
  Add-Row 'shared\.env keys (names only)' 'INFO' (($cfg.Keys | Sort-Object) -join ', ')
  if ($dupes.Count -gt 0) { Add-Row '.env duplicate keys' 'WARN' (($dupes.Keys) -join ', ') }

  $envName = if ($cfg.ContainsKey('ENVIRONMENT_NAME')) { $cfg['ENVIRONMENT_NAME'].Trim('"', "'") } else { '' }
  if ($envName -eq 'production') { Add-Row 'ENVIRONMENT_NAME' 'PASS' 'production' } else { Add-Row 'ENVIRONMENT_NAME' 'FAIL' ("is '{0}': must be exactly production (the new code treats anything else as production-with-warnings or refuses)" -f $envName) }

  if ($cfg.ContainsKey('JWT_SECRET')) {
    $j = $cfg['JWT_SECRET']
    if (($j.StartsWith('"') -and $j.EndsWith('"')) -or ($j.StartsWith("'") -and $j.EndsWith("'"))) { Add-Row 'JWT_SECRET quoting' 'WARN' 'value is wrapped in quotes; the quotes may be part of the secret. Check how the launcher loads .env'; $j = $j.Trim('"', "'") }
    $distinct = ($j.ToCharArray() | Select-Object -Unique).Count
    $placeholder = @('dev_secret_change_me', 'change_me_too', 'change_me', 'changeme', 'secret') -contains $j.Trim()
    $ok = ($j.Trim().Length -ge 32) -and ($distinct -ge 8) -and (-not $placeholder)
    $res = if ($ok) { 'PASS' } else { 'FAIL' }
    Add-Row 'JWT_SECRET strength' $res ("length {0} (needs >= 32), different characters {1} (needs >= 8), placeholder {2}. The value is NOT shown" -f $j.Trim().Length, $distinct, $placeholder)
  } else { Add-Row 'JWT_SECRET' 'FAIL' 'missing: the new code will not start in production' }

  if ($cfg.ContainsKey('DATABASE_URL')) {
    $u = $cfg['DATABASE_URL'].Trim('"', "'")
    $mm = [regex]::Match($u, '^postgres(?:ql)?(?:\+\w+)?://([^:@/]+)(?::([^@]*))?@([^:/]+)(?::(\d+))?/([^?\s]+)')
    if ($mm.Success) {
      $dbHost = $mm.Groups[3].Value; $dbPort = if ($mm.Groups[4].Value) { [int]$mm.Groups[4].Value } else { 5432 }
      Add-Row 'DATABASE_URL' 'PASS' ("present; user {0}, host {1}, port {2}, database {3}; password not shown" -f $mm.Groups[1].Value, $dbHost, $dbPort, $mm.Groups[5].Value)
      if ($dbHost -in @('localhost', '127.0.0.1', '::1', 'db')) { Add-Row 'DATABASE_URL host' 'FAIL' 'points at a local/dev host' }
      if ($mm.Groups[2].Value -eq 'ckam_dev_pw') { Add-Row 'DATABASE_URL password' 'FAIL' 'is the committed dev default' }
      $cfg['__dbhost'] = $dbHost; $cfg['__dbport'] = "$dbPort"
    } else { Add-Row 'DATABASE_URL' 'WARN' 'present but not in the expected postgresql://user:password@host:port/database form' }
  } else { Add-Row 'DATABASE_URL' 'FAIL' 'missing: the app would fall back to a dev database address. STOP before deploying' }

  foreach ($k in 'FRONTEND_DIST_DIR', 'LOG_DIR', 'APP_VERSION', 'COOKIE_SECURE', 'TRUSTED_PROXIES', 'BASE_URL', 'PO_SOURCE_HOST', 'PO_SOURCE_PORT', 'PO_SOURCE_DB', 'PO_SOURCE_USER') {
    if ($cfg.ContainsKey($k)) { Add-Row ".env $k" 'INFO' $cfg[$k] }
  }
  foreach ($k in 'PO_SOURCE_PASSWORD', 'NAS_PASSWORD') { if ($cfg.ContainsKey($k)) { Add-Row ".env $k" 'INFO' 'present (value not shown)' } }
  if ($cfg.ContainsKey('FRONTEND_DIST_DIR')) {
    $fd = $cfg['FRONTEND_DIST_DIR'].Trim('"', "'")
    if (Test-Path -LiteralPath $fd) { Add-Row 'FRONTEND_DIST_DIR exists' 'PASS' $fd } else { Add-Row 'FRONTEND_DIST_DIR exists' 'FAIL' "$fd not found" }
  }
  # who may read / change the settings file
  try {
    $acl = Get-Acl -LiteralPath $envPath
    $broad = @($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and $_.IdentityReference.Value -match 'Everyone|Authenticated Users|BUILTIN\\Users' })
    $who = ($acl.Access | ForEach-Object { "{0}:{1}" -f $_.IdentityReference.Value, $_.FileSystemRights }) -join '; '
    if ($broad.Count -gt 0) { Add-Row '.env permissions' 'WARN' ("readable by a broad group ({0}). Full list: {1}" -f (($broad | ForEach-Object { $_.IdentityReference.Value }) -join ','), $who) }
    else { Add-Row '.env permissions' 'PASS' $who }
  } catch { Add-Row '.env permissions' 'WARN' $_.Exception.Message }
} else { Add-Row 'shared\.env' 'FAIL' "$envPath not found" }
foreach ($f in 'nas.pw') {
  $p = Join-Path $shared $f
  if (Test-Path -LiteralPath $p) { Add-Row "shared\$f" 'INFO' ("exists, modified {0:yyyy-MM-dd} (content not read)" -f (Get-Item -LiteralPath $p).LastWriteTime) }
}

# ---------------------------------------------------------------- 7. logs (for evidence preservation)
$logDir = if ($cfg.ContainsKey('LOG_DIR')) { $cfg['LOG_DIR'].Trim('"', "'") } else { Join-Path $AppRoot 'logs\app' }
if (Test-Path -LiteralPath $logDir) {
  $lf = Get-ChildItem -LiteralPath $logDir -File -ErrorAction SilentlyContinue
  $oldest = ($lf | Sort-Object LastWriteTime | Select-Object -First 1)
  $sizeMb = [math]::Round((($lf | Measure-Object Length -Sum).Sum) / 1MB, 1)
  Add-Row 'CKAM app logs' 'INFO' ("{0}: {1} files, {2} MB, oldest file modified {3:yyyy-MM-dd}. COPY THEM OFF-SERVER BEFORE THE DEPLOY (runbook step B)" -f $logDir, $lf.Count, $sizeMb, $(if ($oldest) { $oldest.LastWriteTime } else { [datetime]::MinValue }))
} else { Add-Row 'CKAM app logs' 'WARN' "$logDir not found" }

# ---------------------------------------------------------------- 8. python and packages
$py = Join-Path $shared 'venv\Scripts\python.exe'
if (Test-Path -LiteralPath $py) {
  try {
    Add-Row 'Python in shared\venv' 'INFO' ((& $py -c "import sys;print(sys.version.split()[0])" 2>&1) -join ' ')
    $freeze = & $py -m pip list --format=freeze 2>&1 | Where-Object { $_ -match '^(fastapi|uvicorn|sqlalchemy|alembic|asyncpg|colorama|qrcode|python-jose|argon2-cffi|pydantic|pip|setuptools)==' }
    Add-Row 'Key packages installed' 'INFO' ($freeze -join ', ')
  } catch { Add-Row 'Python packages' 'WARN' $_.Exception.Message }
} else { Add-Row 'Python in shared\venv' 'WARN' "$py not found" }

# ---------------------------------------------------------------- 9. network reachability (TCP connect only)
if ($cfg.ContainsKey('__dbhost')) {
  $ok = Test-Tcp $cfg['__dbhost'] ([int]$cfg['__dbport'])
  Add-Row ("TCP to database {0}:{1}" -f $cfg['__dbhost'], $cfg['__dbport']) $(if ($ok) { 'PASS' } else { 'FAIL' }) $(if ($ok) { 'reachable' } else { 'NOT reachable' })
}
$nas = Test-Tcp '10.0.0.25' 445
Add-Row 'TCP to NAS 10.0.0.25:445' $(if ($nas) { 'PASS' } else { 'WARN' }) $(if ($nas) { 'reachable' } else { 'NOT reachable' })
foreach ($h in 'pypi.org', 'files.pythonhosted.org') {
  $ok = Test-Tcp $h 443
  Add-Row "TCP to ${h}:443 (Python package index; needed to install the release)" $(if ($ok) { 'PASS' } else { 'FAIL' }) $(if ($ok) { 'reachable' } else { 'NOT reachable: use a prepared wheelhouse or STOP at runbook F2' })
}
if ($TestErp -and $cfg.ContainsKey('PO_SOURCE_HOST') -and $cfg['PO_SOURCE_HOST']) {
  $ep = if ($cfg.ContainsKey('PO_SOURCE_PORT') -and $cfg['PO_SOURCE_PORT']) { [int]$cfg['PO_SOURCE_PORT'] } else { 5432 }
  $ok = Test-Tcp $cfg['PO_SOURCE_HOST'].Trim('"', "'") $ep
  Add-Row 'TCP to the ERP warehouse' $(if ($ok) { 'PASS' } else { 'WARN' }) $(if ($ok) { 'reachable' } else { 'not reachable' })
}

# ---------------------------------------------------------------- output
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
$outTxt = Join-Path $OutDir ("ckam_precheck_app_{0}_{1}.txt" -f $env:COMPUTERNAME, $stamp)
$table = $rows | Format-Table -AutoSize -Wrap | Out-String -Width 220
$summary = "PASS={0} WARN={1} FAIL={2} INFO={3}" -f @($rows | Where-Object Result -eq 'PASS').Count, @($rows | Where-Object Result -eq 'WARN').Count, @($rows | Where-Object Result -eq 'FAIL').Count, @($rows | Where-Object Result -eq 'INFO').Count
Set-Content -LiteralPath $outTxt -Value ($table + "`r`n" + $summary + "`r`nNo secret value is in this file (lengths, counts and yes/no only).") -Encoding UTF8
$table
Write-Host $summary -ForegroundColor Cyan
Write-Host "Report written to: $outTxt" -ForegroundColor Cyan
Write-Host 'Nothing was changed on this server.' -ForegroundColor Green
