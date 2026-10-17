# Runs ONE dry-run case in its own powershell.exe process (so .env values loaded by the deploy script never leak
# into the next case). Every cmdlet that could touch the real machine is shadowed by a fake function FIRST, and the
# case aborts (exit 99) if any shadow is not in effect. The task name is a fake one as a second safety net.
param(
    [ValidateSet('deploy', 'rollback', 'launcher')][string]$Kind = 'deploy',
    [Parameter(Mandatory = $true)][string]$Script,
    [Parameter(Mandatory = $true)][string]$AppRoot,
    [string]$Sha = '',
    [string]$ToSha = '',
    [string]$PackagePath = '',
    [int]$Port = 3999,
    [ValidateSet('ok', 'fail')][string]$Health = 'ok',
    [int]$HealthTimeoutSeconds = 10,
    [switch]$DryRun,
    [switch]$NoBackup,
    [Parameter(Mandatory = $true)][string]$TaskLog
)
$ErrorActionPreference = 'Continue'
$global:FakeTaskLog = $TaskLog
$global:FakeHealth = $Health
function global:Stop-ScheduledTask { Add-Content -LiteralPath $global:FakeTaskLog -Value ('STOP  ' + ($args -join ' ')) }
function global:Start-ScheduledTask { Add-Content -LiteralPath $global:FakeTaskLog -Value ('START ' + ($args -join ' ')) }
function global:Disable-ScheduledTask { Add-Content -LiteralPath $global:FakeTaskLog -Value ('DISABLE ' + ($args -join ' ')) }
function global:Get-NetTCPConnection { @() }
function global:Stop-Process { Add-Content -LiteralPath $global:FakeTaskLog -Value ('KILL  ' + ($args -join ' ')) }
function global:Start-Sleep { }
function global:Invoke-WebRequest { if ($global:FakeHealth -eq 'ok') { [pscustomobject]@{ StatusCode = 200 } } else { throw 'FAKE: /api/health does not answer' } }
foreach ($n in 'Stop-ScheduledTask', 'Start-ScheduledTask', 'Disable-ScheduledTask', 'Get-NetTCPConnection', 'Stop-Process', 'Start-Sleep', 'Invoke-WebRequest') {
    if ((Get-Command $n).CommandType -ne 'Function') { "ABORT: $n is not shadowed"; exit 99 }
}
$taskName = 'CKAM-Web-FAKE-DRYRUN'
switch ($Kind) {
    'deploy' {
        $p = @{ Sha = $Sha; AppRoot = $AppRoot; TaskName = $taskName; Port = $Port; HealthTimeoutSeconds = $HealthTimeoutSeconds }
        if ($PackagePath) { $p.PackagePath = $PackagePath }
        if (-not $NoBackup) { $p.BackupConfirmed = $true }
        if ($DryRun) { $p.WhatIf = $true }
        & $Script @p
    }
    'rollback' {
        $p = @{ ToSha = $ToSha; AppRoot = $AppRoot; TaskName = $taskName; Port = $Port; HealthTimeoutSeconds = $HealthTimeoutSeconds }
        if ($DryRun) { $p.WhatIf = $true }
        & $Script @p
    }
    'launcher' {
        $p = @{ AppRoot = $AppRoot; Port = $Port }
        if ($DryRun) { $p.WhatIf = $true }
        & $Script @p
    }
}
exit $LASTEXITCODE
