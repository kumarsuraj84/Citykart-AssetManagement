# Release-gate fix of the ops\windows scripts: PowerShell parser check of every .ps1 / .ps1.template (templates are
# copied to a .ps1 name first), uvicorn flag check, and a grep for anything that looks like a secret.
# The copies in <Work>\parsed are the ones the dry run executes. Touches nothing outside <Work>.
param(
    [string]$Repo = 'D:\ANKUR AI PROJECTS\Asset Management\.claude\worktrees\ckam-build',
    [string]$Work = 'C:\Users\User2\AppData\Local\Temp\claude\D--ANKUR-AI-PROJECTS-Asset-Management\33a6302e-4441-4084-94a5-472d20016684\scratchpad\sec\winfix\ps'
)
$ErrorActionPreference = 'Stop'
$src = Join-Path $Repo 'ops\windows'
$tmp = Join-Path $Work 'parsed'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
"PowerShell $($PSVersionTable.PSVersion) ($($PSVersionTable.PSEdition)) on $([Environment]::OSVersion.VersionString)"
$rows = foreach ($f in Get-ChildItem -LiteralPath $src -File | Where-Object { $_.Name -match '\.ps1(\.template)?$' }) {
    $copy = Join-Path $tmp ($f.Name -replace '\.template$', '')
    Copy-Item -LiteralPath $f.FullName -Destination $copy -Force
    $tokens = $null; $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($copy, [ref]$tokens, [ref]$errors)
    $text = Get-Content -LiteralPath $f.FullName -Raw
    $uvicornLines = @(($text -split "`n") | Where-Object { $_ -match 'uvicorn' -and $_ -match 'app\.main:app' -and $_ -match '\$uvicornArgs\s*=' })
    $secretish = @(($text -split "`n") | Where-Object { $_ -match '(?i)(password|secret|token)\s*=\s*[''"][^''"$]{6,}[''"]' })
    [pscustomobject]@{
        File = $f.Name
        SHA256 = (Get-FileHash -LiteralPath $f.FullName -Algorithm SHA256).Hash.Substring(0, 16)
        ParseErrors = @($errors).Count
        FirstError = if (@($errors).Count) { "$($errors[0].Extent.StartLineNumber): $($errors[0].Message)" } else { '' }
        Tokens = @($tokens).Count
        UvicornArgLines = $uvicornLines.Count
        WithBothFlags = @($uvicornLines | Where-Object { $_ -match '--no-proxy-headers' -and $_ -match '--no-server-header' }).Count
        HardcodedSecretLike = $secretish.Count
    }
}
$rows | Format-Table -AutoSize | Out-String -Width 220
"files: $(@($rows).Count); total parse errors: $((@($rows) | Measure-Object -Property ParseErrors -Sum).Sum)"
