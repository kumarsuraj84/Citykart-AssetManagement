<#
.SYNOPSIS
  Read-only check of a running CKAM release (security IF-15 / IF-01 / IF-14 / AU-14 / N5 / N6 / FONTS).

.DESCRIPTION
  Sends only GET requests (no sign-in, no change of any kind) to a CKAM address and prints one PASS / WARN / FAIL
  row per check. Exit code 0 = no FAIL, 1 = at least one FAIL, 2 = the address could not be reached.

  Checks:
    * /api/health answers 200 {"status":"ok"}
    * the release id: the served bundle contains -ExpectedRelease; the bundle file exists in -ReleaseDir; the newest
      launcher log in -LauncherLogDir says "serving release: ...<sha>"   (each only when that parameter is given)
    * security headers (Content-Security-Policy, Permissions-Policy, X-Content-Type-Options, X-Frame-Options,
      Referrer-Policy) are present EXACTLY ONCE on the app shell, an /api answer, an /api 404 and a missing script;
      /api answers carry Cache-Control: no-store; the CSP has default-src 'self' and no Google Fonts host
    * the API documentation is closed: /docs, /redoc and /openapi.json are 404, or the plain app shell, never
      Swagger / ReDoc / the OpenAPI JSON (IF-14)
    * an unknown /api address is a JSON 404, not the app shell (N6)
    * every path-traversal probe below answers 404 (IF-01, IF-01-WIN). Bodies are never saved or printed.

  Requests are written byte-for-byte on a plain socket, so encoded paths such as ..%5c reach the server exactly as
  written (like curl --path-as-is); .NET's own web client would normalise some of them.

.PARAMETER BaseUrl
  The address to check, e.g. http://127.0.0.1:3211 on the server itself or http://10.0.1.98:3211 from a LAN PC.
.PARAMETER ExpectedRelease
  The short git sha of the release that should be serving (optional).
.PARAMETER ReleaseDir
  On the server: the release folder (releases\<sha>); the served bundle must exist in its frontend-dist (optional).
.PARAMETER LauncherLogDir
  On the server: the launcher's log folder (<AppRoot>\logs); its newest launcher log must name the release (optional).
.PARAMETER IncludeUncProbe
  Also send /assets/%5c%5cserver%5cshare%5cx. Only for a release that contains the IF-01-WIN fix: an older release
  could make the server look up the host "server" over SMB.
.PARAMETER TimeoutSeconds
  Per-request timeout. Default 20.
.PARAMETER OutCsv
  Also write the result rows to this CSV file (optional).

.EXAMPLE
  .\verify_release.ps1 -BaseUrl http://127.0.0.1:3211 -ExpectedRelease 3b5e842 -ReleaseDir D:\Citykart_Applications\Citykart_AssetManagement_App\releases\3b5e842
.EXAMPLE
  .\verify_release.ps1 -BaseUrl http://localhost:3211      # the local Docker dev stack (nginx in front)
#>
[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://127.0.0.1:3211',
    [string]$ExpectedRelease = '',
    [string]$ReleaseDir = '',
    [string]$LauncherLogDir = '',
    [switch]$IncludeUncProbe,
    [ValidateRange(1, 300)][int]$TimeoutSeconds = 20,
    [string]$OutCsv = ''
)

$ErrorActionPreference = 'Stop'
$uri = [Uri]$BaseUrl
$script:TargetHost = $uri.Host
$script:TargetPort = $uri.Port
$script:UseTls = ($uri.Scheme -eq 'https')
$script:HostHeader = $uri.Authority
$latin1 = [System.Text.Encoding]::GetEncoding(28591)
$results = New-Object System.Collections.Generic.List[object]

function Add-Result([string]$Check, [string]$Outcome, [string]$Detail) {
    $results.Add([pscustomobject]@{ Check = $Check; Result = $Outcome; Detail = $Detail })
}

# One HTTP/1.1 request on a raw socket. Returns status, the header list (duplicates kept) and at most MaxBody bytes.
function Invoke-RawHttp([string]$Path, [int]$MaxBody = 65536) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $wait = $client.BeginConnect($script:TargetHost, $script:TargetPort, $null, $null)
        if (-not $wait.AsyncWaitHandle.WaitOne($TimeoutSeconds * 1000)) { throw "no connection to $($script:HostHeader) within $TimeoutSeconds s" }
        $client.EndConnect($wait)
        $stream = $client.GetStream()
        if ($script:UseTls) {
            $tls = New-Object System.Net.Security.SslStream($stream, $false)
            $tls.AuthenticateAsClient($script:TargetHost)
            $stream = $tls
        }
        $stream.ReadTimeout = $TimeoutSeconds * 1000
        $request = "GET $Path HTTP/1.1`r`nHost: $($script:HostHeader)`r`nUser-Agent: ckam-verify-release`r`nAccept: */*`r`nConnection: close`r`n`r`n"
        $bytes = [System.Text.Encoding]::ASCII.GetBytes($request)
        $stream.Write($bytes, 0, $bytes.Length)
        $buffer = New-Object byte[] 65536
        $kept = New-Object System.IO.MemoryStream
        $limit = $MaxBody + 65536
        while ($true) {
            $n = $stream.Read($buffer, 0, $buffer.Length)
            if ($n -le 0) { break }
            if ($kept.Length -lt $limit) { $kept.Write($buffer, 0, [Math]::Min($n, [int]($limit - $kept.Length))) }
        }
        $text = $latin1.GetString($kept.ToArray())
    } finally {
        $client.Close()
    }
    $split = $text.IndexOf("`r`n`r`n")
    if ($split -lt 0) { throw "malformed answer for $Path" }
    $lines = $text.Substring(0, $split) -split "`r`n"
    $status = [int](($lines[0] -split ' ')[1])
    $headerLines = if ($lines.Count -gt 1) { $lines[1..($lines.Count - 1)] } else { @() }
    $headers = foreach ($l in $headerLines) {
        $i = $l.IndexOf(':')
        if ($i -gt 0) { [pscustomobject]@{ Name = $l.Substring(0, $i).Trim(); Value = $l.Substring($i + 1).Trim() } }
    }
    $body = $text.Substring($split + 4)
    if ($body.Length -gt $MaxBody) { $body = $body.Substring(0, $MaxBody) }
    [pscustomobject]@{ Status = $status; Headers = @($headers); Body = $body }
}

function Get-HeaderValues($Response, [string]$Name) { @($Response.Headers | Where-Object { $_.Name -eq $Name } | ForEach-Object { $_.Value }) }

# --- reachability + health
try {
    $health = Invoke-RawHttp '/api/health'
} catch {
    Write-Host "Cannot reach $BaseUrl : $($_.Exception.Message)"
    exit 2
}
if ($health.Status -eq 200 -and $health.Body -match '"status"\s*:\s*"ok"') { Add-Result 'health' 'PASS' '/api/health 200 ok' }
else { Add-Result 'health' 'FAIL' "/api/health answered $($health.Status)" }

# --- release id
$shell = Invoke-RawHttp '/'
$bundle = ''
if ($shell.Body -match '/assets/index-[A-Za-z0-9_-]+\.js') { $bundle = $Matches[0] }
if ($ExpectedRelease) {
    if (-not $bundle) { Add-Result 'release in bundle' 'FAIL' 'no /assets/index-*.js in the served index.html' }
    else {
        $js = Invoke-RawHttp $bundle 8388608
        if ($js.Status -eq 200 -and $js.Body.Contains($ExpectedRelease)) { Add-Result 'release in bundle' 'PASS' "$bundle contains $ExpectedRelease" }
        else { Add-Result 'release in bundle' 'FAIL' "$bundle (status $($js.Status)) does not contain $ExpectedRelease" }
    }
}
if ($ReleaseDir) {
    $local = if ($bundle) { Join-Path (Join-Path $ReleaseDir 'frontend-dist') ($bundle.TrimStart('/') -replace '/', '\') } else { '' }
    if ($local -and (Test-Path -LiteralPath $local)) { Add-Result 'bundle from release folder' 'PASS' "$bundle is in $ReleaseDir" }
    else { Add-Result 'bundle from release folder' 'FAIL' "served bundle '$bundle' is not in $ReleaseDir\frontend-dist" }
}
if ($LauncherLogDir) {
    $log = Get-ChildItem -LiteralPath $LauncherLogDir -Filter 'ckam-web_*.launcher.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $want = if ($ExpectedRelease) { $ExpectedRelease } else { 'serving release' }
    if ($log -and ((Get-Content -LiteralPath $log.FullName -Raw) -match ('serving release: .*' + [regex]::Escape($want)))) { Add-Result 'launcher log' 'PASS' "$($log.Name) names the release" }
    else { Add-Result 'launcher log' 'FAIL' "newest launcher log does not say 'serving release: ...$want'" }
}

# --- security headers exactly once
$securityHeaders = 'Content-Security-Policy', 'Permissions-Policy', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy'
$samples = [ordered]@{
    'app shell /'            = $shell
    'api /api/health'        = $health
    'api 404'                = (Invoke-RawHttp '/api/ckam-verify-release-does-not-exist')
    'missing script'         = (Invoke-RawHttp '/assets/ckam-verify-release-nothing.js')
}
foreach ($name in $samples.Keys) {
    $r = $samples[$name]
    $bad = @()
    foreach ($h in $securityHeaders) {
        $n = (Get-HeaderValues $r $h).Count
        if ($n -ne 1) { $bad += "$h x$n" }
    }
    if ((Get-HeaderValues $r 'Cache-Control').Count -gt 1) { $bad += 'Cache-Control x' + (Get-HeaderValues $r 'Cache-Control').Count }
    if ($bad.Count -eq 0) { Add-Result "headers once: $name" 'PASS' "status $($r.Status), each security header exactly once" }
    else { Add-Result "headers once: $name" 'FAIL' ("status $($r.Status): " + ($bad -join ', ')) }
}
foreach ($name in 'api /api/health', 'api 404') {
    $cc = (Get-HeaderValues $samples[$name] 'Cache-Control') -join ', '
    if ($cc -eq 'no-store') { Add-Result "no-store: $name" 'PASS' 'Cache-Control: no-store' }
    else { Add-Result "no-store: $name" 'FAIL' "Cache-Control: '$cc'" }
}
$csp = (Get-HeaderValues $shell 'Content-Security-Policy') -join ' | '
if ($csp -match "default-src 'self'" -and $csp -match 'frame-ancestors' -and $csp -notmatch 'unsafe-eval') { Add-Result 'CSP' 'PASS' $csp }
else { Add-Result 'CSP' 'FAIL' "unexpected CSP: '$csp'" }
if ($csp -match 'fonts\.googleapis\.com|fonts\.gstatic\.com') { Add-Result 'CSP without Google Fonts' 'WARN' 'the CSP still allows Google Fonts (release without the FONTS change)' }
else { Add-Result 'CSP without Google Fonts' 'PASS' 'no Google host in the CSP' }
$nosniff = (Get-HeaderValues $shell 'X-Content-Type-Options') -join ', '
if ($nosniff -eq 'nosniff') { Add-Result 'nosniff' 'PASS' 'X-Content-Type-Options: nosniff' } else { Add-Result 'nosniff' 'FAIL' "X-Content-Type-Options: '$nosniff'" }

# --- API documentation closed (IF-14)
foreach ($p in '/docs', '/redoc', '/openapi.json') {
    $r = Invoke-RawHttp $p
    $isDocs = ($r.Body -match 'swagger-ui|SwaggerUIBundle|redoc\.standalone|<redoc') -or ($r.Body.TrimStart() -match '^\{\s*"openapi"')
    if ($isDocs) { Add-Result "docs closed: $p" 'FAIL' "status $($r.Status) and the body is the API documentation" }
    elseif ($r.Status -eq 404) { Add-Result "docs closed: $p" 'PASS' '404' }
    elseif ($r.Status -eq 200 -and $r.Body -match '<div id="root">') { Add-Result "docs closed: $p" 'PASS' '200 with the plain app shell (no documentation is served)' }
    else { Add-Result "docs closed: $p" 'WARN' "status $($r.Status), not documentation" }
}

# --- unknown /api address is a JSON 404 (N6)
$u = $samples['api 404']
$ctype = (Get-HeaderValues $u 'Content-Type') -join ', '
if ($u.Status -eq 404 -and $ctype -match 'application/json' -and $u.Body -match '"detail"') { Add-Result 'unknown /api is JSON 404' 'PASS' "404 $ctype" }
else { Add-Result 'unknown /api is JSON 404' 'FAIL' "status $($u.Status), Content-Type '$ctype' (the app shell here means the N6 fix is not in this release)" }

# --- path traversal (IF-01 / IF-01-WIN). Status codes only; bodies are discarded.
$probes = @(
    '/assets/..%2f..%2f..%2f..%2fshared%2f.env',
    '/assets/..%2f..%2f..%2f..%2fshared%2fnas.pw',
    '/assets/..%2f..%2f..%2f..%2fshared%2frun_ckam_web.ps1',
    '/assets/%2e%2e%2f%2e%2e%2f%2e%2e%2f%2e%2e%2fshared%2f.env',
    '/assets/..%5c..%5cshared%5c.env',
    '/assets/..%5c..%5c..%5c..%5cshared%5c.env',
    '/assets/%2e%2e%5c%2e%2e%5cshared%5c.env',
    '/assets/..%2f..%2fbackend%2fapp%2fcore%2fconfig.py',
    '/assets/..%2f..%2f..%2f..%2fshared%2f.env%00',
    '/assets/%252e%252e%252f%252e%252e%252fshared%252f.env',
    '/assets/%2fetc%2fpasswd',
    '/assets/C:%2fWindows%2fwin.ini',
    '/assets/C:%5cWindows%5cwin.ini',
    '/assets/CON',
    '/assets/NUL',
    '/assets/index.html::$DATA'
)
if ($IncludeUncProbe) { $probes += '/assets/%5c%5cserver%5cshare%5cx' }
$traversalFailures = 0
foreach ($p in $probes) {
    try { $r = Invoke-RawHttp $p 4096 } catch { Add-Result "traversal $p" 'FAIL' $_.Exception.Message; $traversalFailures++; continue }
    $isShell = $r.Body -match '<div id="root">'
    $r = [pscustomobject]@{ Status = $r.Status }     # forget the body at once: it is never printed or kept
    if ($r.Status -eq 404) { Add-Result "traversal $p" 'PASS' '404' }
    elseif ($r.Status -eq 400) { Add-Result "traversal $p" 'WARN' 'refused with 400 (not 404)' }
    elseif ($r.Status -eq 200 -and $isShell) {
        # The Docker dev stack's nginx answers any extension-less path with the app shell; the single-port production
        # server never does under /assets/, so there this row must read 404.
        Add-Result "traversal $p" 'WARN' '200 with the app shell (no file served; expected only behind the Docker nginx, production must answer 404)'
    }
    else { Add-Result "traversal $p" 'FAIL' "status $($r.Status)"; $traversalFailures++ }
}

# --- report
$results | Format-Table -AutoSize -Wrap | Out-String -Width 220 | Write-Host
if ($OutCsv) { $results | Export-Csv -LiteralPath $OutCsv -NoTypeInformation -Encoding UTF8 }
$fail = @($results | Where-Object { $_.Result -eq 'FAIL' }).Count
$warn = @($results | Where-Object { $_.Result -eq 'WARN' }).Count
Write-Host ("{0} checks: {1} PASS, {2} WARN, {3} FAIL against {4}" -f $results.Count, ($results.Count - $fail - $warn), $warn, $fail, $BaseUrl)
if ($fail -gt 0) { exit 1 }
exit 0
