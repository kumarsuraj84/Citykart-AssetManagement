# Read-only: summarise app logs since the restart (levels, components, ERP sync). Prints no message bodies beyond event names.
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$logs = "$root\logs\app"
Get-ChildItem $logs | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize | Out-String
foreach ($f in 'app.jsonl', 'error.jsonl') {
  $p = "$logs\$f"
  if (-not (Test-Path $p)) { "$f : absent"; continue }
  $rows = Get-Content $p | Where-Object { $_ -like '*"ts": "2026-10-17T05:5*' -or $_ -like '*"ts": "2026-10-17T06:*' } | ForEach-Object { try { $_ | ConvertFrom-Json } catch { $null } } | Where-Object { $_ }
  "== $f since restart: $($rows.Count) lines"
  $rows | Group-Object level, component, event | Sort-Object Count -Descending | Select-Object -First 12 | ForEach-Object { "{0,5}  {1}" -f $_.Count, $_.Name }
}
"== ERP sync events"
Get-Content "$logs\app.jsonl" | Where-Object { $_ -like '*erp_sync*' } | Select-Object -Last 3 | ForEach-Object { try { $j = $_ | ConvertFrom-Json; "{0} {1} {2} {3}" -f $j.ts, $j.level, $j.event, $j.msg } catch { } }
