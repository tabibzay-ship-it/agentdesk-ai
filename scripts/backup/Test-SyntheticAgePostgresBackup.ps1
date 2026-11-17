[CmdletBinding()]
param(
    [string]$PostgresRoot = "$env:LOCALAPPDATA\AgentDeskAI\tools\postgresql-17.11-5\extracted\pgsql",
    [string]$AgeRoot = "$PSScriptRoot\..\..\.tools\age\v1.3.2\age",
    [string]$TemporaryRootParent = "$PSScriptRoot\..\..\.tmp-e2e"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Backup.Common.ps1"

$age = Join-Path $AgeRoot 'age.exe'
$ageKeygen = Join-Path $AgeRoot 'age-keygen.exe'
$pgBin = Join-Path $PostgresRoot 'bin'
$tools = @{
    initdb = Join-Path $pgBin 'initdb.exe'
    pg_ctl = Join-Path $pgBin 'pg_ctl.exe'
    createdb = Join-Path $pgBin 'createdb.exe'
    pg_isready = Join-Path $pgBin 'pg_isready.exe'
    psql = Join-Path $pgBin 'psql.exe'
    pg_dump = Join-Path $pgBin 'pg_dump.exe'
    pg_restore = Join-Path $pgBin 'pg_restore.exe'
}
foreach ($path in @($age,$ageKeygen) + @($tools.Values)) { Assert-ExternalCommand $path }
if ((& $age --version).Trim() -ne 'v1.3.2') { throw 'Only the checksum-pinned age v1.3.2 binary is approved.' }

$temporaryParent = [IO.Path]::GetFullPath($TemporaryRootParent)
if (-not (Test-Path -LiteralPath $temporaryParent -PathType Container)) {
    New-Item -ItemType Directory -Path $temporaryParent | Out-Null
}
$root = Join-Path $temporaryParent ("agentdesk-age-synthetic-" + [Guid]::NewGuid().ToString('N'))
$data = Join-Path $root 'pgdata'
$log = Join-Path $root 'postgres.log'
$key1 = Join-Path $root 'test-recipient-1.key'
$key2 = Join-Path $root 'test-recipient-2.key'
$databaseArchive = Join-Path $root 'synthetic-database.dump.age'
$schemaArchive = Join-Path $root 'synthetic-schema.sql.age'
$serverStarted = $false
$serverProcess = $null

try {
    New-Item -ItemType Directory -Path $root | Out-Null
    Write-Host 'SYNTHETIC STEP 1/8: temporary workspace created'
    & $ageKeygen '--output' $key1 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Ephemeral test identity 1 generation failed.' }
    & $ageKeygen '--output' $key2 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Ephemeral test identity 2 generation failed.' }
    $recipient1 = (& $ageKeygen '--y' $key1 2>$null).Trim()
    $recipient2 = (& $ageKeygen '--y' $key2 2>$null).Trim()
    if ($recipient1 -notmatch '^age1[0-9a-z]+$' -or $recipient2 -notmatch '^age1[0-9a-z]+$' -or $recipient1 -eq $recipient2) {
        throw 'Ephemeral test recipients are invalid or not independent.'
    }
    Write-Host 'SYNTHETIC STEP 2/8: two ephemeral recipients prepared'

    & $tools.initdb '--pgdata' $data '--username' 'postgres' '--auth-local' 'trust' '--auth-host' 'trust' '--no-sync' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic initdb failed.' }
    Write-Host 'SYNTHETIC STEP 3/8: disposable PostgreSQL cluster initialized'
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start(); $port=([Net.IPEndPoint]$listener.LocalEndpoint).Port; $listener.Stop()
    $serverErrorLog = Join-Path $root 'postgres-error.log'
    $serverArguments = "-D `"$data`" -h 127.0.0.1 -p $port"
    $serverProcess = Start-Process -FilePath (Join-Path $pgBin 'postgres.exe') -ArgumentList $serverArguments -RedirectStandardOutput $log -RedirectStandardError $serverErrorLog -WindowStyle Hidden -PassThru
    if (-not $serverProcess) { throw 'Synthetic PostgreSQL server failed to start.' }
    $serverStarted = $true
    $ready = $false
    foreach ($attempt in 1..40) {
        & $tools.pg_isready '--host' '127.0.0.1' '--port' "$port" '--username' 'postgres' '--timeout' '1' | Out-Null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { throw 'Synthetic PostgreSQL readiness deadline expired.' }
    Write-Host 'SYNTHETIC STEP 4/8: loopback-only PostgreSQL server started'
    foreach ($database in @('synthetic_source','synthetic_restore')) {
        & $tools.createdb '--host' '127.0.0.1' '--port' "$port" '--username' 'postgres' $database
        if ($LASTEXITCODE -ne 0) { throw "Could not create disposable database: $database" }
    }
    $seedSql = "create table public.synthetic_items(id integer primary key, label text not null); insert into public.synthetic_items values (1,'alpha'),(2,'beta'); alter table public.synthetic_items enable row level security; create policy synthetic_read on public.synthetic_items for select using (true);"
    & $tools.psql '--host' '127.0.0.1' '--port' "$port" '--username' 'postgres' '--dbname' 'synthetic_source' '--no-psqlrc' '--set' 'ON_ERROR_STOP=1' '--command' $seedSql | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic data preparation failed.' }
    Write-Host 'SYNTHETIC STEP 5/8: non-sensitive fixture prepared'

    $ageDatabaseArgs = @('--encrypt','--recipient',$recipient1,'--recipient',$recipient2,'--output',$databaseArchive,'-')
    $databasePlainHash = Invoke-CheckedNativePipeline $tools.pg_dump @('--host','127.0.0.1','--port',"$port",'--username','postgres','--dbname','synthetic_source','--format','custom','--no-owner','--no-privileges') $age $ageDatabaseArgs $databaseArchive
    $ageSchemaArgs = @('--encrypt','--recipient',$recipient1,'--recipient',$recipient2,'--output',$schemaArchive,'-')
    $schemaPlainHash = Invoke-CheckedNativePipeline $tools.pg_dump @('--host','127.0.0.1','--port',"$port",'--username','postgres','--dbname','synthetic_source','--schema-only','--format','plain','--no-owner','--no-privileges') $age $ageSchemaArgs $schemaArchive
    Write-Host 'SYNTHETIC STEP 6/8: database and schema streamed directly into age'

    $key1Hash = Get-DecryptedSha256 $age $key1 $databaseArchive
    $key2Hash = Get-DecryptedSha256 $age $key2 $databaseArchive
    if ($key1Hash -ne $databasePlainHash -or $key2Hash -ne $databasePlainHash) { throw 'Independent recipient decryption hash mismatch.' }
    $schemaKey1Hash = Get-DecryptedSha256 $age $key1 $schemaArchive
    $schemaKey2Hash = Get-DecryptedSha256 $age $key2 $schemaArchive
    if ($schemaKey1Hash -ne $schemaPlainHash -or $schemaKey2Hash -ne $schemaPlainHash) { throw 'Schema recipient decryption hash mismatch.' }
    Write-Host 'SYNTHETIC STEP 7/8: both recipients independently verified'

    $restoreHash = Invoke-CheckedNativePipeline $age @('--decrypt','--identity',$key1,$databaseArchive) $tools.pg_restore @('--host','127.0.0.1','--port',"$port",'--username','postgres','--dbname','synthetic_restore','--no-owner','--no-privileges','--exit-on-error') -InteractiveProducer
    if ($restoreHash -ne $databasePlainHash) { throw 'Restored stream hash mismatch.' }
    $evidence = (& $tools.psql '--host' '127.0.0.1' '--port' "$port" '--username' 'postgres' '--dbname' 'synthetic_restore' '--no-psqlrc' '--tuples-only' '--no-align' '--set' 'ON_ERROR_STOP=1' '--command' "select count(*) from public.synthetic_items; select count(*) from pg_policies where schemaname='public' and tablename='synthetic_items';").Trim() -split '\r?\n'
    if ($LASTEXITCODE -ne 0 -or $evidence.Count -ne 2 -or $evidence[0] -ne '2' -or $evidence[1] -ne '1') { throw 'Synthetic restore evidence mismatch.' }
    Write-Host 'SYNTHETIC STEP 8/8: streaming restore verified'

    [pscustomobject]@{
        Result = 'PASS'
        PlaintextBackupWrittenToDisk = $false
        IndependentRecipients = 2
        DatabaseCiphertextSha256 = (Get-FileSha256Lower $databaseArchive)
        SchemaCiphertextSha256 = (Get-FileSha256Lower $schemaArchive)
        RestoredRows = 2
        RestoredPolicies = 1
    }
}
finally {
    if ($serverStarted) {
        & $tools.pg_ctl '--pgdata' $data 'stop' '--mode' 'fast' '--no-wait' | Out-Null
        foreach ($attempt in 1..40) {
            & $tools.pg_isready '--host' '127.0.0.1' '--port' "$port" '--username' 'postgres' '--timeout' '1' | Out-Null
            if ($LASTEXITCODE -ne 0) { break }
            Start-Sleep -Milliseconds 250
        }
        if ($serverProcess -and -not $serverProcess.HasExited) {
            $serverProcess.Kill($true)
            $serverProcess.WaitForExit()
        }
        if ($serverProcess) { $serverProcess.Dispose() }
    }
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    $resolved = [IO.Path]::GetFullPath($root)
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolved) -like 'agentdesk-age-synthetic-*') {
        Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
    }
}
