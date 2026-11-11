# CKAM production reset, step 4 of 4: start CKAM on the empty database and check it. Run on the APP SERVER (10.0.1.98) after step 3.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
"=== reset step 4 (app server) $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
$t0 = (Get-Date).ToUniversalTime()
Start-ScheduledTask -TaskName 'CKAM-Web'
$healthy = $false
for ($i = 1; $i -le 24 -and -not $healthy; $i++) { Start-Sleep 5; if ((& curl.exe -s --max-time 4 http://127.0.0.1:3211/api/health) -match '"ok"') { "healthy after $($i*5) s"; $healthy = $true } }
if (-not $healthy) { 'CKAM did not become healthy in 2 minutes: check the logs under ' + "$root\logs"; exit 1 }
$j = (Select-String -Path "$root\logs\app\app.jsonl" -Pattern 'app_started' | Select-Object -Last 1).Line | ConvertFrom-Json
"app_started: version=$($j.details.version) migration_matches=$($j.details.migration.matches) database_host=$($j.details.config.database_host)"
"=== the ERP copy (it refills by itself; up to 3 minutes)"
$done = $false
for ($i = 1; $i -le 36 -and -not $done; $i++) {
  Start-Sleep 5
  foreach ($l in (Select-String -Path "$root\logs\app\app.jsonl" -Pattern 'sync_success|sync_failed' | Select-Object -Last 3)) {
    try { $e = $l.Line | ConvertFrom-Json } catch { continue }
    if ([datetime]::Parse($e.ts).ToUniversalTime() -ge $t0) { $d = $e.details; "ERP copy: $($e.event) trigger=$($d.trigger) po_lines_new=$($d.po_lines_new) vendors=$($d.vendors) items=$($d.items) sites=$($d.sites)"; $done = $true }
  }
}
if (-not $done) { 'no ERP copy result yet (it can take longer; check Settings > ERP Data Sync, or use Refresh now)' }
$err = Get-ChildItem "$root\logs" -Filter 'ckam-web_*.err.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
"stderr log size $($err.Length); Refusing/Traceback hits: $(@(Select-String -Path $err.FullName -Pattern 'Refusing to start|Traceback').Count)"
"unauthenticated /api/assets -> $(& curl.exe -s -o NUL -w '%{http_code}' http://127.0.0.1:3211/api/assets)  (401 expected)"
'CKAM is running on the empty database. Next, for the owner:'
'  1. Open the admin-only file named by step 3 and read the one-time password of "Admin".'
'  2. Sign in as Admin, choose a new password when asked, then DELETE that file.'
'  3. Settings > Organisation > Companies > Add from the ERP; then Places; then People & Places > Stores > Stores from ERP.'
