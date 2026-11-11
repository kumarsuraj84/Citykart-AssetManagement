# CKAM production reset, step 1 of 4: stop CKAM (only its own python process) and look at what lives outside the database.
# Run on the APP SERVER (10.0.1.98). Changes nothing except stopping CKAM-Web. Prints no secret.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$envPath = "$root\shared\.env"
function Get-Key([string]$text, [string]$k) { ([regex]::Match($text, "(?m)^\s*$k\s*=([^\r\n]*)")).Groups[1].Value }
$raw = [IO.File]::ReadAllText($envPath)
"=== reset step 1 (app server) $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
"release now: APP_VERSION=$((Get-Key $raw 'APP_VERSION').Trim()); dist=$((Get-Key $raw 'FRONTEND_DIST_DIR').Trim())"
"health before: " + (& curl.exe -s --max-time 5 http://127.0.0.1:3211/api/health)

Stop-ScheduledTask -TaskName 'CKAM-Web'; Start-Sleep 3
foreach ($p in @((Get-NetTCPConnection -LocalPort 3211 -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique)) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p"
  if ($proc.ExecutablePath -like "$root\shared\venv\*" -and $proc.CommandLine -like '*app.main:app*') { Stop-Process -Id $p -Force; "stopped CKAM python PID $p" } else { "NOT touching PID $p (not CKAM)" }
}
Start-Sleep 3
"listeners on 3211: $(@(Get-NetTCPConnection -LocalPort 3211 -State Listen -ErrorAction SilentlyContinue).Count) (0 expected)"
"CKAM-Web task state: $((Get-ScheduledTask -TaskName 'CKAM-Web').State)"

# files kept outside the database (asset documents on the NAS): counted, never deleted by this kit
$upload = (Get-Key $raw 'UPLOAD_DIR').Trim()
if ($upload -and (Test-Path $upload)) {
  $files = @(Get-ChildItem -LiteralPath $upload -Recurse -File -ErrorAction SilentlyContinue)
  "uploaded documents folder: $($files.Count) files, $([math]::Round((($files | Measure-Object Length -Sum).Sum)/1MB,2)) MB   (left as they are; after a reset their database records are gone)"
} else { "uploaded documents folder: not reachable or not set ($upload)" }
'CKAM is STOPPED. People see an error page until step 4. Next: step 2 on the database server (the owner runs it).'
