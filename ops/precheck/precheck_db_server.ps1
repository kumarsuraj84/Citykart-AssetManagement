<#
.SYNOPSIS
  READ-ONLY pre-deployment check of the CKAM DATABASE server (10.0.0.205, PostgreSQL 18, database ckassetmanagement).
  Changes nothing. Prints no password.

.DESCRIPTION
  Answers the database half of the "live precheck" (docs/security/CKAM_URGENT_PRODUCTION_SECURITY_RUNBOOK.md step C):
    * which Alembic revision the database is at (expected e6f8a0b2c4d6 before the security release)
    * the size and the main row counts (for the migration-time estimate and the backup size)
    * the database roles that belong to CKAM (ckassetapp ...), what they may do, and who owns the tables
    * logging and connection settings, and the rules in pg_hba.conf that mention CKAM's database (no passwords there)
    * who is connected right now
    * the backup task (name, last run, result, newest backup files) and free disk space
    * antivirus / endpoint-protection services that could interrupt the deploy window
  Every database query runs in a READ-ONLY session (PGOPTIONS=-c default_transaction_read_only=on). The PostgreSQL
  administrator password is asked for ONCE, as a hidden prompt, kept only in memory for the duration of the script and
  never written to disk or shown. Nothing is created, changed or deleted, except one report file in -OutDir.
  Run it in an ELEVATED Windows PowerShell on the database server.

.PARAMETER PsqlPath   Full path of psql.exe. Default: the newest C:\Program Files\PostgreSQL\*\bin\psql.exe
.PARAMETER DbHost     Default 127.0.0.1 (run it on the database server itself)
.PARAMETER Port       Default 5432
.PARAMETER Database   Default ckassetmanagement
.PARAMETER AdminUser  Default postgres
.PARAMETER AppRole    CKAM's application role. Default ckassetapp
.PARAMETER BackupDir  Folder that holds the backup dumps (optional; shows the newest files and sizes)
.PARAMETER OutDir     Where the report file is written. Default: your Desktop

.EXAMPLE
  .\precheck_db_server.ps1
  .\precheck_db_server.ps1 -BackupDir 'E:\Backups\ckassetmanagement'
#>
[CmdletBinding()]
param(
  [string]$PsqlPath,
  [string]$DbHost    = '127.0.0.1',
  [int]$Port         = 5432,
  [string]$Database  = 'ckassetmanagement',
  [string]$AdminUser = 'postgres',
  [string]$AppRole   = 'ckassetapp',
  [string]$BackupDir,
  [string]$OutDir    = ([Environment]::GetFolderPath('Desktop'))
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Continue'
$rows = New-Object System.Collections.Generic.List[object]
function Add-Row([string]$Check, [string]$Result, [string]$Detail) {
  $rows.Add([pscustomobject]@{ Check = $Check; Result = $Result; Detail = $Detail }) | Out-Null
}
function Mask([string]$Text) {
  if (-not $Text) { return $Text }
  return ($Text -replace '(?i)(password|passwd|pwd|secret|token|PGPASSWORD)\s*[=:]\s*("[^"]*"|''[^'']*''|\S+)', '$1=<masked>')
}

Add-Row 'Report' 'INFO' ("CKAM database-server precheck, READ-ONLY, run at {0} on {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'), $env:COMPUTERNAME)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Add-Row 'Elevated PowerShell' 'WARN' 'not elevated: scheduled-task and service details may be incomplete' }

# ---------------------------------------------------------------- find psql
if (-not $PsqlPath) {
  $cand = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\psql.exe', 'D:\PostgreSQL\*\bin\psql.exe', 'D:\Program Files\PostgreSQL\*\bin\psql.exe' -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending | Select-Object -First 1
  if ($cand) { $PsqlPath = $cand.FullName }
}
if (-not $PsqlPath -or -not (Test-Path -LiteralPath $PsqlPath)) {
  Add-Row 'psql' 'FAIL' 'psql.exe not found: pass -PsqlPath. Database checks skipped'
} else {
  Add-Row 'psql' 'INFO' $PsqlPath
  $secure = Read-Host -AsSecureString -Prompt ("Password of the PostgreSQL user '{0}' (hidden; used only for read-only queries)" -f $AdminUser)
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    $env:PGOPTIONS  = '-c default_transaction_read_only=on -c statement_timeout=30000'
    $env:PGCONNECT_TIMEOUT = '10'
    function Invoke-Sql([string]$Db, [string]$Sql) {
      $out = & $PsqlPath -X -A -t -F '|' -h $DbHost -p $Port -U $AdminUser -d $Db -w -v ON_ERROR_STOP=0 -c $Sql 2>&1
      return ($out | ForEach-Object { "$_" })
    }
    function One([string]$Db, [string]$Sql) { return ((Invoke-Sql $Db $Sql) -join ' ; ').Trim() }

    $ver = One 'postgres' 'select version()'
    if ($ver -match 'PostgreSQL') {
      Add-Row 'PostgreSQL' 'PASS' $ver
      $dbs = One 'postgres' ("select count(*) from pg_database where datname = '{0}'" -f $Database)
      Add-Row "Database $Database exists" $(if ($dbs -eq '1') { 'PASS' } else { 'FAIL' }) "pg_database rows: $dbs"

      $alembic = One $Database 'select version_num from alembic_version'
      if ($alembic -eq 'e6f8a0b2c4d6') { Add-Row 'Alembic revision (live schema)' 'PASS' 'e6f8a0b2c4d6 = release 3b5e842, the expected starting point' }
      elseif ($alembic -eq 'c6e8a0b2d4f6') { Add-Row 'Alembic revision (live schema)' 'INFO' 'already at c6e8a0b2d4f6 (the security release head)' }
      else { Add-Row 'Alembic revision (live schema)' 'WARN' "is '$alembic': NOT the expected e6f8a0b2c4d6. Stop and tell the release engineer before any migration" }

      Add-Row 'Database size' 'INFO' (One $Database 'select pg_size_pretty(pg_database_size(current_database()))')
      $parts = @()
      foreach ($tbl in 'asset', 'asset_event', 'purchase_order', 'asset_user', 'audit_log', 'error_log', 'client_report') {
        if ((One $Database ("select to_regclass('public.{0}') is not null" -f $tbl)) -eq 't') { $parts += ("{0}={1}" -f $tbl, (One $Database ("select count(*) from {0}" -f $tbl))) }
        else { $parts += ("{0}=(no such table)" -f $tbl) }
      }
      Add-Row 'Main row counts (migration-time estimate)' 'INFO' ($parts -join ', ')
      Add-Row 'Largest tables' 'INFO' ((Invoke-Sql $Database "select relname||' '||pg_size_pretty(pg_total_relation_size(oid)) from pg_class where relkind='r' and relnamespace='public'::regnamespace order by pg_total_relation_size(oid) desc limit 5") -join '; ')

      # roles
      $roles = Invoke-Sql 'postgres' "select rolname||' (super='||rolsuper||', createrole='||rolcreaterole||', createdb='||rolcreatedb||', login='||rolcanlogin||', replication='||rolreplication||', bypassrls='||rolbypassrls||', valid_until='||coalesce(rolvaliduntil::text,'none')||')' from pg_roles where rolname like 'ck%' order by 1"
      Add-Row 'Roles whose name starts with ck' 'INFO' ($roles -join '; ')
      $appSuper = One 'postgres' ("select rolsuper from pg_roles where rolname = '{0}'" -f $AppRole)
      if ($appSuper -eq 't') { Add-Row "Role $AppRole" 'FAIL' 'is a superuser' } elseif ($appSuper -eq 'f') { Add-Row "Role $AppRole" 'PASS' 'is not a superuser' } else { Add-Row "Role $AppRole" 'WARN' 'not found (check -AppRole)' }
      Add-Row 'Database owner' 'INFO' (One 'postgres' ("select pg_get_userbyid(datdba) from pg_database where datname = '{0}'" -f $Database))
      Add-Row 'Owners of the tables in public' 'INFO' ((Invoke-Sql $Database "select tableowner||': '||count(*) from pg_tables where schemaname='public' group by tableowner") -join '; ')
      Add-Row 'Databases on this server (names only; other apps share it)' 'INFO' ((Invoke-Sql 'postgres' "select datname from pg_database where not datistemplate order by 1") -join ', ')
      Add-Row 'Other login roles share the server? (names only)' 'INFO' ((Invoke-Sql 'postgres' "select rolname from pg_roles where rolcanlogin and rolname !~ '^pg_' order by 1") -join ', ')

      # settings
      $set = Invoke-Sql 'postgres' "select name||'='||setting from pg_settings where name in ('listen_addresses','port','ssl','password_encryption','logging_collector','log_directory','log_connections','log_disconnections','log_statement','log_min_duration_statement','max_connections','data_directory') order by 1"
      Add-Row 'Server settings' 'INFO' ($set -join '; ')
      if (($set -join ';') -match 'log_connections=off') { Add-Row 'Connection logging' 'WARN' 'log_connections is off: PostgreSQL gives no connection evidence for the compromise check (consider turning it on AFTER the deploy)' }

      # access rules (no passwords exist in pg_hba)
      $hba = Invoke-Sql 'postgres' ("select line_number||': '||type||' '||array_to_string(database,',')||' '||array_to_string(user_name,',')||' '||coalesce(address,'')||' '||coalesce(netmask,'')||' '||auth_method from pg_hba_file_rules where 'all' = any(database) or '{0}' = any(database) or '{1}' = any(user_name) order by line_number" -f $Database, $AppRole)
      Add-Row 'pg_hba rules mentioning CKAM or all databases' 'INFO' ($hba -join ' || ')

      # who is connected
      $conn = Invoke-Sql $Database ("select usename||' from '||coalesce(client_addr::text,'local')||' app='||coalesce(application_name,'')||' state='||state from pg_stat_activity where datname = '{0}' order by backend_start" -f $Database)
      Add-Row ("Connections to $Database right now") 'INFO' ($conn -join '; ')
      Add-Row 'Sessions idle in transaction' 'INFO' (One $Database "select count(*) from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'")
    } else {
      Add-Row 'PostgreSQL' 'FAIL' ("could not connect/query: {0}" -f (Mask $ver))
    }
  } finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\PGOPTIONS -ErrorAction SilentlyContinue
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }
}

# ---------------------------------------------------------------- backup task and files
try {
  $bt = @(Get-ScheduledTask -ErrorAction Stop | Where-Object { $_.TaskName -match 'backup|CK_Backup' -and $_.TaskName -match 'CK' })
  if ($bt.Count -eq 0) { Add-Row 'Backup scheduled task' 'WARN' 'no task with CK + Backup in its name found' }
  foreach ($t in $bt) {
    $i = Get-ScheduledTaskInfo -TaskName $t.TaskName -TaskPath $t.TaskPath -ErrorAction SilentlyContinue
    $a = @($t.Actions)[0]
    Add-Row "Backup task $($t.TaskName)" 'INFO' (Mask ("state={0}, runs as {1}, last run {2}, last result {3}, next run {4}; action: {5} {6}" -f $t.State, $t.Principal.UserId, $i.LastRunTime, $i.LastTaskResult, $i.NextRunTime, $a.Execute, $a.Arguments))
    if ($i -and $i.LastTaskResult -ne 0) { Add-Row "Backup task $($t.TaskName) result" 'WARN' "last result $($i.LastTaskResult) (0 = success)" }
  }
} catch { Add-Row 'Backup scheduled task' 'WARN' $_.Exception.Message }
if ($BackupDir) {
  if (Test-Path -LiteralPath $BackupDir) {
    $bf = Get-ChildItem -LiteralPath $BackupDir -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 5
    Add-Row "Newest backup files in $BackupDir" 'INFO' (($bf | ForEach-Object { "{0} ({1:N1} MB, {2:yyyy-MM-dd HH:mm})" -f $_.Name, ($_.Length / 1MB), $_.LastWriteTime }) -join '; ')
    $drive = (Get-Item -LiteralPath $BackupDir).PSDrive
    Add-Row 'Free disk on the backup drive' $(if (($drive.Free / 1GB) -ge 5) { 'PASS' } else { 'WARN' }) ("{0}: {1:N1} GB free" -f $drive.Name, ($drive.Free / 1GB))
  } else { Add-Row 'BackupDir' 'WARN' "$BackupDir not found" }
} else { Add-Row 'BackupDir' 'INFO' 'not given: re-run with -BackupDir <folder> to list the newest dumps and the free space' }
try {
  foreach ($d in (Get-PSDrive -PSProvider FileSystem | Where-Object { $null -ne $_.Free -and $_.Used -gt 0 })) {
    Add-Row ("Free disk {0}:" -f $d.Name) $(if (($d.Free / 1GB) -ge 5) { 'INFO' } else { 'WARN' }) ("{0:N1} GB free of {1:N1} GB" -f ($d.Free / 1GB), (($d.Free + $d.Used) / 1GB))
  }
} catch {}

# ---------------------------------------------------------------- endpoint protection
try {
  $pat = 'seqrite|quick ?heal|defender|crowdstrike|sophos|symantec|norton|mcafee|trend ?micro|kaspersky|eset|cylance|sentinel|carbon ?black|bitdefender|malwarebytes|cortex|cybereason|webroot|endpoint'
  $svc = Get-Service -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match $pat -or $_.Name -match $pat }
  if ($svc) { Add-Row 'Endpoint protection services' 'WARN' (($svc | ForEach-Object { "{0} [{1}]" -f $_.DisplayName, $_.Status }) -join '; ') }
  else { Add-Row 'Endpoint protection services' 'INFO' 'no known antivirus service name found' }
} catch { Add-Row 'Endpoint protection' 'WARN' $_.Exception.Message }

# ---------------------------------------------------------------- output
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }
$outTxt = Join-Path $OutDir ("ckam_precheck_db_{0}_{1}.txt" -f $env:COMPUTERNAME, $stamp)
$table = $rows | Format-Table -AutoSize -Wrap | Out-String -Width 220
$summary = "PASS={0} WARN={1} FAIL={2} INFO={3}" -f @($rows | Where-Object Result -eq 'PASS').Count, @($rows | Where-Object Result -eq 'WARN').Count, @($rows | Where-Object Result -eq 'FAIL').Count, @($rows | Where-Object Result -eq 'INFO').Count
Set-Content -LiteralPath $outTxt -Value ($table + "`r`n" + $summary + "`r`nNo password is in this file.") -Encoding UTF8
$table
Write-Host $summary -ForegroundColor Cyan
Write-Host "Report written to: $outTxt" -ForegroundColor Cyan
Write-Host 'Nothing was changed on this server (read-only queries only).' -ForegroundColor Green
