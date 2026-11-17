[CmdletBinding()]
param(
    [string]$BackupRoot = "$env:LOCALAPPDATA\AgentDeskAI\staging-backups",
    [string]$PostgresRoot = "$env:LOCALAPPDATA\AgentDeskAI\tools\postgresql-17.11-5\extracted\pgsql",
    [string]$HostName = 'db.koqlnjctqeaykhbqkyuj.supabase.co',
    [string]$DatabaseUser = 'postgres',
    [switch]$LocalPreflightOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

throw 'This EFS-dependent workflow is disabled. Use Invoke-StagingAgeBackup.ps1.'

$stagingRef = 'koqlnjctqeaykhbqkyuj'
$productionRef = 'cdynahtkwtcinjzmxjcs'
$expectedHost = "db.$stagingRef.supabase.co"
if ($HostName -match [regex]::Escape($productionRef) -or $DatabaseUser -match [regex]::Escape($productionRef)) {
    throw 'Production project references are forbidden.'
}
if ($HostName -ne $expectedHost -or $DatabaseUser -ne 'postgres') {
    throw 'Staging host or database username mismatch.'
}

$bin = Join-Path $PostgresRoot 'bin'
$tools = @{}
foreach ($name in @('psql','pg_dump','pg_restore','initdb','pg_ctl','createdb')) {
    $path = Join-Path $bin "$name.exe"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing PostgreSQL 17 tool: $name.exe" }
    $tools[$name] = $path
}
foreach ($name in @('psql','pg_dump','pg_restore')) {
    $version = (& $tools[$name] --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '\b17(?:\.\d+)?\b') { throw "$name is not PostgreSQL 17 compatible." }
}

function ConvertTo-NativeArguments([string[]]$Items) {
    return (($Items | ForEach-Object { '"' + $_.Replace('"','\"') + '"' }) -join ' ')
}

function Invoke-RemotePg {
    param([string]$Tool, [string[]]$Arguments, [SecureString]$Password)
    $bstr = [IntPtr]::Zero
    $process = $null
    try {
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        $info = [Diagnostics.ProcessStartInfo]::new()
        $info.FileName = $Tool
        $info.UseShellExecute = $false
        $info.CreateNoWindow = $true
        $info.RedirectStandardOutput = $true
        $info.RedirectStandardError = $true
        $info.Arguments = ConvertTo-NativeArguments $Arguments
        $info.Environment['PGPASSWORD'] = $plain
        $info.Environment['PGSSLMODE'] = 'verify-full'
        $info.Environment['PGSSLROOTCERT'] = 'system'
        $info.Environment['PGOPTIONS'] = '-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000'
        $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
        if (-not $process.Start()) { throw "Could not start $Tool" }
        $stdout = $process.StandardOutput.ReadToEnd()
        $stderr = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) { throw "PostgreSQL command failed with exit code $($process.ExitCode): $stderr" }
        return $stdout
    }
    finally {
        if ($process) { $process.Dispose() }
        if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
        $plain = $null
    }
}

function New-PrivateEncryptedDirectory([string]$Path) {
    New-Item -ItemType Directory -Path $Path -ErrorAction Stop | Out-Null
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $rights = [Security.AccessControl.FileSystemRights]::FullControl
    $inheritance = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($identity.User, $rights, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $Path -AclObject $acl
    & cipher.exe /E /A $Path | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not ((Get-Item -LiteralPath $Path).Attributes -band [IO.FileAttributes]::Encrypted)) {
        throw 'EFS encryption could not be established; no remote connection was attempted.'
    }
}

$repository = (Resolve-Path "$PSScriptRoot\..\..").Path
$backupRootFull = [IO.Path]::GetFullPath($BackupRoot)
if ($backupRootFull.StartsWith($repository, [StringComparison]::OrdinalIgnoreCase)) { throw 'Backup root must be outside the Git repository.' }
if (-not (Test-Path -LiteralPath $backupRootFull)) { New-Item -ItemType Directory -Path $backupRootFull | Out-Null }
$run = Join-Path $backupRootFull ([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssZ'))
New-PrivateEncryptedDirectory $run
'INCOMPLETE' | Set-Content -LiteralPath (Join-Path $run 'BACKUP_INCOMPLETE') -Encoding ascii

if ($LocalPreflightOnly) {
    Write-Host "LOCAL PREFLIGHT PASS: $run"
    Write-Host 'No credential was requested and no network connection was attempted.'
    return
}

$password = Read-Host 'Enter the existing STAGING database password (hidden)' -AsSecureString
if ($password.Length -eq 0) { throw 'A non-empty staging database password is required.' }

$common = @('--host',$HostName,'--port','5432','--username',$DatabaseUser,'--dbname','postgres','--no-password')
$identitySql = "select current_database(), session_user, current_setting('transaction_read_only'), current_setting('server_version_num')::int between 170000 and 179999, has_schema_privilege(session_user,'auth','USAGE'), has_schema_privilege(session_user,'public','USAGE');"
$identity = (Invoke-RemotePg $tools.psql ($common + @('--no-psqlrc','--tuples-only','--no-align','--field-separator','|','--set','ON_ERROR_STOP=1','--command',$identitySql)) $password).Trim()
$parts = $identity -split '\|'
if ($parts.Count -ne 6 -or $parts[0] -ne 'postgres' -or $parts[1] -ne 'postgres' -or $parts[2] -ne 'on' -or $parts[3] -ne 't' -or $parts[4] -ne 't' -or $parts[5] -ne 't') {
    throw 'Reliable staging read-only connection identity could not be established.'
}

$customDump = Join-Path $run 'staging-database.dump'
$schemaDump = Join-Path $run 'staging-schema.sql'
$dumpBase = @('--host',$HostName,'--port','5432','--username',$DatabaseUser,'--dbname','postgres','--no-password','--no-owner','--no-privileges')
[void](Invoke-RemotePg $tools.pg_dump ($dumpBase + @('--format','custom','--file',$customDump)) $password)
[void](Invoke-RemotePg $tools.pg_dump ($dumpBase + @('--schema-only','--format','plain','--file',$schemaDump)) $password)

$inventorySql = @"
begin read only;
set local statement_timeout='30s';
select 'auth_users', count(*)::bigint from auth.users;
select 'storage_objects', count(*)::bigint from storage.objects;
select 'public_tables', count(*)::bigint from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p');
select 'public_indexes', count(*)::bigint from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='i';
select 'public_rls_policies', count(*)::bigint from pg_policies where schemaname='public';
select 'public_role_grants', count(*)::bigint from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role');
rollback;
"@
$inventory = Invoke-RemotePg $tools.psql ($common + @('--no-psqlrc','--tuples-only','--no-align','--field-separator','|','--set','ON_ERROR_STOP=1','--command',$inventorySql)) $password
[IO.File]::WriteAllText((Join-Path $run 'aggregate-inventory.txt'), $inventory, [Text.UTF8Encoding]::new($false))

$ledgerSql = "select version from supabase_migrations.schema_migrations order by version;"
$ledger = Invoke-RemotePg $tools.psql ($common + @('--no-psqlrc','--tuples-only','--no-align','--set','ON_ERROR_STOP=1','--command',$ledgerSql)) $password
[IO.File]::WriteAllText((Join-Path $run 'migration-ledger.txt'), $ledger, [Text.UTF8Encoding]::new($false))
$password.Dispose(); $password = $null

$archiveList = & $tools.pg_restore --list $customDump 2>&1
if ($LASTEXITCODE -ne 0 -or -not $archiveList) { throw 'pg_restore archive validation failed.' }
[IO.File]::WriteAllLines((Join-Path $run 'archive-list.txt'), [string[]]$archiveList, [Text.UTF8Encoding]::new($false))

$localVersions = Get-ChildItem -LiteralPath (Join-Path $repository 'supabase\migrations') -Filter '*.sql' -File | Sort-Object Name | ForEach-Object { $_.BaseName -replace '_.*$','' }
$ledgerVersions = @($ledger -split '\r?\n' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$reconciliation = foreach ($version in $localVersions) {
    [pscustomobject]@{ version=$version; status=if ($version -in $ledgerVersions) {'ledger-confirmed'} else {'missing-or-object-equivalent-review-required'} }
}
$reconciliation | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $run 'migration-reconciliation.json') -Encoding utf8

$hashes = foreach ($file in @($customDump,$schemaDump)) {
    $item = Get-Item -LiteralPath $file
    [pscustomobject]@{ file=$item.Name; bytes=$item.Length; sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash }
}
$hashes | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $run 'SHA256.json') -Encoding utf8

$restoreStatus = 'BLOCKED: local restore was not attempted'
$data = Join-Path $run 'restore-data'
$log = Join-Path $run 'restore-server.log'
$serverStarted = $false
try {
    & $tools.initdb '--pgdata' $data '--username' 'postgres' '--auth-local' 'trust' '--auth-host' 'reject' '--no-sync' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'initdb failed.' }
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0); $listener.Start(); $port=([Net.IPEndPoint]$listener.LocalEndpoint).Port; $listener.Stop()
    & $tools.pg_ctl '--pgdata' $data '--log' $log '--options' "-h 127.0.0.1 -p $port" 'start' '--wait' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Local PostgreSQL server failed to start.' }
    $serverStarted = $true
    & $tools.createdb '--host' '127.0.0.1' '--port' "$port" '--username' 'postgres' 'agentdesk_restore'
    if ($LASTEXITCODE -ne 0) { throw 'Disposable restore database creation failed.' }
    & $tools.pg_restore '--host' '127.0.0.1' '--port' "$port" '--username' 'postgres' '--dbname' 'agentdesk_restore' '--no-owner' '--no-privileges' '--exit-on-error' $customDump
    if ($LASTEXITCODE -ne 0) { throw 'Disposable restore failed.' }
    $restoreQuery = "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p'); select count(*) from pg_policies where schemaname='public';"
    $restoreEvidence = & $tools.psql '--host' '127.0.0.1' '--port' "$port" '--username' 'postgres' '--dbname' 'agentdesk_restore' '--no-psqlrc' '--tuples-only' '--no-align' '--set' 'ON_ERROR_STOP=1' '--command' $restoreQuery
    if ($LASTEXITCODE -ne 0) { throw 'Disposable restore verification query failed.' }
    [IO.File]::WriteAllLines((Join-Path $run 'restore-verification.txt'), [string[]]$restoreEvidence, [Text.UTF8Encoding]::new($false))
    $restoreStatus = 'PASS'
}
catch {
    $restoreStatus = "BLOCKED: $($_.Exception.Message)"
}
finally {
    if ($serverStarted) { & $tools.pg_ctl '--pgdata' $data 'stop' '--mode' 'fast' '--wait' | Out-Null }
}

$summary = [ordered]@{ project_ref=$stagingRef; host=$HostName; database_user=$DatabaseUser; tls='verify-full'; read_only=$true; created_utc=[DateTime]::UtcNow.ToString('o'); restore=$restoreStatus; artifacts=$hashes }
$summary | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $run 'verification-summary.json') -Encoding utf8
'COMPLETE' | Set-Content -LiteralPath (Join-Path $run 'BACKUP_COMPLETE') -Encoding ascii
Remove-Item -LiteralPath (Join-Path $run 'BACKUP_INCOMPLETE')
Write-Host "STAGING BACKUP COMPLETE: $run"
Write-Host "LOCAL RESTORE: $restoreStatus"
