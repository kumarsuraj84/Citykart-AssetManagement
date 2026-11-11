# CKAM production reset, step 2 of 4: DELETE the whole CKAM database and create it again EMPTY.
# RUN THIS ON THE DATABASE SERVER (10.0.0.205), in an elevated Windows PowerShell, BY THE OWNER. It asks for the PostgreSQL
# superuser password; nobody else needs to see it, and it is never written anywhere.
#
#   .\reset_2_db_drop_create.ps1 -DryRun     # checks everything and prints what it would do; changes NOTHING
#   .\reset_2_db_drop_create.ps1             # the real thing (asks you to type a confirmation first)
#
# The database name is fixed in this file on purpose: the server is shared with other apps (Spinwheel, Citykart Desk, Zoho),
# so it can never be pointed at another database by a typo or a parameter.
param(
  [switch]$DryRun,
  [string]$PgBin = 'C:\Program Files\PostgreSQL\18\bin',
  [int]$PgPort = 5432,
  [string]$SuperUser = 'postgres',
  [int]$MaxBackupAgeMinutes = 60
)
$ErrorActionPreference = 'Stop'
$Db = 'ckassetmanagement'
$AppRole = 'ckassetapp'
$BackupDir = 'E:\DB BACKUP\CK_CKASSETMANAGEMENT_DBBACKUP'
$psql = Join-Path $PgBin 'psql.exe'
if (-not (Test-Path $psql)) { throw "psql.exe not found in $PgBin (use -PgBin)." }
"=== CKAM production reset, step 2 (database server) $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  DryRun=$($DryRun.IsPresent)"

# 1. A fresh backup must exist (this step cannot be undone except from it).
$dump = Get-ChildItem -LiteralPath $BackupDir -Filter 'ckassetmanagement_*.dump' -ErrorAction Stop | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($null -eq $dump) { throw "No backup (.dump) found in $BackupDir. Run the CKAM backup task first." }
$age = [int]((Get-Date) - $dump.LastWriteTime).TotalMinutes
"latest backup: $($dump.Name)  $([math]::Round($dump.Length/1KB)) KB  $age minutes old"
if ($dump.Length -lt 100KB) { throw 'The latest backup is suspiciously small. Stop.' }
if ($age -gt $MaxBackupAgeMinutes) { throw "The latest backup is $age minutes old (limit $MaxBackupAgeMinutes). Run the CKAM backup task (CK_Backup_CKASSETMANAGEMENT) again, then retry." }

# 2. The typed confirmation (the real run only).
if (-not $DryRun) {
  "This will DELETE the database '$Db' and everything in it. It cannot be undone except from the backup above."
  $typed = Read-Host "Type exactly   WIPE $Db   to continue (anything else stops)"
  if ($typed -cne "WIPE $Db") { throw 'Not confirmed. Nothing was changed.' }
}

# 3. The superuser password, kept only in this process's environment and cleared at the end.
$secure = Read-Host "Password of the PostgreSQL user '$SuperUser'" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  function Sql([string]$sql, [string]$database = 'postgres') {
    $out = & $psql -h localhost -p $PgPort -U $SuperUser -d $database -v ON_ERROR_STOP=1 -tA -c $sql 2>&1
    if ($LASTEXITCODE -ne 0) { throw "psql failed: $out" }
    return ($out | ForEach-Object { "$_" }) -join "`n"
  }
  "connected as: $(Sql 'select current_user')   server: $((Sql 'select version()').Split(',')[0])"

  # 4. Checks (read-only).
  $info = Sql "select pg_get_userbyid(datdba) || '|' || datcollate || '|' || datctype || '|' || pg_encoding_to_char(encoding) from pg_database where datname = '$Db'"
  if (-not $info) { throw "Database '$Db' does not exist on this server. Stop." }
  $owner, $collate, $ctype, $enc = $info.Split('|')
  "database '$Db': owner=$owner encoding=$enc collation=$collate"
  if ($owner -ne $AppRole) { throw "The database owner is '$owner', not '$AppRole'. This is not the CKAM database as expected. Stop." }
  $size = Sql "select round(pg_database_size('$Db')/1048576.0, 1)"
  "size: $size MB"
  $others = Sql "select usename || ' (' || count(*) || ')' from pg_stat_activity where datname = '$Db' and usename <> '$AppRole' and pid <> pg_backend_pid() group by usename"
  if ($others) { throw "Other users are connected to '$Db': $others. Stop (nothing was changed)." }
  "connections from $AppRole (the CKAM app, which must be STOPPED): $(Sql "select count(*) from pg_stat_activity where datname = '$Db' and usename = '$AppRole'")"

  $create = "CREATE DATABASE $Db OWNER $AppRole TEMPLATE template0 ENCODING '$enc' LC_COLLATE '$collate' LC_CTYPE '$ctype'"
  if ($DryRun) {
    "DRY RUN: nothing was changed. The real run would do, in this order:"
    "  1. end the $AppRole connections to $Db"
    "  2. DROP DATABASE $Db"
    "  3. $create"
    'All checks above passed.'
    return
  }

  # 5. The change.
  [void](Sql "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$Db' and usename = '$AppRole' and pid <> pg_backend_pid()")
  Start-Sleep 2
  "dropping $Db ..."
  [void](Sql "DROP DATABASE $Db")
  "creating $Db empty ..."
  [void](Sql $create)
  $now = Sql "select pg_get_userbyid(datdba) from pg_database where datname = '$Db'"
  $tables = Sql "select count(*) from information_schema.tables where table_schema = 'public'" $Db
  "new database owner: $now ; tables in it: $tables (0 expected)"
  if ($now -ne $AppRole -or $tables -ne '0') { throw 'The new database is not as expected. Tell Claude before doing anything else.' }
  'DONE. The database is empty. Next: step 3 (rebuild) on the app server.'
}
finally {
  $env:PGPASSWORD = $null
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
