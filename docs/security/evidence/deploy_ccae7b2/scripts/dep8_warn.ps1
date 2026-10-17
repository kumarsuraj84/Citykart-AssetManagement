# Read-only: show WARNING/ERROR lines written since the restart (timestamps after 05:50 UTC).
$logs = 'D:\Citykart_Applications\Citykart_AssetManagement_App\logs\app'
foreach ($f in 'app.jsonl', 'error.jsonl') {
  "== $f"
  Get-Content "$logs\$f" | Where-Object { $_ -match '"ts": "2026-10-17T05:(5\d|6\d)' -or $_ -match '"ts": "2026-10-17T0[6-9]' } | Where-Object { $_ -match '"level": "(WARNING|ERROR|CRITICAL)"' } | ForEach-Object { $_.Substring(0, [Math]::Min(900, $_.Length)) }
}
