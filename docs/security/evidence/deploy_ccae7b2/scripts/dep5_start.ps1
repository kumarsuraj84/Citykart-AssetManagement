# G1 install reviewed launcher, G2 start CKAM-Web, G3 check process flags and logs.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$ev = 'D:\CKAM_EVIDENCE_20261017_111445'
$rel = "$root\releases\ccae7b2"
"launcher sha256 BEFORE: $((Get-FileHash "$root\shared\run_ckam_web.ps1" -Algorithm SHA256).Hash)"
Copy-Item "$rel\ops\windows\run_ckam_web.ps1.template" "$root\shared\run_ckam_web.ps1" -Force
"launcher sha256 AFTER : $((Get-FileHash "$root\shared\run_ckam_web.ps1" -Algorithm SHA256).Hash)"
"--- WhatIf of the installed launcher"
& powershell -NoProfile -ExecutionPolicy Bypass -File "$root\shared\run_ckam_web.ps1" -WhatIf -LogDir "$root\precheck\launcher_dry_logs" 2>&1 | ForEach-Object { "$_" } | Select-String 'serving release|release id|starting:'
"--- starting task $(Get-Date -Format 'HH:mm:ss')"
Start-ScheduledTask -TaskName 'CKAM-Web'
$up = $false
for ($i = 1; $i -le 24; $i++) {
  Start-Sleep 5
  $h = & curl.exe -s --max-time 4 http://127.0.0.1:3211/api/health
  if ($h -match '"ok"') { $up = $true; "health after $($i*5) s: $h"; break }
}
if (-not $up) { 'NOT HEALTHY after 120 s' }
"listeners on 3211: $(@(Get-NetTCPConnection -LocalPort 3211 -State Listen -ErrorAction SilentlyContinue).Count)"
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*app.main:app*' } | ForEach-Object { "PID $($_.ProcessId) : $($_.ExecutablePath) : $($_.CommandLine)" }
$ll = Get-ChildItem "$root\logs" -Filter 'ckam-web_*.launcher.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
"launcher log: $($ll.Name)"
Get-Content $ll.FullName | Select-String 'serving release|release id|NAS mapping attempt|starting:|WARNING' | ForEach-Object { $_.Line }
$err = Get-ChildItem "$root\logs" -Filter 'ckam-web_*.err.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
"stderr log: $($err.Name)  size $($err.Length)"
"Refusing/Traceback hits: $(@(Select-String -Path $err.FullName -Pattern 'Refusing to start|Traceback' ).Count)"
$z = "$root\logs\app\app.jsonl"
"--- last app_started event (fields only)"
Select-String -Path $z -Pattern 'app_started' | Select-Object -Last 1 | ForEach-Object { $_.Line }
