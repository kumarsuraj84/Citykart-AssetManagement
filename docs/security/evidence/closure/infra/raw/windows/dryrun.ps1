# WP-C IF-15 dry run: builds a FAKE CKAM folder layout in the scratchpad (throw-away values only) and runs the
# ops\windows scripts against it with -WhatIf, plus the refusal cases. Touches nothing outside this folder.
param([string]$Repo = 'D:\ANKUR AI PROJECTS\Asset Management\.claude\worktrees\ckam-build')
$ErrorActionPreference = 'Continue'
$here = $PSScriptRoot
$root = Join-Path $here 'fakeroot'
$scripts = Join-Path $here 'parsed'          # the .ps1 copies made by parse_check.ps1
if (Test-Path -LiteralPath $root) { [System.IO.Directory]::Delete($root, $true) }
$old = Join-Path $root 'releases\aaaaaaa'
foreach ($d in "$old\backend\app", "$old\frontend-dist\assets", "$root\shared\venv\Scripts", "$root\logs", "$here\pkg\backend\app", "$here\pkg\frontend-dist") {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
}
Set-Content -LiteralPath "$old\backend\app\main.py" -Value '# fake'
Set-Content -LiteralPath "$old\backend\alembic.ini" -Value '# fake'
Set-Content -LiteralPath "$old\frontend-dist\index.html" -Value '<div id="root"></div>'
Set-Content -LiteralPath "$root\shared\venv\Scripts\python.exe" -Value ''
Set-Content -LiteralPath "$root\shared\nas.pw" -Value 'not-a-real-password'
foreach ($f in 'app\main.py', 'alembic.ini', 'pyproject.toml', 'constraints.txt') { Set-Content -LiteralPath "$here\pkg\backend\$f" -Value '# fake' }
Set-Content -LiteralPath "$here\pkg\frontend-dist\index.html" -Value '<div id="root"></div>'
$zip = Join-Path $here 'ckam-release-bbbbbbb.zip'
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path "$here\pkg\*" -DestinationPath $zip

function Write-FakeEnv([string]$EnvName, [string]$Secret) {
    $lines = @(
        "DATABASE_URL=postgresql+asyncpg://fake_user:fake_pw@127.0.0.1:1/fake_db",
        "JWT_SECRET=$Secret",
        "ENVIRONMENT_NAME=$EnvName",
        "FRONTEND_DIST_DIR=$old\frontend-dist",
        "LOG_DIR=$root\logs\app",
        "APP_VERSION=aaaaaaa",
        "UPLOAD_DIR=$root\uploads"
    )
    [System.IO.File]::WriteAllText("$root\shared\.env", (($lines -join "`r`n") + "`r`n"), (New-Object System.Text.UTF8Encoding($false)))
}
$goodSecret = 'Fake-Only-' + ([guid]::NewGuid().ToString('N'))   # throw-away, 42 characters
$envHash = { (Get-FileHash -LiteralPath "$root\shared\.env").Hash }

function Run([string]$Label, [scriptblock]$Block) {
    "`n===== $Label ====="
    $before = & $envHash
    & $Block 2>&1 | ForEach-Object { "$_" }
    "exit code: $LASTEXITCODE; shared\.env unchanged: $((& $envHash) -eq $before); release bbbbbbb exists: $(Test-Path "$root\releases\bbbbbbb")"
}

Write-FakeEnv 'production' $goodSecret
Run 'deploy -WhatIf (package not yet unpacked)' { & "$scripts\deploy_ckam.ps1" -Sha bbbbbbb -PackagePath $zip -AppRoot $root -BackupConfirmed -WhatIf }
Run 'deploy without a backup step (must stop)' { & "$scripts\deploy_ckam.ps1" -Sha bbbbbbb -PackagePath $zip -AppRoot $root -WhatIf }
Write-FakeEnv 'development' $goodSecret
Run 'deploy with ENVIRONMENT_NAME=development (must stop)' { & "$scripts\deploy_ckam.ps1" -Sha bbbbbbb -PackagePath $zip -AppRoot $root -BackupConfirmed -WhatIf }
Write-FakeEnv 'production' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
Run 'deploy with a 40 x "a" JWT_SECRET (must stop)' { & "$scripts\deploy_ckam.ps1" -Sha bbbbbbb -PackagePath $zip -AppRoot $root -BackupConfirmed -WhatIf }
Write-FakeEnv 'production' 'short-secret'
Run 'deploy with a short JWT_SECRET (must stop)' { & "$scripts\deploy_ckam.ps1" -Sha bbbbbbb -PackagePath $zip -AppRoot $root -BackupConfirmed -WhatIf }
Write-FakeEnv 'production' $goodSecret
Expand-Archive -LiteralPath $zip -DestinationPath "$root\releases\ccccccc" -Force
Remove-Item -LiteralPath "$root\releases\ccccccc\backend\constraints.txt"
Run 'deploy of an incomplete release folder (must stop)' { & "$scripts\deploy_ckam.ps1" -Sha ccccccc -AppRoot $root -BackupConfirmed -WhatIf }
Expand-Archive -LiteralPath $zip -DestinationPath "$root\releases\bbbbbbb" -Force
Run 'deploy -WhatIf (release folder already there)' { & "$scripts\deploy_ckam.ps1" -Sha bbbbbbb -AppRoot $root -BackupConfirmed -WhatIf }
Run 'rollback -WhatIf to aaaaaaa (already selected: must stop)' { & "$scripts\rollback_release.ps1" -ToSha aaaaaaa -AppRoot $root -WhatIf }
Run 'rollback -WhatIf to bbbbbbb' { & "$scripts\rollback_release.ps1" -ToSha bbbbbbb -AppRoot $root -WhatIf }
Run 'launcher -WhatIf' { & "$scripts\run_ckam_web.ps1" -AppRoot $root -WhatIf }
"`n===== logs written in the fake root ====="
Get-ChildItem -LiteralPath "$root\logs" | Select-Object -ExpandProperty Name
"`n===== secret leak check: does any log or output contain the fake JWT secret or the fake NAS password? ====="
$hits = Get-ChildItem -LiteralPath "$root\logs" -File | Select-String -SimpleMatch -Pattern $goodSecret, 'not-a-real-password', 'fake_pw'
"hits: $(@($hits).Count)"
