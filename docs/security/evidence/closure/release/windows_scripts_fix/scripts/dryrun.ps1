# Release-gate fix (GT, 2026-10-17): dry runs of the ops\windows deploy / rollback / launcher scripts against FAKE
# folder layouts in the scratchpad (same pattern as the WP-C evidence infra\raw\windows\dryrun.ps1, extended).
#
#  * D-cases: deploy_ckam.ps1 -WhatIf (nothing is executed; the happy path and every refusal).
#  * S-cases: deploy_ckam.ps1 WITHOUT -WhatIf, but inside a fake world: a compiled FAKE python.exe (fakepython.cs)
#    plays pip/alembic, and run_case.ps1 shadows Stop/Start-ScheduledTask, Get-NetTCPConnection, Stop-Process,
#    Start-Sleep and Invoke-WebRequest with fakes that only write to a log. This is the only way to drive the two
#    failure branches (before / after the migration) for real. verify_release.ps1 is the real script; it is pointed
#    at port 3999 where nothing listens, so it fails with "not reachable" (exit 2).
#  * R/L-cases: rollback_release.ps1 -WhatIf and run_ckam_web.ps1 -WhatIf.
# Every value is throw-away; no real task, venv, NAS, database or network host is touched.
param(
    [string]$Work = 'C:\Users\User2\AppData\Local\Temp\claude\D--ANKUR-AI-PROJECTS-Asset-Management\33a6302e-4441-4084-94a5-472d20016684\scratchpad\sec\winfix\ps',
    [string]$OutDir = (Split-Path -Parent $PSScriptRoot)
)
$ErrorActionPreference = 'Continue'
$parsed = Join-Path $Work 'parsed'                    # written by parse_check.ps1
$casesDir = Join-Path $Work 'cases'
$runCase = Join-Path $PSScriptRoot 'run_case.ps1'
if (-not (Test-Path -LiteralPath (Join-Path $parsed 'deploy_ckam.ps1'))) { throw "run parse_check.ps1 first ($parsed)" }
if (Test-Path -LiteralPath $casesDir) { [System.IO.Directory]::Delete($casesDir, $true) }
New-Item -ItemType Directory -Force -Path $casesDir | Out-Null
if (@(Get-NetTCPConnection -LocalPort 3999 -State Listen -ErrorAction SilentlyContinue).Count -gt 0) { throw 'port 3999 is in use; pick another' }

# --- fake python.exe (C#, compiled locally)
$fakeExe = Join-Path $Work 'fakepython\python.exe'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $fakeExe) | Out-Null
if (Test-Path -LiteralPath $fakeExe) { Remove-Item -LiteralPath $fakeExe -Force }
Add-Type -TypeDefinition (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'fakepython.cs') -Raw) -OutputAssembly $fakeExe -OutputType ConsoleApplication

# --- fake release package bbbbbbb (with RELEASE.json, head c6e8a0b2d4f6) and one whose RELEASE.json names another release
function New-Package([string]$Name, [string]$JsonSha) {
    $pkg = Join-Path $Work "pkg_$Name"
    if (Test-Path -LiteralPath $pkg) { [System.IO.Directory]::Delete($pkg, $true) }
    foreach ($d in "$pkg\backend\app", "$pkg\frontend-dist") { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    foreach ($f in 'app\main.py', 'alembic.ini', 'pyproject.toml', 'constraints.txt') { Set-Content -LiteralPath "$pkg\backend\$f" -Value '# fake' }
    Set-Content -LiteralPath "$pkg\frontend-dist\index.html" -Value '<div id="root"></div>'
    Set-Content -LiteralPath "$pkg\RELEASE.json" -Value ('{ "release_sha_short": "' + $JsonSha + '", "alembic_head": "c6e8a0b2d4f6" }')
    $zip = Join-Path $Work "ckam-release-$Name.zip"
    if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
    Compress-Archive -Path "$pkg\*" -DestinationPath $zip
    return $zip
}
$zip = New-Package 'bbbbbbb' 'bbbbbbb'
$zipWrongJson = New-Package 'bbbbbbb-wrongjson' 'dddddd1'

$goodSecret = 'Fake-Only-' + ([guid]::NewGuid().ToString('N'))   # throw-away, 42 characters, never printed
$fakeDbUrl = 'DATABASE_URL=postgresql+asyncpg://fake_user:fake_pw@db.invalid:5432/fake_db'

# --- one isolated fake AppRoot per case
function New-Case([string]$Id, [string[]]$DbLines = @($fakeDbUrl), [string]$EnvName = 'production', [string]$Secret = $goodSecret,
                  [hashtable]$Fake = @{}, [string]$DbRevision = 'e6f8a0b2c4d6', [switch]$Unpacked) {
    $root = Join-Path $casesDir "$Id\root"
    $old = Join-Path $root 'releases\aaaaaaa'
    foreach ($d in "$old\backend\app", "$old\frontend-dist", "$root\shared\venv\Scripts", "$root\logs") { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    Set-Content -LiteralPath "$old\backend\app\main.py" -Value '# fake'
    Set-Content -LiteralPath "$old\backend\alembic.ini" -Value '# fake'
    Set-Content -LiteralPath "$old\frontend-dist\index.html" -Value '<div id="root"></div>'
    Copy-Item -LiteralPath $fakeExe -Destination "$root\shared\venv\Scripts\python.exe"
    $ini = foreach ($k in $Fake.Keys) { "$k=$($Fake[$k])" }
    Set-Content -LiteralPath "$root\shared\venv\Scripts\fake.ini" -Value @($ini)
    Set-Content -LiteralPath "$root\shared\venv\Scripts\fake_db.txt" -Value $DbRevision -NoNewline
    Set-Content -LiteralPath "$root\shared\nas.pw" -Value 'not-a-real-password'
    $lines = @($DbLines) + @("JWT_SECRET=$Secret", "ENVIRONMENT_NAME=$EnvName", "FRONTEND_DIST_DIR=$old\frontend-dist",
                             "LOG_DIR=$root\logs\app", 'APP_VERSION=aaaaaaa', "UPLOAD_DIR=$root\uploads")
    [System.IO.File]::WriteAllText("$root\shared\.env", ((@($lines | Where-Object { $_ -ne $null }) -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
    if ($Unpacked) { Expand-Archive -LiteralPath $zip -DestinationPath "$root\releases\bbbbbbb" -Force }
    return $root
}

$transcript = New-Object System.Collections.Generic.List[string]
$results = New-Object System.Collections.Generic.List[object]
function Invoke-Case([string]$Id, [string]$Title, [string]$Root, [string[]]$CaseArgs, [scriptblock[]]$Checks, [string[]]$CheckNames) {
    $taskLog = Join-Path $casesDir "$Id\tasks.log"
    [System.IO.File]::WriteAllText($taskLog, '')
    $envFile = Join-Path $Root 'shared\.env'
    $before = (Get-FileHash -LiteralPath $envFile).Hash
    $start = Get-Date
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runCase @CaseArgs -AppRoot $Root -TaskLog $taskLog 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
    $secs = [Math]::Round(((Get-Date) - $start).TotalSeconds, 1)
    $tasks = @(Get-Content -LiteralPath $taskLog | Where-Object { $_ })
    $calls = @(Get-Content -LiteralPath (Join-Path $Root 'shared\venv\Scripts\fake_calls.log') -ErrorAction SilentlyContinue)
    $dist = ((Get-Content -LiteralPath $envFile | Where-Object { $_ -match '^FRONTEND_DIST_DIR=' }) -replace '^FRONTEND_DIST_DIR=', '')
    $c = [pscustomobject]@{
        Code = $code; Out = ($out -join "`n"); EnvSame = ((Get-FileHash -LiteralPath $envFile).Hash -eq $before)
        Selects = (Split-Path -Leaf (Split-Path -Parent $dist)); Starts = @($tasks | Where-Object { $_ -like 'START*' }).Count
        Stops = @($tasks | Where-Object { $_ -like 'STOP*' }).Count; LastTask = $(if ($tasks.Count) { ($tasks[-1] -split ' ')[0] } else { '-' })
        Upgrade = @($calls | Where-Object { $_ -match '^-m alembic upgrade' }).Count; PyCalls = $calls.Count
        Db = (Get-Content -LiteralPath (Join-Path $Root 'shared\venv\Scripts\fake_db.txt') -Raw)
        Kept = (Test-Path -LiteralPath (Join-Path $Root 'releases\aaaaaaa\backend\app\main.py')); Root = $Root
    }
    $transcript.Add("`n===== $Id : $Title =====")
    $transcript.Add("args: $($CaseArgs -join ' ')")
    foreach ($l in $out) { $transcript.Add($l) }
    $transcript.Add(("-- facts: exit {0}; {1}s; shared\.env unchanged: {2}; .env selects: {3}; task calls: {4}; fake python calls: {5} (alembic upgrade: {6}); simulated db revision now: {7}; previous release folder kept: {8}" -f
        $c.Code, $secs, $c.EnvSame, $c.Selects, $(if ($tasks.Count) { $tasks -join ' / ' } else { 'none' }), $c.PyCalls, $c.Upgrade, $c.Db, $c.Kept))
    foreach ($l in $calls) { $transcript.Add("   python: $l") }
    $fails = @()
    for ($i = 0; $i -lt $Checks.Count; $i++) {
        $ok = $false
        try { $ok = [bool](& $Checks[$i] $c) } catch { $ok = $false }
        $transcript.Add(("   check {0,-4} {1}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $CheckNames[$i]))
        if (-not $ok) { $fails += $CheckNames[$i] }
    }
    $results.Add([pscustomobject]@{ Case = $Id; Title = $Title; Exit = $code; Checks = $Checks.Count; Failed = $fails.Count
                                    Result = $(if ($fails.Count) { 'FAIL' } else { 'PASS' }); FailedChecks = ($fails -join '; ') })
}
$deploy = Join-Path $parsed 'deploy_ckam.ps1'
$rollback = Join-Path $parsed 'rollback_release.ps1'
$launcher = Join-Path $parsed 'run_ckam_web.ps1'
$base = @('-Kind', 'deploy', '-Script', $deploy, '-Sha', 'bbbbbbb', '-Port', '3999')
$noTasks = { param($c) $c.Starts -eq 0 -and $c.Stops -eq 0 }
$noPython = { param($c) $c.PyCalls -eq 0 }

# ---------------- D: -WhatIf runs -----------------------------------------------------------------------------
$r = New-Case 'D01'
Invoke-Case 'D01' 'deploy -WhatIf, happy path (package not unpacked yet)' $r ($base + @('-PackagePath', $zip, '-DryRun')) @(
    { param($c) $c.Code -eq 0 }, { param($c) $c.EnvSame }, $noTasks, $noPython,
    { param($c) $c.Out -match 'failure handling plan' -and $c.Out -match 'BRANCH A: restore' -and $c.Out -match 'BRANCH B: CKAM-Web-FAKE-DRYRUN left STOPPED' },
    { param($c) $c.Out -match 'WhatIf: the package is not unpacked yet; RELEASE.json' }
) @('exit 0', '.env unchanged', 'no task call', 'no python call', 'WhatIf prints the branch plan', 'says RELEASE.json would be read')

$r = New-Case 'D02' -Unpacked
Invoke-Case 'D02' 'deploy -WhatIf, happy path (release folder already unpacked, RELEASE.json read)' $r ($base + @('-DryRun')) @(
    { param($c) $c.Code -eq 0 }, { param($c) $c.EnvSame }, $noTasks, $noPython,
    { param($c) $c.Out -match 'RELEASE.json: release bbbbbbb, the database must reach Alembic head c6e8a0b2d4f6' },
    { param($c) $c.Out -match 'step 6: pip install[^\r\n]*BRANCH A' -and $c.Out -match 'step 8a:[^\r\n]*BRANCH A' },
    { param($c) $c.Out -match 'step 8b: alembic upgrade head[^\r\n]*BRANCH B' -and $c.Out -match 'step 9:[^\r\n]*BRANCH B' },
    { param($c) $c.Out -match 'require alembic current = c6e8a0b2d4f6' },
    { param($c) $c.Out -match 'DATABASE_URL present exactly once \(value not shown; database host: db.invalid\)' },
    { param($c) $c.Out -match '-LocalProcessCheck Require' }
) @('exit 0', '.env unchanged', 'no task call', 'no python call', 'RELEASE.json head read', 'steps 6/8a -> branch A', 'steps 8b/9 -> branch B', 'post-migration check uses RELEASE.json head', 'DATABASE_URL pre-check passes, value hidden', 'verify gets -LocalProcessCheck Require')

$stopCases = @(
    @('D03', 'deploy -WhatIf, DATABASE_URL missing (must stop)', @{ DbLines = @() }, 'STOPPED: DATABASE_URL is missing in shared\\.env'),
    @('D04', 'deploy -WhatIf, DATABASE_URL empty (must stop)', @{ DbLines = @('DATABASE_URL=') }, 'STOPPED: DATABASE_URL in shared\\.env is empty'),
    @('D05', 'deploy -WhatIf, DATABASE_URL twice (must stop)', @{ DbLines = @($fakeDbUrl, $fakeDbUrl) }, 'STOPPED: DATABASE_URL appears 2 times'),
    @('D06', 'deploy -WhatIf, DATABASE_URL = development default (must stop)', @{ DbLines = @('DATABASE_URL=postgresql+asyncpg://ckam:ckam_dev_pw@localhost:5432/ckam') }, 'STOPPED: DATABASE_URL in shared\\.env is the development default'),
    @('D07', 'deploy -WhatIf, DATABASE_URL points at this machine (must stop)', @{ DbLines = @('DATABASE_URL=postgresql+asyncpg://fake_user:fake_pw@127.0.0.1:5432/fake_db') }, 'STOPPED: DATABASE_URL in shared\\.env points at this machine \(127.0.0.1\)'),
    @('D08', 'deploy -WhatIf, JWT_SECRET 40 x "a" (must stop)', @{ Secret = ('a' * 40) }, 'STOPPED: JWT_SECRET fails the production rules: fewer than 8 different characters'),
    @('D09', 'deploy -WhatIf, JWT_SECRET short (must stop)', @{ Secret = 'short-secret' }, 'STOPPED: JWT_SECRET fails the production rules: shorter than 32 characters'),
    @('D10', 'deploy -WhatIf, ENVIRONMENT_NAME=development (must stop)', @{ EnvName = 'development' }, 'STOPPED: ENVIRONMENT_NAME in shared\\.env is not "production"'),
    @('D11', 'deploy -WhatIf, no backup step (must stop)', @{}, 'STOPPED: take the database backup first')
)
foreach ($s in $stopCases) {
    $opt = $s[2]
    $r = New-Case $s[0] @opt -Unpacked
    $a = $base + @('-DryRun')
    if ($s[0] -eq 'D11') { $a += '-NoBackup' }
    $pattern = $s[3]
    Invoke-Case $s[0] $s[1] $r $a @(
        { param($c) $c.Code -eq 2 }, { param($c) $c.EnvSame }, $noTasks, $noPython, [scriptblock]::Create("param(`$c) `$c.Out -match '$($pattern -replace "'", "''")'")
    ) @('exit 2', '.env unchanged', 'no task call', 'no python call', "message: $pattern")
}
$r = New-Case 'S12'
Invoke-Case 'S12' 'REAL run: the unpacked RELEASE.json names another release (must stop before anything)' $r ($base + @('-PackagePath', $zipWrongJson)) @(
    { param($c) $c.Code -eq 2 }, { param($c) $c.EnvSame }, $noTasks, $noPython, { param($c) $c.Out -match 'STOPPED: RELEASE.json says release dddddd1, not bbbbbbb' }
) @('exit 2', '.env unchanged', 'no task call', 'no python call', 'RELEASE.json sha mismatch stops')

# ---------------- S: simulated real runs (fake python + shadowed cmdlets) -------------------------------------
$branchA = @(
    { param($c) $c.Code -eq 1 }, { param($c) $c.EnvSame }, { param($c) $c.Selects -eq 'aaaaaaa' },
    { param($c) $c.Starts -eq 1 -and $c.LastTask -eq 'START' }, { param($c) $c.Upgrade -eq 0 },
    { param($c) $c.Out -match 'FAILED \(branch A, before the migration step started\)' -and $c.Out -match 'STATE: branch=A' },
    { param($c) $c.Kept }
)
$branchANames = @('exit 1', '.env restored (identical to before)', '.env selects the previous release aaaaaaa', 'previous release restarted (1 START, last call START)', 'alembic upgrade never called', 'branch-A message + STATE line', 'previous release folder kept')

$r = New-Case 'S01' -Fake @{ pip_exit = 1 }
Invoke-Case 'S01' 'REAL run in the fake world: pip install fails (BEFORE the migration)' $r ($base + @('-PackagePath', $zip)) $branchA $branchANames
$r = New-Case 'S02' -Fake @{ heads = 'ffffffffffff' }
Invoke-Case 'S02' 'REAL run: the code''s alembic head differs from RELEASE.json (BEFORE the migration, step 8a)' $r ($base + @('-PackagePath', $zip)) ($branchA + @({ param($c) $c.Out -match "the code's head ffffffffffff is not RELEASE.json's alembic_head c6e8a0b2d4f6" })) ($branchANames + @('reason names both heads'))
$r = New-Case 'S03' -Fake @{ current_exit = 1 }
Invoke-Case 'S03' 'REAL run: alembic current cannot reach the database (BEFORE the migration, step 8a)' $r ($base + @('-PackagePath', $zip)) ($branchA + @({ param($c) $c.Out -match 'alembic current failed with exit code 1' })) ($branchANames + @('reason: alembic current failed'))

$branchB = @(
    { param($c) $c.Code -eq 3 }, { param($c) $c.Selects -eq 'bbbbbbb' }, { param($c) $c.LastTask -eq 'STOP' },
    { param($c) $c.Out -notmatch 'restored shared\\.env' }, { param($c) $c.Out -match 'FAILED AFTER THE DATABASE MIGRATION STEP STARTED - CKAM-Web IS LEFT STOPPED' },
    { param($c) $c.Out -match 'Nothing was switched back, downgraded or restored by this script' -and $c.Out -match 'The OWNER (decides|chooses)' },
    { param($c) $c.Out -match 'CKAM_PRODUCTION_ROLLBACK_STRATEGY.md' }, { param($c) $c.Out -match 'STATE: branch=B; ckam_web=stopped' },
    { param($c) $c.Kept }, { param($c) $c.Out -notmatch 'FAKE-ONE-TIME-PW' }
)
$branchBNames = @('exit 3 (non-zero)', '.env still selects the new release (no switch-back)', 'CKAM-Web left stopped (last task call STOP)', 'no .env restore', 'banner', 'banner: nothing done, the owner decides', 'banner points at the rollback strategy', 'STATE line', 'previous release folder kept', 'one-time password line hidden')
$threeOptions = { param($c) $c.Out -match 'roll forward - fix the cause' -and $c.Out -match "'alembic downgrade -1' run from releases\\bbbbbbb\\backend" -and $c.Out -match 'restore the pre-deploy dump' }

$r = New-Case 'S04' -Fake @{ upgrade_exit = 1 }
Invoke-Case 'S04' 'REAL run: alembic upgrade head FAILS (migration started; revision unchanged)' $r ($base + @('-PackagePath', $zip)) ($branchB + @(
    { param($c) $c.Starts -eq 0 }, { param($c) $c.Upgrade -eq 1 },
    { param($c) $c.Out -match 'Database now \(alembic current\): e6f8a0b2c4d6' -and $c.Out -match 'revision is unchanged' -and $c.Out -match 'strategy case 1' },
    { param($c) $c.Out -match '1-A switch back: rollback_release.ps1 -ToSha aaaaaaa' -and $c.Out -match '1-B stay down' -and $c.Out -match 'nothing to undo' -and $c.Out -notmatch 'restore the pre-deploy dump' })) ($branchBNames + @('never started (0 START)', 'upgrade attempted once', 'banner: revision unchanged = case 1', 'banner: only 1-A / 1-B offered, no downgrade/restore'))
$r = New-Case 'S05' -Fake @{ upgrade_to = 'b5d7f9a1c3e5' }
Invoke-Case 'S05' 'REAL run: upgrade exits 0 but alembic current is not RELEASE.json''s head' $r ($base + @('-PackagePath', $zip)) ($branchB + @(
    { param($c) $c.Starts -eq 0 }, { param($c) $c.Out -match "database is at 'b5d7f9a1c3e5' but the release's head is 'c6e8a0b2d4f6'" },
    { param($c) $c.Out -match 'INCOMPATIBLE' -and $c.Out -match 'RE-OPENS the file-read hole IF-01' }, $threeOptions)) ($branchBNames + @('never started', 'head-check reason', 'banner: old release incompatible + IF-01', 'banner: the 3 owner options'))
$r = New-Case 'S06'
Invoke-Case 'S06' 'REAL run: migration OK, the new release does not answer /api/health' $r ($base + @('-PackagePath', $zip, '-Health', 'fail', '-HealthTimeoutSeconds', '10')) ($branchB + @(
    { param($c) $c.Starts -eq 1 }, { param($c) $c.Db -eq 'c6e8a0b2d4f6' },
    { param($c) $c.Out -match 'db_now=c6e8a0b2d4f6' -and $c.Out -match 'Do NOT start aaaaaaa' }, $threeOptions)) ($branchBNames + @('only the NEW release was started (1 START), never the old one', 'db at the new head', 'banner: db_now + do not start the old release', 'banner: the 3 owner options'))
$r = New-Case 'S07'
Invoke-Case 'S07' 'REAL run: migration OK, health OK, verify_release.ps1 fails (nothing on port 3999 -> exit 2)' $r ($base + @('-PackagePath', $zip)) ($branchB + @(
    { param($c) $c.Starts -eq 1 }, { param($c) $c.Out -match 'verify_release.ps1 reported a failure \(exit 2\)' }, $threeOptions)) ($branchBNames + @('only the NEW release was started', 'reason: verify exit 2', 'banner: the 3 owner options'))
$r = New-Case 'S08' -Fake @{ pip_exit = 1 } -DbRevision 'c6e8a0b2d4f6'
Invoke-Case 'S08' 'REAL run: pip fails but the database is ALREADY at the new head (safety net: stay down)' $r ($base + @('-PackagePath', $zip)) @(
    { param($c) $c.Code -eq 3 }, { param($c) $c.Starts -eq 0 }, { param($c) $c.Upgrade -eq 0 }, { param($c) $c.Out -match 'already at the new head c6e8a0b2d4f6, so the previous release aaaaaaa must not be restarted' },
    { param($c) $c.Out -match 'STATE: branch=B; ckam_web=stopped' }, { param($c) $c.Out -notmatch 'restored shared\\.env' }
) @('exit 3', 'old release NOT restarted', 'no upgrade', 'reason names the head', 'STATE branch B', 'no .env restore')
$r = New-Case 'S09' -DbLines @()
Invoke-Case 'S09' 'REAL run: DATABASE_URL missing (must stop before anything)' $r ($base + @('-PackagePath', $zip)) @(
    { param($c) $c.Code -eq 2 }, { param($c) $c.EnvSame }, $noTasks, $noPython, { param($c) $c.Out -match 'STOPPED: DATABASE_URL is missing' }
) @('exit 2', '.env unchanged', 'no task call', 'no python call', 'message')
$r = New-Case 'S10' -Secret ('a' * 40)
Invoke-Case 'S10' 'REAL run: weak JWT_SECRET (must stop before anything)' $r ($base + @('-PackagePath', $zip)) @(
    { param($c) $c.Code -eq 2 }, { param($c) $c.EnvSame }, $noTasks, $noPython, { param($c) $c.Out -match 'STOPPED: JWT_SECRET fails the production rules' }
) @('exit 2', '.env unchanged', 'no task call', 'no python call', 'message')
$r = New-Case 'S11' -EnvName 'prod'
Invoke-Case 'S11' 'REAL run: ENVIRONMENT_NAME=prod (must stop before anything)' $r ($base + @('-PackagePath', $zip)) @(
    { param($c) $c.Code -eq 2 }, { param($c) $c.EnvSame }, $noTasks, $noPython, { param($c) $c.Out -match 'STOPPED: ENVIRONMENT_NAME in shared\\.env is not "production"' }
) @('exit 2', '.env unchanged', 'no task call', 'no python call', 'message')

$r = New-Case 'S13' -Fake @{ pip_exit = 1 }
Set-Content -LiteralPath "$r\shared\.env.pre-bbbbbbb" -Value '# copy from an EARLIER run - must survive'
Invoke-Case 'S13' 'REAL run, rerun: an earlier .env.pre-bbbbbbb exists (must not be overwritten), pip fails' $r ($base + @('-PackagePath', $zip)) ($branchA + @(
    { param($c) (Get-Content -LiteralPath "$($c.Root)\shared\.env.pre-bbbbbbb" -Raw) -match 'EARLIER run' },
    { param($c) @(Get-ChildItem -Force -LiteralPath "$($c.Root)\shared" | Where-Object { $_.Name -match '^\.env\.pre-bbbbbbb\.\d{8}_\d{6}$' }).Count -eq 1 }))($branchANames + @('earlier .env.pre-bbbbbbb untouched', 'this run saved .env.pre-bbbbbbb.<time>'))

# ---------------- R / L: rollback and launcher -WhatIf ------------------------------------------------------
$r = New-Case 'R01' -Unpacked
Invoke-Case 'R01' 'rollback -WhatIf to aaaaaaa (already selected: must stop)' $r @('-Kind', 'rollback', '-Script', $rollback, '-ToSha', 'aaaaaaa', '-DryRun') @(
    { param($c) $c.Code -eq 2 }, { param($c) $c.EnvSame }, $noTasks, { param($c) $c.Out -match 'STOPPED: aaaaaaa is already the selected release' }
) @('exit 2', '.env unchanged', 'no task call', 'message')
$r = New-Case 'R02' -Unpacked
Invoke-Case 'R02' 'rollback -WhatIf to bbbbbbb' $r @('-Kind', 'rollback', '-Script', $rollback, '-ToSha', 'bbbbbbb', '-DryRun') @(
    { param($c) $c.Code -eq 0 }, { param($c) $c.EnvSame }, $noTasks, $noPython, { param($c) $c.Out -match 'WhatIf finished: nothing in CKAM was changed' }
) @('exit 0', '.env unchanged', 'no task call', 'no python call', 'WhatIf finished')
$r = New-Case 'L01'
Invoke-Case 'L01' 'launcher -WhatIf' $r @('-Kind', 'launcher', '-Script', $launcher, '-DryRun') @(
    { param($c) $c.Code -eq 0 }, { param($c) $c.EnvSame }, { param($c) $c.Out -match '-m uvicorn app.main:app --host 0.0.0.0 --port 3999 --no-proxy-headers --no-server-header' },
    { param($c) $c.Out -notmatch 'fake_pw' }
) @('exit 0', '.env unchanged', 'uvicorn line has both flags', 'key names only, no values')

# ---------------- secret leak check over everything the scripts wrote or printed -----------------------------
$transcriptFile = Join-Path $OutDir 'dryrun.transcript.txt'
[System.IO.File]::WriteAllLines($transcriptFile, $transcript, (New-Object System.Text.UTF8Encoding($false)))
$scan = @(Get-ChildItem -LiteralPath $casesDir -Recurse -File | Where-Object { $_.Name -notmatch '^\.env' -and $_.Name -ne 'nas.pw' -and $_.Extension -ne '.exe' }) + @(Get-Item -LiteralPath $transcriptFile)
$needles = @($goodSecret, 'fake_pw', 'ckam_dev_pw', 'not-a-real-password', 'FAKE-ONE-TIME-PW-9f3k')
$hits = @($scan | Select-String -SimpleMatch -Pattern $needles)
$results.Add([pscustomobject]@{ Case = 'LEAK'; Title = "secret leak scan of $($scan.Count) files (logs, deploy logs, fake call logs, transcript)"; Exit = ''; Checks = 1; Failed = [int]($hits.Count -gt 0)
                                Result = $(if ($hits.Count) { 'FAIL' } else { 'PASS' }); FailedChecks = $(if ($hits.Count) { ($hits | ForEach-Object { "$($_.Path):$($_.LineNumber)" }) -join '; ' } else { '' }) })
$results | Export-Csv -LiteralPath (Join-Path $OutDir 'dryrun_results.csv') -NoTypeInformation -Encoding UTF8
$results | Format-Table Case, Result, Exit, Checks, Failed, Title -AutoSize | Out-String -Width 220
"cases: $($results.Count); PASS: $(@($results | Where-Object Result -eq 'PASS').Count); FAIL: $(@($results | Where-Object Result -eq 'FAIL').Count); checks: $(($results | Measure-Object Checks -Sum).Sum); failed checks: $(($results | Measure-Object Failed -Sum).Sum)"
"secret leak hits: $($hits.Count) (needles: the fake JWT secret, the fake DB password, the dev-default DB password, the fake NAS password, the fake one-time password)"
