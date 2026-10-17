<#
.SYNOPSIS
  COPIES (never moves or deletes) CKAM's logs and a few Windows records on the APPLICATION server to an evidence
  folder, with a SHA-256 list, BEFORE the security release is deployed (runbook step B). Changes nothing else.

.DESCRIPTION
  Why: the old release had a file-read hole (IF-01). CKAM's own logs only go back to 2026-10-14 and rotate by size, so
  they must be copied off the live folders before anything changes, and kept for the "was it used?" review
  (docs/security/CKAM_COMPROMISE_ASSESSMENT_PLAN.md).
  It copies: CKAM app logs (app.jsonl, error.jsonl, audit.jsonl and rotated copies), launcher/deploy logs, an XML
  export of the CKAM-Web task, the Windows System / Application / Task Scheduler / PowerShell / SMB-client / firewall
  event logs (Security too when run elevated), the Windows Firewall text log if it exists, and shared\.env's file
  LISTING (name, size, date: NOT its content). It never copies shared\.env or shared\nas.pw themselves.
  Then it hashes everything. Run it in an ELEVATED Windows PowerShell on the app server.
  After it finishes, copy the whole evidence folder to an encrypted drive or an admin-only share that is NOT the CKAM
  NAS folder, and keep the hash list with it. The logs contain staff names and IP addresses: do not paste them into
  chat, tickets or AI tools.

.PARAMETER AppRoot      Default D:\Citykart_Applications\Citykart_AssetManagement_App
.PARAMETER EvidenceDir  Default <drive of AppRoot>:\CKAM_EVIDENCE_<yyyyMMdd_HHmmss> (must NOT be inside the releases or logs folder)
.PARAMETER TaskName     Default CKAM-Web
.EXAMPLE
  .\preserve_evidence_app_server.ps1
#>
[CmdletBinding()]
param(
  [string]$AppRoot     = 'D:\Citykart_Applications\Citykart_AssetManagement_App',
  [string]$EvidenceDir,
  [string]$TaskName    = 'CKAM-Web'
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Continue'
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
if (-not (Test-Path -LiteralPath $AppRoot)) { throw "AppRoot not found: $AppRoot" }
if (-not $EvidenceDir) { $EvidenceDir = Join-Path ((Get-Item -LiteralPath $AppRoot).PSDrive.Root) ("CKAM_EVIDENCE_{0}" -f $stamp) }
$full = [IO.Path]::GetFullPath($EvidenceDir)
foreach ($bad in (Join-Path $AppRoot 'releases'), (Join-Path $AppRoot 'logs'), (Join-Path $AppRoot 'shared')) {
  if ($full.StartsWith([IO.Path]::GetFullPath($bad), [StringComparison]::OrdinalIgnoreCase)) { throw "EvidenceDir must not be inside $bad" }
}
if ($full -like '\\*') { throw 'EvidenceDir must be a local folder first; copy it to the safe place afterwards' }
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Warning 'Not elevated: the Security event log and some files cannot be copied. Re-run as administrator for a complete set.' }

$free = (Get-Item -LiteralPath $AppRoot).PSDrive.Free
$logSize = 0
foreach ($d in (Join-Path $AppRoot 'logs')) { if (Test-Path -LiteralPath $d) { $logSize += (Get-ChildItem -LiteralPath $d -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum } }
if ($free -lt ($logSize * 2 + 500MB)) { throw ("Not enough free space for the evidence copy (free {0:N1} GB, logs {1:N1} GB)" -f ($free / 1GB), ($logSize / 1GB)) }

New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null
$notes = New-Object System.Collections.Generic.List[string]
function Note([string]$m) { $notes.Add($m) | Out-Null; Write-Host $m }
Note ("Evidence folder: {0}" -f $full)
Note ("Started {0} on {1} by {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'), $env:COMPUTERNAME, $env:USERNAME)

# --- CKAM logs (copy only; robocopy /E without /MOVE or /MIR)
$envPath = Join-Path $AppRoot 'shared\.env'
$logDir = Join-Path $AppRoot 'logs\app'
if (Test-Path -LiteralPath $envPath) {
  $m = Select-String -LiteralPath $envPath -Pattern '^\s*LOG_DIR\s*=\s*(.+?)\s*$' | Select-Object -First 1
  if ($m) { $logDir = $m.Matches[0].Groups[1].Value.Trim('"', "'") }
}
foreach ($pair in @(@($logDir, 'ckam_app_logs'), @((Join-Path $AppRoot 'logs'), 'ckam_all_logs_folder'))) {
  if (Test-Path -LiteralPath $pair[0]) {
    $dest = Join-Path $EvidenceDir $pair[1]
    robocopy $pair[0] $dest /E /COPY:DAT /R:1 /W:1 /NP /NFL /NDL /LOG+:"$EvidenceDir\robocopy.log" | Out-Null
    Note ("copied {0} -> {1} (robocopy exit {2}; 0-7 = success)" -f $pair[0], $dest, $LASTEXITCODE)
  } else { Note ("NOT FOUND (write it in the incident record): {0}" -f $pair[0]) }
}

# --- scheduled task definition and history (only CKAM's task)
try {
  Export-ScheduledTask -TaskName $TaskName | Set-Content -LiteralPath (Join-Path $EvidenceDir "task_$TaskName.xml") -Encoding UTF8
  Get-ScheduledTaskInfo -TaskName $TaskName | Format-List * | Out-String | Set-Content -LiteralPath (Join-Path $EvidenceDir "taskinfo_$TaskName.txt") -Encoding UTF8
  Note "exported the definition of task $TaskName (check the XML for secrets before sharing it)"
} catch { Note ("task export failed: {0}" -f $_.Exception.Message) }

# --- file listing of the settings folder (names, sizes, dates; NOT contents)
try {
  Get-ChildItem -LiteralPath (Join-Path $AppRoot 'shared') -Force -ErrorAction Stop | Select-Object Name, Length, CreationTime, LastWriteTime, Attributes |
    Format-Table -AutoSize | Out-String | Set-Content -LiteralPath (Join-Path $EvidenceDir 'shared_folder_listing.txt') -Encoding UTF8
  Get-ChildItem -LiteralPath (Join-Path $AppRoot 'releases') -Directory -ErrorAction SilentlyContinue | Select-Object Name, CreationTime, LastWriteTime |
    Format-Table -AutoSize | Out-String | Set-Content -LiteralPath (Join-Path $EvidenceDir 'releases_listing.txt') -Encoding UTF8
  Note 'wrote the listing of shared\ and releases\ (no file contents)'
} catch { Note ("listing failed: {0}" -f $_.Exception.Message) }

# --- Windows event logs (exported with wevtutil; read-only)
foreach ($log in 'System', 'Application', 'Security', 'Microsoft-Windows-TaskScheduler/Operational', 'Microsoft-Windows-PowerShell/Operational',
                 'Microsoft-Windows-SMBClient/Security', 'Microsoft-Windows-SMBClient/Connectivity',
                 'Microsoft-Windows-Windows Firewall With Advanced Security/Firewall',
                 'Microsoft-Windows-TerminalServices-LocalSessionManager/Operational') {
  $name = ($log -replace '[/ ]', '_')
  wevtutil epl $log (Join-Path $EvidenceDir ("eventlog_{0}.evtx" -f $name)) 2>$null
  if ($LASTEXITCODE -eq 0) { Note ("event log exported: {0}" -f $log) } else { Note ("event log NOT exported (absent, disabled or no permission): {0}" -f $log) }
}
$fw = Join-Path $env:SystemRoot 'System32\LogFiles\Firewall'
if (Test-Path -LiteralPath $fw) { robocopy $fw (Join-Path $EvidenceDir 'firewall_text_logs') /E /COPY:DAT /R:1 /W:1 /NP /NFL /NDL | Out-Null; Note 'copied the Windows Firewall text logs' }
else { Note 'no Windows Firewall text log folder found' }

# --- hashes
Note 'hashing every evidence file (SHA-256) ...'
$hashFile = Join-Path $EvidenceDir 'evidence.sha256.csv'
Get-ChildItem -LiteralPath $EvidenceDir -File -Recurse | Where-Object { $_.FullName -ne $hashFile } |
  Get-FileHash -Algorithm SHA256 | Select-Object Hash, @{ n = 'File'; e = { $_.Path.Substring($full.Length).TrimStart('\') } } |
  Export-Csv -LiteralPath $hashFile -NoTypeInformation -Encoding UTF8
$count = (Get-ChildItem -LiteralPath $EvidenceDir -File -Recurse | Measure-Object).Count
Note ("done {0}: {1} files incl. the hash list {2}" -f (Get-Date -Format 'HH:mm:ss'), $count, $hashFile)
Set-Content -LiteralPath (Join-Path $EvidenceDir 'README_what_was_done.txt') -Value ($notes -join "`r`n") -Encoding UTF8
Write-Host ''
Write-Host 'NEXT: copy this folder to an encrypted drive / admin-only share that is NOT the CKAM NAS folder, re-check the hashes there, and write in the incident record every source above that says NOT FOUND / NOT exported.' -ForegroundColor Cyan
Write-Host 'Nothing on this server was changed except the new evidence folder.' -ForegroundColor Green
