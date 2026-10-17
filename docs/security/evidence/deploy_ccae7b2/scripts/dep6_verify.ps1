# Step H checks that need no sign-in. Read-only HTTP requests; bodies discarded.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$ev = 'D:\CKAM_EVIDENCE_20261017_111445'
$rel = "$root\releases\ccae7b2"
$B = 'http://127.0.0.1:3211'
"=== H4 verify_release.ps1 (server, elevated) $(Get-Date -Format 'HH:mm:ss')"
& powershell -NoProfile -ExecutionPolicy Bypass -File "$rel\ops\windows\verify_release.ps1" -BaseUrl $B -ExpectedRelease ccae7b2 -ReleaseDir $rel -LauncherLogDir "$root\logs" -IncludeUncProbe -LocalProcessCheck Require -OutCsv "$ev\verify_server.csv" 2>&1 | ForEach-Object { "$_" }
"verify exit code: $LASTEXITCODE   (0 = no FAIL)"

"=== H5 IF-01 Windows probe list"
$paths = @(
 '/assets/..%2f..%2f..%2f..%2fshared%2f.env',
 '/assets/..%2f..%2f..%2f..%2fshared%2fnas.pw',
 '/assets/..%2f..%2f..%2f..%2fshared%2frun_ckam_web.ps1',
 '/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fshared%2f.env',
 '/assets/%252e%252e%252f%252e%252e%252fshared%252f.env',
 '/assets/..%5c..%5c..%5c..%5cshared%5c.env',
 '/assets/%2e%2e%5c%2e%2e%5cshared%5c.env',
 '/assets/C:%2fWindows%2fwin.ini',
 '/assets/C:%5cWindows%5cwin.ini',
 '/assets/%5c%5cserver%5cshare%5cx',
 '/assets/CON',
 '/assets/NUL',
 '/assets/index.html::$DATA',
 '/assets/../shared/.env',
 '/assets/..\..\shared\.env')
$paths | Set-Content "$ev\if01_paths.txt" -Encoding ASCII
$rows = foreach ($p in $paths) { $code = & curl.exe -s -o NUL -w '%{http_code}' --path-as-is --max-time 10 "$B$p"; [pscustomobject]@{ path = $p; status = $code } }
$rows | Format-Table -AutoSize | Out-String -Width 200
$rows | Export-Csv "$ev\if01_probe_results_server.csv" -NoTypeInformation
"Any non-404: " + (@($rows | Where-Object { $_.status -ne '404' }).Count)

"=== H6 API docs"
foreach ($u in '/openapi.json', '/docs', '/redoc') { "{0}: {1}" -f $u, (& curl.exe -s -o NUL -w '%{http_code}' $B$u) }
"openapi body: " + (& curl.exe -s $B/openapi.json)
"=== H7 unknown API path"
& curl.exe -s -D - $B/api/does-not-exist
""
"=== H8 headers (health, then /)"
& curl.exe -s -D - -o NUL $B/api/health
"--"
& curl.exe -s -D - -o NUL $B/
"=== H9 forged address"
& curl.exe -s -H 'X-Forwarded-For: 203.0.113.77' $B/api/health | Out-Null
Start-Sleep 2
"log lines carrying the forged address as client ip: $(@(Select-String -Path "$root\logs\app\app.jsonl" -Pattern '"ip": "203\.0\.113\.77"').Count)"
"=== H10 QR deep link"
foreach ($u in '/assets/1', '/assets/new', '/assets/12345') { "{0}: {1}" -f $u, (& curl.exe -s -o NUL -w '%{http_code} %{content_type}' $B$u) }
"=== H11 bundle"
"index-Cp5JgQR-.js served: " + ((& curl.exe -s $B/) -match 'index-Cp5JgQR-\.js')
