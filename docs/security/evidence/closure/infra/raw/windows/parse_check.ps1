# WP-C IF-15: parser check of every ops\windows script (templates copied to a .ps1 name first), plus a secret grep.
param([string]$Repo = 'D:\ANKUR AI PROJECTS\Asset Management\.claude\worktrees\ckam-build')
$ErrorActionPreference = 'Stop'
$src = Join-Path $Repo 'ops\windows'
$tmp = Join-Path $PSScriptRoot 'parsed'
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$rows = foreach ($f in Get-ChildItem -LiteralPath $src -File | Where-Object { $_.Name -match '\.ps1(\.template)?$' }) {
    $copy = Join-Path $tmp ($f.Name -replace '\.template$', '')
    Copy-Item -LiteralPath $f.FullName -Destination $copy -Force
    $tokens = $null; $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($copy, [ref]$tokens, [ref]$errors)
    $text = Get-Content -LiteralPath $f.FullName -Raw
    $uvicornLines = @(($text -split "`n") | Where-Object { $_ -match 'uvicorn' -and $_ -match 'app\.main:app' -and $_.TrimStart() -notmatch '^#' })
    $noFlag = @($uvicornLines | Where-Object { $_ -notmatch '--no-proxy-headers' })
    [pscustomobject]@{
        File = $f.Name
        ParseErrors = @($errors).Count
        FirstError = if (@($errors).Count) { "$($errors[0].Extent.StartLineNumber): $($errors[0].Message)" } else { '' }
        Tokens = @($tokens).Count
        UvicornLines = $uvicornLines.Count
        UvicornLinesWithoutNoProxyHeaders = $noFlag.Count
    }
}
$rows | Format-Table -AutoSize | Out-String -Width 200
