# Read-only compromise review of the COPIED logs (evidence folder). Writes nothing outside a small summary file in the evidence folder.
$d = 'D:\CKAM_EVIDENCE_20261017_111445\ckam_all_logs_folder\app'
$out = 'D:\CKAM_EVIDENCE_20261017_111445\compromise_review_app_logs.txt'
$rows = New-Object System.Collections.Generic.List[object]
foreach ($f in 'app.jsonl', 'error.jsonl') {
  foreach ($l in (Get-Content "$d\$f")) { try { $o = $l | ConvertFrom-Json; $o | Add-Member -NotePropertyName src -NotePropertyValue $f -Force; $rows.Add($o) } catch { } }
}
$acc = @($rows | Where-Object { $_.kind -eq 'access' -and $_.src -eq 'app.jsonl' })
"log window: $($rows[0].ts)  ->  $(($rows | Select-Object -Last 1).ts)   lines: $($rows.Count)   access lines: $($acc.Count)"
"--- restarts (app_started events)"
$rows | Where-Object { $_.event -eq 'app_started' } | ForEach-Object { "  $($_.ts)  version $($_.details.version)" }
"--- client addresses (count of requests)"
$acc | Group-Object ip | Sort-Object Count -Descending | ForEach-Object { "  {0,6}  {1}" -f $_.Count, $_.Name }
"--- status codes"
$acc | Group-Object status | Sort-Object Name | ForEach-Object { "  {0}: {1}" -f $_.Name, $_.Count }
"--- suspicious paths (traversal chars, drive letters, secrets, scripts, config)"
$susp = @($acc | Where-Object { $_.path -match '\.\.|%2e|%2f|%5c|\\|:|\.env|nas\.pw|shared|win\.ini|passwd|\.ps1|\.py|config|backend|%00|\$DATA' })
"  count: $($susp.Count)"
$susp | Select-Object -First 30 | ForEach-Object { "  {0} ip={1} {2} {3} -> {4} ({5} bytes)" -f $_.ts, $_.ip, $_.method, $_.path, $_.status, $_.bytes }
"--- /assets/ requests: distinct paths with status (bundle files collapsed)"
$as = @($acc | Where-Object { $_.path -like '/assets/*' })
"  total /assets/ requests: $($as.Count)"
$as | Group-Object { if ($_.path -match '^/assets/(index|[A-Za-z0-9_-]+)-[A-Za-z0-9_-]{6,}\.(js|css|woff2?|svg|png)$') { 'static bundle file' } else { $_.path } }, status | Sort-Object Count -Descending | Select-Object -First 25 | ForEach-Object { "  {0,5}  {1}" -f $_.Count, $_.Name }
"--- responses larger than 1 MB (possible file downloads)"
$acc | Where-Object { $_.bytes -gt 1048576 } | ForEach-Object { "  {0} ip={1} {2} {3} -> {4} ({5} bytes)" -f $_.ts, $_.ip, $_.method, $_.path, $_.status, $_.bytes }
"--- sign-in related events (non-access)"
$rows | Where-Object { $_.kind -ne 'access' -and ($_.msg -match 'sign|login|logout|password|token|auth' -or $_.component -match 'auth') } | Group-Object level, component, event | Sort-Object Count -Descending | Select-Object -First 15 | ForEach-Object { "  {0,5}  {1}" -f $_.Count, $_.Name }
"--- 401/403 by route"
$acc | Where-Object { $_.status -in 401, 403 } | Group-Object route, path, status | Sort-Object Count -Descending | Select-Object -First 15 | ForEach-Object { "  {0,5}  {1}" -f $_.Count, $_.Name }
"--- 5xx"
$acc | Where-Object { $_.status -ge 500 } | ForEach-Object { "  $($_.ts) $($_.path) $($_.status)" }
"--- error.jsonl by level/logger/kind"
$rows | Where-Object { $_.src -eq 'error.jsonl' } | Group-Object level, logger, kind | Sort-Object Count -Descending | Select-Object -First 10 | ForEach-Object { "  {0,5}  {1}" -f $_.Count, $_.Name }
