# Release 0b8c525: the checks that need no sign-in. Read-only HTTP requests; bodies discarded.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$ev = 'D:\CKAM_EVIDENCE_20261017_111445\release_0b8c525'
$rel = "$root\releases\0b8c525"
$B = 'http://127.0.0.1:3211'
"=== verify_release.ps1 (server, elevated) $(Get-Date -Format 'HH:mm:ss')"
& powershell -NoProfile -ExecutionPolicy Bypass -File "$rel\ops\windows\verify_release.ps1" -BaseUrl $B -ExpectedRelease 0b8c525 -ReleaseDir $rel -LauncherLogDir "$root\logs" -IncludeUncProbe -LocalProcessCheck Require -OutCsv "$ev\verify_server.csv" 2>&1 | ForEach-Object { "$_" } | Select-String -Pattern 'FAIL|WARN|checks:|uvicorn flags|release in bundle|bundle from|Server header|docs closed' | ForEach-Object { $_.Line }
"verify exit code: $LASTEXITCODE   (0 = no FAIL)"
$paths = @('/assets/..%2f..%2f..%2f..%2fshared%2f.env', '/assets/..%2f..%2f..%2f..%2fshared%2fnas.pw', '/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fshared%2f.env',
  '/assets/%252e%252e%252f%252e%252e%252fshared%252f.env', '/assets/..%5c..%5c..%5c..%5cshared%5c.env', '/assets/C:%5cWindows%5cwin.ini', '/assets/%5c%5cserver%5cshare%5cx',
  '/assets/CON', '/assets/NUL', '/assets/index.html::$DATA', '/assets/../shared/.env')
$rows = foreach ($p in $paths) { [pscustomobject]@{ path = $p; status = (& curl.exe -s -o NUL -w '%{http_code}' --path-as-is --max-time 10 "$B$p") } }
"IF-01 probes: $($rows.Count); any non-404: $(@($rows | Where-Object { $_.status -ne '404' }).Count)"
"QR links: /assets/1 -> $(& curl.exe -s -o NUL -w '%{http_code}' $B/assets/1) ; /assets/new -> $(& curl.exe -s -o NUL -w '%{http_code}' $B/assets/new)"
"unauthenticated /api/erp/pos -> $(& curl.exe -s -o NUL -w '%{http_code}' "$B/api/erp/pos?envelope=true&only_linked=true")  (401 expected: the list needs a sign-in)"
"served bundle: " + ((& curl.exe -s $B/) -match 'index-BJmT-4C3\.js')
"ERP sync since start:"
Select-String -Path "$root\logs\app\app.jsonl" -Pattern 'sync_success|sync_failed' | Select-Object -Last 2 | ForEach-Object { try { $j = $_.Line | ConvertFrom-Json; "  $($j.ts) $($j.level) $($j.event)" } catch {} }
