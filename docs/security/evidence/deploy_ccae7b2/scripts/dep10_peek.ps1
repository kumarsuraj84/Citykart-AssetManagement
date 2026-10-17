# Read-only: sizes and line formats of the copied logs (first lines only, to learn the format).
$d = 'D:\CKAM_EVIDENCE_20261017_111445\ckam_all_logs_folder'
Get-ChildItem $d -Recurse -File | Select-Object @{n='Name';e={$_.FullName.Substring($d.Length+1)}}, Length | Format-Table -AutoSize | Out-String -Width 200
"--- out.log sample (newest file, 3 lines)"
Get-Content "$d\ckam-web_20261014_141335.out.log" -TotalCount 6
"--- app.jsonl first 2 lines (truncated)"
Get-Content "$d\app\app.jsonl" -TotalCount 2 | ForEach-Object { $_.Substring(0, [Math]::Min(500, $_.Length)) }
"--- app.jsonl access-type line sample"
Get-Content "$d\app\app.jsonl" | Where-Object { $_ -like '*"method"*' } | Select-Object -First 2 | ForEach-Object { $_.Substring(0, [Math]::Min(600, $_.Length)) }
