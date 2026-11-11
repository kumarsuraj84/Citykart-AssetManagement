# CKAM production: point the ERP reader at the new ERP host 10.0.0.82 (PO_SOURCE_HOST only), restart CKAM, check health and the first ERP copy.
# Same release (0df67d3), no schema change. The old settings file is kept in the evidence folder until the owner has seen the result.
# If CKAM does not come back healthy, the old settings are put back. No secret is printed.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$ev = 'D:\CKAM_EVIDENCE_20261017_111445\erp_host_20261111'
$envPath = "$root\shared\.env"
$newHost = '10.0.0.82'
New-Item -ItemType Directory -Force $ev | Out-Null
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
}

$raw = [IO.File]::ReadAllText($envPath)
$oldHost = (Get-Key $raw 'PO_SOURCE_HOST').Trim()
"before: PO_SOURCE_HOST = $oldHost ; PO_SOURCE_DB = $((Get-Key $raw 'PO_SOURCE_DB').Trim()) ; PO_SOURCE_USER = $((Get-Key $raw 'PO_SOURCE_USER').Trim()) ; APP_VERSION = $((Get-Key $raw 'APP_VERSION').Trim())"
if ($oldHost -eq $newHost) { 'nothing to do: already pointing at the new host'; exit 0 }
try { $new = Set-Key $raw 'PO_SOURCE_HOST' $newHost } catch { "STOP: $($_.Exception.Message)"; exit 2 }
Copy-Item $envPath "$ev\env.before-erp-host" -Force        # holds live secrets: deleted after the owner has seen the result
$t0 = (Get-Date).ToUniversalTime()

Stop-Ckam
Save-Env $new
$b = [IO.File]::ReadAllBytes($envPath)
"BOM present: $($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)  (must be False)"
"PO_SOURCE_HOST now: $((Get-Key (Get-Content $envPath -Raw) 'PO_SOURCE_HOST').Trim())"
"=== start $(Get-Date -Format 'HH:mm:ss')"
Start-ScheduledTask -TaskName 'CKAM-Web'
if (-not (Wait-Health)) {
  '!!! CKAM not healthy -> putting the old settings back'
  Save-Env $raw; Start-ScheduledTask -TaskName 'CKAM-Web'
  if (Wait-Health) { 'STATE: old settings back, CKAM serving; exit=1' } else { 'STATE: CKAM IS DOWN; exit=1' }
  exit 1
}
$j = (Select-String -Path "$root\logs\app\app.jsonl" -Pattern 'app_started' | Select-Object -Last 1).Line | ConvertFrom-Json
"app_started: ts=$($j.ts) version=$($j.details.version) migration_matches=$($j.details.migration.matches)"
"=== waiting for the first ERP copy (up to 3 minutes)"
$done = $false
for ($i = 1; $i -le 36 -and -not $done; $i++) {
  Start-Sleep 5
  $lines = Select-String -Path "$root\logs\app\app.jsonl" -Pattern 'sync_success|sync_failed' | Select-Object -Last 3
  foreach ($l in $lines) {
    try { $e = $l.Line | ConvertFrom-Json } catch { continue }
    if ([datetime]::Parse($e.ts).ToUniversalTime() -ge $t0) {
      $d = $e.details
      "ERP copy: $($e.ts) $($e.event) trigger=$($d.trigger) po_lines_new=$($d.po_lines_new) changed=$($d.po_lines_changed) gone=$($d.po_lines_gone) vendors=$($d.vendors) items=$($d.items) source_stamp=$($d.source_stamp) seconds=$($d.seconds)"
      if ($e.event -eq 'sync_failed') { "reason: $((($d.message) -as [string]) -replace '\s+',' ')" }
      $done = $true
    }
  }
}
if (-not $done) { 'no ERP copy result within 3 minutes (the copy may still be running)' }
$err = Get-ChildItem "$root\logs" -Filter 'ckam-web_*.err.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
"stderr log size $($err.Length); Refusing/Traceback hits: $(@(Select-String -Path $err.FullName -Pattern 'Refusing to start|Traceback').Count)"
"health: " + (& curl.exe -s --max-time 5 http://127.0.0.1:3211/api/health)
