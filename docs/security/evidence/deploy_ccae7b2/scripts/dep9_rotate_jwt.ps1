# Rotate JWT_SECRET: generate on the server, write to shared\.env WITHOUT printing, restart CKAM-Web, validate. No secret is printed.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$ev = 'D:\CKAM_EVIDENCE_20261017_111445'
$py = "$root\shared\venv\Scripts\python.exe"
$envPath = "$root\shared\.env"
"rotation started: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
$raw = [IO.File]::ReadAllText($envPath)
$cnt = ([regex]::Matches($raw, '(?m)^\s*JWT_SECRET\s*=')).Count
if ($cnt -ne 1) { "STOP: JWT_SECRET lines = $cnt"; exit 2 }
$old = ([regex]::Match($raw, '(?m)^\s*JWT_SECRET\s*=([^\r\n]*)')).Groups[1].Value.Trim()
$new = (& $py -c "import secrets; print(secrets.token_hex(32))" | Out-String).Trim()
if ($new.Length -ne 64 -or $new -notmatch '^[0-9a-f]{64}$') { 'STOP: generation failed'; exit 2 }
if ($new -eq $old) { 'STOP: new equals old'; exit 2 }
# backup of the file as it is now (holds the OLD secrets; deleted at the end of the rotations)
Copy-Item $envPath "$ev\env.before-jwt-rotation" -Force
$raw2 = [regex]::Replace($raw, '(?m)^(\s*JWT_SECRET\s*=)[^\r\n]*', { param($m) $m.Groups[1].Value + $new }.GetNewClosure())
[IO.File]::WriteAllText($envPath, $raw2, (New-Object Text.UTF8Encoding($false)))
Remove-Variable old, raw, raw2
# checks without printing
$line = @(Get-Content $envPath | Where-Object { $_ -match '^\s*JWT_SECRET\s*=' })
$v = ($line[0] -replace '^\s*JWT_SECRET\s*=\s*', '').Trim()
$set = New-Object 'System.Collections.Generic.HashSet[char]'; foreach ($c in $v.ToCharArray()) { [void]$set.Add($c) }
"JWT lines=$($line.Count) length>=32=$($v.Length -ge 32) distinct>=8=$($set.Count -ge 8) quoted=$(($v.Length -gt 0) -and (($v[0] -eq [char]34) -or ($v[0] -eq [char]39))) equals-new=$($v -eq $new)"
Remove-Variable v, line, set, new
$b = [IO.File]::ReadAllBytes($envPath)
"BOM present: $($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)  (must be False)"
"other keys intact: " + ((Get-Content $envPath | Where-Object { $_ -match '^\s*[A-Za-z_]+\s*=' } | ForEach-Object { ($_ -split '=',2)[0].Trim() }) -join ', ')
# restart CKAM only
Stop-ScheduledTask -TaskName 'CKAM-Web'; Start-Sleep 3
foreach ($p in @((Get-NetTCPConnection -LocalPort 3211 -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique)) {
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$p"
  if ($proc.ExecutablePath -like "$root\shared\venv\*" -and $proc.CommandLine -like '*app.main:app*') { Stop-Process -Id $p -Force; "stopped CKAM python PID $p" } else { "NOT touching PID $p" }
}
Start-Sleep 3
"listeners after stop: $(@(Get-NetTCPConnection -LocalPort 3211 -State Listen -ErrorAction SilentlyContinue).Count)"
Start-ScheduledTask -TaskName 'CKAM-Web'
$up = $false
for ($i = 1; $i -le 24; $i++) { Start-Sleep 5; $h = & curl.exe -s --max-time 4 http://127.0.0.1:3211/api/health; if ($h -match '"ok"') { $up = $true; "health after $($i*5) s: $h"; break } }
if (-not $up) { 'NOT HEALTHY after 120 s' }
$err = Get-ChildItem "$root\logs" -Filter 'ckam-web_*.err.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
"newest err log: $($err.Name) size $($err.Length); 'Refusing to start' hits: $(@(Select-String -Path $err.FullName -Pattern 'Refusing to start').Count)"
$ll = Get-ChildItem "$root\logs" -Filter 'ckam-web_*.launcher.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Get-Content $ll.FullName | Select-String 'serving release|NAS mapping' | ForEach-Object { $_.Line }
$ev1 = Select-String -Path "$root\logs\app\app.jsonl" -Pattern 'app_started' | Select-Object -Last 1
$j = $ev1.Line | ConvertFrom-Json
"app_started: ts=$($j.ts) version=$($j.details.version) env=$($j.details.environment) jwt_placeholder=$($j.details.config.jwt_signing_key_is_placeholder) jwt_long_enough=$($j.details.config.jwt_signing_key_long_enough) migration_matches=$($j.details.migration.matches) db_host=$($j.details.config.database_host)"
"rotation finished: $(Get-Date -Format 'HH:mm:ss')"
