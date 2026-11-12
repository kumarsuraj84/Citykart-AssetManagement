# Release 9c95b1f: the checks that need no sign-in. Read-only HTTP requests; bodies discarded.
$ErrorActionPreference = 'Continue'
$root = 'D:\Citykart_Applications\Citykart_AssetManagement_App'
$ev = 'D:\CKAM_EVIDENCE_20261017_111445\release_9c95b1f'
$rel = "$root\releases\9c95b1f"
$B = 'http://127.0.0.1:3211'
"=== verify_release.ps1 (server, elevated) $(Get-Date -Format 'HH:mm:ss')"
& powershell -NoProfile -ExecutionPolicy Bypass -File "$rel\ops\windows\verify_release.ps1" -BaseUrl $B -ExpectedRelease 9c95b1f -ReleaseDir $rel -LauncherLogDir "$root\logs" -IncludeUncProbe -LocalProcessCheck Require -OutCsv "$ev\verify_server.csv" 2>&1 | ForEach-Object { "$_" } | Select-String -Pattern 'FAIL|WARN|checks:|uvicorn flags|release in bundle|bundle from|Server header|docs closed' | ForEach-Object { $_.Line }
"verify exit code: $LASTEXITCODE   (0 = no FAIL)"
$paths = @('/assets/..%2f..%2f..%2f..%2fshared%2f.env', '/assets/..%2f..%2f..%2f..%2fshared%2fnas.pw', '/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fshared%2f.env',
  '/assets/%252e%252e%252f%252e%252e%252fshared%252f.env', '/assets/..%5c..%5c..%5c..%5cshared%5c.env', '/assets/C:%5cWindows%5cwin.ini', '/assets/%5c%5cserver%5cshare%5cx',
  '/assets/CON', '/assets/NUL', '/assets/index.html::$DATA', '/assets/../shared/.env')
$rows = foreach ($p in $paths) { [pscustomobject]@{ path = $p; status = (& curl.exe -s -o NUL -w '%{http_code}' --path-as-is --max-time 10 "$B$p") } }
"IF-01 probes: $($rows.Count); any non-404: $(@($rows | Where-Object { $_.status -ne '404' }).Count)"
"QR links: /assets/1 -> $(& curl.exe -s -o NUL -w '%{http_code}' $B/assets/1) ; /assets/new -> $(& curl.exe -s -o NUL -w '%{http_code}' $B/assets/new) ; /repairs -> $(& curl.exe -s -o NUL -w '%{http_code}' $B/repairs)"
"unauthenticated /api/repairs -> $(& curl.exe -s -o NUL -w '%{http_code}' "$B/api/repairs")  (401 expected: needs a sign-in)"
"unauthenticated /api/assets -> $(& curl.exe -s -o NUL -w '%{http_code}' "$B/api/assets")  (401 expected)"
"served bundle: " + ((& curl.exe -s $B/) -match 'index-D1eiexF1\.js')
"ERP sync since start:"
Select-String -Path "$root\logs\app\app.jsonl" -Pattern 'sync_success|sync_failed' | Select-Object -Last 2 | ForEach-Object { try { $j = $_.Line | ConvertFrom-Json; "  $($j.ts) $($j.level) $($j.event)" } catch {} }
"unauthenticated /api/masters/companies/inactive -> $(& curl.exe -s -o NUL -w '%{http_code}' "$B/api/masters/companies/inactive")  (401 expected)"
"unauthenticated POST /api/masters/companies/1/reactivate -> $(& curl.exe -s -o NUL -w '%{http_code}' -X POST "$B/api/masters/companies/1/reactivate")  (401 expected)"
"unauthenticated /api/erp/companies -> $(& curl.exe -s -o NUL -w '%{http_code}' "$B/api/erp/companies")  (401 expected)"
"unauthenticated POST /api/erp/places/create -> $(& curl.exe -s -o NUL -w '%{http_code}' -X POST "$B/api/erp/places/create")  (401 expected)"
"unauthenticated /api/erp/pi/ready -> $(& curl.exe -s -o NUL -w '%{http_code}' "$B/api/erp/pi/ready")  (401 expected)"
"unauthenticated POST /api/erp/pi/apply -> $(& curl.exe -s -o NUL -w '%{http_code}' -X POST "$B/api/erp/pi/apply")  (401 expected)"
"unauthenticated POST /api/erp/vendors/add-all -> $(& curl.exe -s -o NUL -w '%{http_code}' -X POST "$B/api/erp/vendors/add-all")  (401 expected)"
"unauthenticated GET /api/erp/vendors/add-all/plan -> $(& curl.exe -s -o NUL -w '%{http_code}' "$B/api/erp/vendors/add-all/plan?company_id=1")  (401 expected)"
"unauthenticated POST /api/imports/assets/preview -> $(& curl.exe -s -o NUL -w '%{http_code}' -X POST "$B/api/imports/assets/preview?check_erp=true")  (401 expected)"
"unauthenticated GET /api/items/erp-code-check -> $(& curl.exe -s -o NUL -w '%{http_code}' "$B/api/items/erp-code-check?code=LOCAL&item_id=1")  (401 expected)"
"unauthenticated POST /api/masters/brands/work-areas -> $(& curl.exe -s -o NUL -w '%{http_code}' -X POST "$B/api/masters/brands/work-areas")  (401 expected)"
"unauthenticated GET /api/people?kind=stores -> $(& curl.exe -s -o NUL -w '%{http_code}' "$B/api/people?kind=stores")  (401 expected)"
"=== what the brand migration did (read-only)"
Get-Content "$root\shared\.env" | Where-Object { $_ -match '^\s*[A-Za-z_][A-Za-z0-9_]*\s*=' } | ForEach-Object { $k, $v = $_ -split '=', 2; [Environment]::SetEnvironmentVariable($k.Trim(), $v, 'Process') }
& "$root\shared\venv\Scripts\python.exe" "$root\backup\staging-9c95b1f\brand_areas_ro.py"
