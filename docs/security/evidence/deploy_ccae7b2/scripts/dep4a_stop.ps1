# F0 final log top-up + F1 stop CKAM only. CKAM IS DOWN AFTER THIS SCRIPT.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$ev = 'D:\CKAM_EVIDENCE_20261017_111445'
"stop started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
robocopy "$root\logs" "$ev\logs-at-stop" /E /COPY:DAT /R:1 /W:1 /NP /NFL /NDL | Out-Null
"log top-up robocopy exit: $LASTEXITCODE (0-7 = success)"
Get-ChildItem "$ev\logs-at-stop" -Recurse -File | Get-FileHash -Algorithm SHA256 | Export-Csv "$ev\logs-at-stop.sha256.csv" -NoTypeInformation
Stop-ScheduledTask -TaskName 'CKAM-Web'
Start-Sleep 3
$pids = @((Get-NetTCPConnection -LocalPort 3211 -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique)
foreach ($p in $pids) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p"
  "listener PID $p : $($proc.ExecutablePath) : $($proc.CommandLine)"
  if ($proc.ExecutablePath -like "$root\shared\venv\*" -and $proc.CommandLine -like '*app.main:app*') {
    Stop-Process -Id $p -Force
    "stopped CKAM python PID $p"
  } else { "NOT touching PID $p (not CKAM's venv process)" }
}
Start-Sleep 3
"listeners on 3211 now: $(@(Get-NetTCPConnection -LocalPort 3211 -State Listen -ErrorAction SilentlyContinue).Count)"
"task state: $((Get-ScheduledTask -TaskName 'CKAM-Web').State)"
