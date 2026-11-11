# Release 0df67d3, step 0: read-only look at the app server. Changes nothing, prints no secret.
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
foreach ($k in 'APP_VERSION', 'FRONTEND_DIST_DIR') {
  $l = Get-Content "$root\shared\.env" | Where-Object { $_ -match "^\s*$k\s*=" } | Select-Object -First 1
  "$l"
}
"health: " + (& curl.exe -s --max-time 5 http://127.0.0.1:3211/api/health)
"task: " + (Get-ScheduledTask -TaskName CKAM-Web).State
"releases: " + ((Get-ChildItem "$root\releases" -Directory | Select-Object -ExpandProperty Name) -join ', ')
"staging folders: " + ((Get-ChildItem "$root\backup" -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ', ')
$d = Get-PSDrive D
"free space on D: $([math]::Round($d.Free/1GB,1)) GB"
"python: " + (& "$root\shared\venv\Scripts\python.exe" --version)
"evidence folder exists: " + (Test-Path 'D:\CKAM_EVIDENCE_20261017_111445')
