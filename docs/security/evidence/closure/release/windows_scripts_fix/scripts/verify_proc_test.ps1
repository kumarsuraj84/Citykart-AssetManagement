# Tests verify_release.ps1's new local-process check (-LocalProcessCheck) against a FAKE local listener whose
# command line does / does not carry the uvicorn flags. Only 127.0.0.1:3998 is used. The other verify rows FAIL
# against the fake listener by design (it is not CKAM); only the "uvicorn flags (local process)" row is judged here.
param(
    [string]$Work = 'C:\Users\User2\AppData\Local\Temp\claude\D--ANKUR-AI-PROJECTS-Asset-Management\33a6302e-4441-4084-94a5-472d20016684\scratchpad\sec\winfix\ps',
    [string]$OutDir = (Split-Path -Parent $PSScriptRoot)
)
$ErrorActionPreference = 'Continue'
$verify = Join-Path $Work 'parsed\verify_release.ps1'
$fake = Join-Path $PSScriptRoot 'fake_uvicorn.ps1'
$port = 3998
if (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count) { throw "port $port is in use" }
$good = "python -m uvicorn app.main:app --host 127.0.0.1 --port $port --no-proxy-headers --no-server-header"
$cases = @(
    @('V1', $good, 'Auto', 'PASS'),
    @('V2', "python -m uvicorn app.main:app --host 127.0.0.1 --port $port --no-proxy-headers", 'Auto', 'FAIL'),
    @('V3', "python -m uvicorn app.main:app --host 127.0.0.1 --port $port --proxy-headers --no-server-header", 'Auto', 'FAIL'),
    @('V4', "python -m uvicorn app.main:app --host 127.0.0.1 --port $port --no-proxy-headers --no-server-header --workers 4", 'Auto', 'FAIL'),
    @('V5', 'some-other-server --port 3998', 'Auto', 'SKIP'),
    @('V6', 'some-other-server --port 3998', 'Require', 'FAIL'),
    @('V7', $good, 'Skip', 'SKIP')
)
$lines = New-Object System.Collections.Generic.List[string]
$rows = foreach ($c in $cases) {
    $proc = Start-Process -FilePath powershell.exe -PassThru -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$fake`"", '-Port', "$port", '-Seconds', '90', '-Tag', "`"$($c[1])`"")
    $t = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $t -and -not @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count) { Start-Sleep -Milliseconds 200 }
    $csv = Join-Path $Work "verify_$($c[0]).csv"
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $verify -BaseUrl "http://127.0.0.1:$port" -LocalProcessCheck $c[2] -TimeoutSeconds 5 -OutCsv $csv 2>&1 | ForEach-Object { "$_" }
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    $t = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $t -and @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count) { Start-Sleep -Milliseconds 200 }
    $row = Import-Csv -LiteralPath $csv | Where-Object { $_.Check -eq 'uvicorn flags (local process)' }
    $lines.Add("===== $($c[0]): listener command line tag '$($c[1])', -LocalProcessCheck $($c[2]), expected $($c[3])")
    $lines.Add("row: $($row.Result) - $($row.Detail)")
    $lines.Add(($out | Select-Object -Last 1))
    [pscustomobject]@{ Case = $c[0]; LocalProcessCheck = $c[2]; Expected = $c[3]; Actual = $row.Result; Verdict = $(if ($row.Result -eq $c[3]) { 'PASS' } else { 'FAIL' }); Detail = $row.Detail }
}
[System.IO.File]::WriteAllLines((Join-Path $OutDir 'verify_process_check.transcript.txt'), $lines, (New-Object System.Text.UTF8Encoding($false)))
$rows | Export-Csv -LiteralPath (Join-Path $OutDir 'verify_process_check.csv') -NoTypeInformation -Encoding UTF8
$rows | Format-Table Case, LocalProcessCheck, Expected, Actual, Verdict, Detail -AutoSize -Wrap | Out-String -Width 220
"cases: $(@($rows).Count); PASS: $(@($rows | Where-Object Verdict -eq 'PASS').Count); FAIL: $(@($rows | Where-Object Verdict -eq 'FAIL').Count)"
"listener left on $port : $(@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).Count)"
