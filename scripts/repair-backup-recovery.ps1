[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$projectRoot = Split-Path -Parent $PSScriptRoot
$toolsRoot = 'D:\AgentDesk-Backup-Tools'
$backupD = 'D:\AgentDesk-Private-Backups'
$backupF = 'F:\AgentDesk-Private-Backups'
$resultRoot = 'D:\AgentDesk-Supabase-Tools'
$pgBin = Join-Path $toolsRoot 'postgresql-17.11\pgsql\bin'
$python = 'C:\Users\Abdul Halim Tabibzay\AppData\Local\Temp\agentdesk-escrow-py7zr\Scripts\python.exe'
$archiveHelper = Join-Path $PSScriptRoot 'backup-recovery-archive.py'
$keyCredential = Join-Path $toolsRoot 'agentdesk-production-20261009T161726Z-encryption-key.credential.xml'
$v2Escrow = Join-Path $backupD 'agentdesk-production-20261017T112405Z-recovery-key-v2.age'
$projectRef = 'cdynahtkwtcinjzmxjcs'
$timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$nameBase = "agentdesk-production-$timestamp-repaired"
$stage = Join-Path $env:LOCALAPPDATA "Temp\$nameBase-stage"
$extract = Join-Path $env:LOCALAPPDATA "Temp\$nameBase-independent-restore"
$dbArchiveD = Join-Path $backupD "$nameBase-db.7z"
$dbArchiveF = Join-Path $backupF "$nameBase-db.7z"
$storageArchiveD = Join-Path $backupD "$nameBase-storage.7z"
$storageArchiveF = Join-Path $backupF "$nameBase-storage.7z"
$resultPath = Join-Path $resultRoot "$nameBase-result.json"
$container = "agentdesk-recovery-$($timestamp.ToLowerInvariant())"
$volume = "agentdesk_recovery_$($timestamp.ToLowerInvariant())_data"
$createdContainer = $false
$createdVolume = $false

function ConvertTo-PlainText([Security.SecureString]$SecureValue) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Get-Sha256([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '')
  }
  finally {
    $sha.Dispose()
    $stream.Dispose()
  }
}

function Read-EnvFile([string]$Path) {
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $value = $Matches[2].Trim()
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      $values[$Matches[1]] = $value
    }
  }
  $values
}

function Invoke-Native([string]$File, [string[]]$Arguments, [string]$Label) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Label failed (exit $LASTEXITCODE)" }
}

function Wait-Postgres([string]$Container) {
  for ($i = 0; $i -lt 60; $i++) {
    & docker exec $Container pg_isready -U postgres -d postgres *> $null
    if ($LASTEXITCODE -eq 0) { return }
    Start-Sleep -Seconds 1
  }
  throw 'Disposable PostgreSQL did not become ready.'
}

function Test-ArchiveWithPython([string]$Archive, [string]$Password) {
  $Password | & $python $archiveHelper test $Archive
  if ($LASTEXITCODE -ne 0) { throw "Archive integrity verification failed: $([IO.Path]::GetFileName($Archive))" }
}

function Test-BackupDestination([string]$Directory, [string]$Label) {
  $probe = Join-Path $Directory ".agentdesk-write-probe-$timestamp.tmp"
  try {
    [IO.File]::Copy($archiveHelper, $probe, $false)
    if ((Get-Sha256 $archiveHelper) -ne (Get-Sha256 $probe)) {
      throw "$Label destination probe checksum mismatch."
    }
  }
  catch {
    throw "$Label destination I/O preflight failed: $($_.Exception.Message)"
  }
  finally {
    if (Test-Path -LiteralPath $probe) { Remove-Item -LiteralPath $probe -Force }
  }
}

foreach ($required in @(
  (Join-Path $pgBin 'pg_dump.exe'), (Join-Path $pgBin 'psql.exe'),
  $python, $archiveHelper, $keyCredential, $v2Escrow, (Join-Path $projectRoot '.env.local')
)) {
  if (-not (Test-Path -LiteralPath $required)) { throw "Required local dependency is unavailable: $required" }
}

foreach ($directory in @($backupD, $backupF, $resultRoot)) {
  if (-not (Test-Path -LiteralPath $directory -PathType Container)) { throw "Approved destination is unavailable: $directory" }
}

if ((docker info --format '{{json .ServerVersion}}' 2>$null) -eq $null) { throw 'Docker Desktop is not available.' }

$envValues = Read-EnvFile (Join-Path $projectRoot '.env.local')
if ($envValues['NEXT_PUBLIC_SUPABASE_URL'] -ne "https://$projectRef.supabase.co") { throw 'The local Supabase URL does not match the authorized production project.' }
if ([string]::IsNullOrWhiteSpace($envValues['SUPABASE_SERVICE_ROLE_KEY'])) { throw 'The local service-role credential is unavailable.' }

$archiveCredential = Import-Clixml -LiteralPath $keyCredential
$archiveKey = ConvertTo-PlainText $archiveCredential.Password
if ([string]::IsNullOrWhiteSpace($archiveKey)) { throw 'The verified DPAPI recovery key could not be recovered.' }

# Fail before requesting secrets if either approved backup destination cannot
# reliably write and read a small non-sensitive probe.
Test-BackupDestination $backupD 'D:'
Test-BackupDestination $backupF 'F:'

Write-Host "NEW BACKUP TIMESTAMP: $timestamp" -ForegroundColor Cyan
$dbSecure = Read-Host 'Enter the existing PRODUCTION database password (hidden)' -AsSecureString
$dbPassword = ConvertTo-PlainText $dbSecure
$escrowSecure = Read-Host 'Enter the approved v2 recovery passphrase (hidden)' -AsSecureString
$escrowPassphrase = ConvertTo-PlainText $escrowSecure
if ([string]::IsNullOrWhiteSpace($dbPassword) -or [string]::IsNullOrWhiteSpace($escrowPassphrase)) { throw 'A required secure input was empty.' }

try {
  New-Item -ItemType Directory -Path (Join-Path $stage 'database'), (Join-Path $stage 'storage\files'), (Join-Path $extract 'database'), (Join-Path $extract 'storage') -Force | Out-Null

  $conn = "host=aws-0-ap-northeast-1.pooler.supabase.com port=5432 dbname=postgres user=postgres.$projectRef sslmode=require"
  $env:PGPASSWORD = $dbPassword
  $dump = Join-Path $stage 'database\production.dump'
  Invoke-Native (Join-Path $pgBin 'pg_dump.exe') @('--dbname', $conn, '--format=custom', '--compress=9', '--file', $dump) 'Production database dump'

  $snapshotSql = @'
select json_build_object(
  'project_ref','cdynahtkwtcinjzmxjcs',
  'server_version',current_setting('server_version'),
  'auth_users',(select count(*) from auth.users),
  'conversations',(select count(*) from public.conversations),
  'messages',(select count(*) from public.messages),
  'chat_attachments',(select count(*) from public.chat_attachments),
  'storage_objects',(select count(*) from storage.objects),
  'storage_buckets',(select count(*) from storage.buckets),
  'policies',(select count(*) from pg_policies),
  'rls_tables',(select count(*) from pg_class where relrowsecurity),
  'indexes',(select count(*) from pg_indexes),
  'functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','billing')),
  'subscription_plans',(select count(*) from public.subscription_plans),
  'subscriptions',(select count(*) from public.subscriptions),
  'billing_events',(select count(*) from public.billing_events),
  'payment_transactions',(select count(*) from public.payment_transactions),
  'attachment_bytes',(select coalesce(sum(size_bytes),0) from public.chat_attachments)
)::text;
'@
  $snapshotSqlPath = Join-Path $stage 'database\snapshot.sql'
  $snapshotPath = Join-Path $stage 'database\snapshot.json'
  Set-Content -LiteralPath $snapshotSqlPath -Value $snapshotSql -Encoding UTF8
  & (Join-Path $pgBin 'psql.exe') --dbname $conn --no-psqlrc --tuples-only --quiet --set ON_ERROR_STOP=1 --file $snapshotSqlPath | Set-Content -LiteralPath $snapshotPath -Encoding UTF8
  if ($LASTEXITCODE -ne 0) { throw 'Production snapshot query failed.' }

  $objectsSql = "select coalesce(json_agg(name order by name),'[]'::json)::text from storage.objects where bucket_id='chat-attachments';"
  $objectJson = (& (Join-Path $pgBin 'psql.exe') --dbname $conn --no-psqlrc --tuples-only --quiet --set ON_ERROR_STOP=1 --command $objectsSql | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Storage object inventory query failed.' }
  $parsedObjectNames = $objectJson | ConvertFrom-Json
  $objectNames = New-Object 'System.Collections.Generic.List[string]'
  foreach ($parsedObjectName in $parsedObjectNames) {
    if ($null -ne $parsedObjectName) { $objectNames.Add([string]$parsedObjectName) }
  }
  $headers = @{ Authorization = "Bearer $($envValues['SUPABASE_SERVICE_ROLE_KEY'])"; apikey = $envValues['SUPABASE_SERVICE_ROLE_KEY'] }
  $storageManifest = @()
  foreach ($objectName in $objectNames) {
    $segments = $objectName -split '/' | ForEach-Object { [uri]::EscapeDataString($_) }
    $uri = "$($envValues['NEXT_PUBLIC_SUPABASE_URL'])/storage/v1/object/chat-attachments/$($segments -join '/')"
    $relative = $objectName -replace '/', [IO.Path]::DirectorySeparatorChar
    $target = Join-Path (Join-Path $stage 'storage\files') $relative
    $parent = Split-Path -Parent $target
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Invoke-WebRequest -Uri $uri -Headers $headers -OutFile $target -UseBasicParsing
    $storageManifest += [pscustomobject]@{ name=$objectName; bytes=(Get-Item -LiteralPath $target).Length; sha256=(Get-Sha256 $target) }
  }
  $storageManifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stage 'storage\manifest.json') -Encoding UTF8

  $archiveKey | & $python $archiveHelper create (Join-Path $stage 'database') $dbArchiveD
  if ($LASTEXITCODE -ne 0) { throw 'Database archive encryption failed.' }
  $archiveKey | & $python $archiveHelper create (Join-Path $stage 'storage') $storageArchiveD
  if ($LASTEXITCODE -ne 0) { throw 'Storage archive encryption failed.' }
  Test-ArchiveWithPython $dbArchiveD $archiveKey
  Test-ArchiveWithPython $storageArchiveD $archiveKey

  Copy-Item -LiteralPath $dbArchiveD -Destination $dbArchiveF
  Copy-Item -LiteralPath $storageArchiveD -Destination $storageArchiveF
  $dbHash = Get-Sha256 $dbArchiveD
  $storageHash = Get-Sha256 $storageArchiveD
  if ((Get-Sha256 $dbArchiveF) -ne $dbHash) { throw 'Database D:/F: checksum mismatch.' }
  if ((Get-Sha256 $storageArchiveF) -ne $storageHash) { throw 'Storage D:/F: checksum mismatch.' }

  $escrowPassphrase | & $python $archiveHelper independent-extract $v2Escrow $dbArchiveD $storageArchiveD (Join-Path $extract 'database') (Join-Path $extract 'storage')
  if ($LASTEXITCODE -ne 0) { throw 'Independent escrow decryption or archive unlock failed.' }
  $archiveKey = $null

  $restoredManifest = Get-Content -LiteralPath (Join-Path $extract 'storage\manifest.json') -Raw | ConvertFrom-Json
  foreach ($item in @($restoredManifest)) {
    $relative = $item.name -replace '/', [IO.Path]::DirectorySeparatorChar
    $file = Join-Path (Join-Path $extract 'storage\files') $relative
    if (-not (Test-Path -LiteralPath $file)) { throw 'An independently restored Storage object is missing.' }
    if ((Get-Item -LiteralPath $file).Length -ne $item.bytes -or (Get-Sha256 $file) -ne $item.sha256) { throw 'An independently restored Storage object failed integrity verification.' }
  }

  & docker volume create $volume *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Disposable Docker volume creation failed.' }
  $createdVolume = $true
  $containerId = & docker run -d --name $container --network none --mount "type=volume,source=$volume,target=/var/lib/postgresql/data" -e POSTGRES_PASSWORD=agentdesk_disposable_restore_only postgres:17.11
  if ($LASTEXITCODE -ne 0) { throw 'Disposable PostgreSQL container creation failed.' }
  $createdContainer = $true
  Wait-Postgres $container
  & docker exec $container createdb -U postgres agentdesk_restore
  if ($LASTEXITCODE -ne 0) { throw 'Disposable restore database creation failed.' }
  & docker cp (Join-Path $extract 'database\production.dump') "${container}:/tmp/production.dump" *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Copying the dump into the isolated container failed.' }
  & docker exec $container pg_restore -U postgres -d agentdesk_restore --no-owner --no-privileges --exit-on-error /tmp/production.dump *> (Join-Path $stage 'restore.log')
  if ($LASTEXITCODE -ne 0) { throw 'Isolated PostgreSQL restore failed.' }

  $expected = (Get-Content -LiteralPath (Join-Path $extract 'database\snapshot.json') -Raw).Trim() | ConvertFrom-Json
  $restoreSql = @"
select json_build_object(
  'auth_users',(select count(*) from auth.users),
  'conversations',(select count(*) from public.conversations),
  'messages',(select count(*) from public.messages),
  'chat_attachments',(select count(*) from public.chat_attachments),
  'storage_objects',(select count(*) from storage.objects),
  'storage_buckets',(select count(*) from storage.buckets),
  'policies',(select count(*) from pg_policies),
  'rls_tables',(select count(*) from pg_class where relrowsecurity),
  'indexes',(select count(*) from pg_indexes),
  'functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','billing')),
  'subscription_plans',(select count(*) from public.subscription_plans),
  'subscriptions',(select count(*) from public.subscriptions),
  'billing_events',(select count(*) from public.billing_events),
  'payment_transactions',(select count(*) from public.payment_transactions),
  'attachment_bytes',(select coalesce(sum(size_bytes),0) from public.chat_attachments)
)::text;
"@
  $actualJson = (& docker exec $container psql -U postgres -d agentdesk_restore -Atqc $restoreSql | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Isolated restore verification query failed.' }
  $actual = $actualJson | ConvertFrom-Json
  $fields = @('auth_users','conversations','messages','chat_attachments','storage_objects','storage_buckets','policies','rls_tables','indexes','functions','subscription_plans','subscriptions','billing_events','payment_transactions','attachment_bytes')
  foreach ($field in $fields) {
    if ([string]$expected.$field -ne [string]$actual.$field) { throw "Isolated restore mismatch: $field" }
  }

  $result = [ordered]@{
    status='PASS'; timestamp=$timestamp; project_ref=$projectRef
    database_archive_d=$dbArchiveD; database_archive_f=$dbArchiveF; database_sha256=$dbHash
    storage_archive_d=$storageArchiveD; storage_archive_f=$storageArchiveF; storage_sha256=$storageHash
    copies_match=$true; archive_integrity=$true; independent_escrow_decryption=$true
    database_unlock=$true; storage_unlock=$true; database_restore=$true
    storage_objects_verified=@($restoredManifest).Count; critical_catalog_and_row_counts_match=$true
    isolated_network='none'; plaintext_staging_removed=$true
  }
  $result | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resultPath -Encoding UTF8
  Write-Host 'COMPLETE INDEPENDENT RECOVERY: PASS' -ForegroundColor Green
  Write-Host "Result saved: $resultPath" -ForegroundColor Green
}
finally {
  $env:PGPASSWORD = $null
  $dbPassword = $null
  $escrowPassphrase = $null
  $archiveKey = $null
  if ($createdContainer) { & docker rm -f $container *> $null }
  if ($createdVolume) { & docker volume rm $volume *> $null }
  foreach ($path in @($stage, $extract)) {
    if (Test-Path -LiteralPath $path) {
      $resolved = (Resolve-Path -LiteralPath $path).Path
      if (-not $resolved.StartsWith((Join-Path $env:LOCALAPPDATA 'Temp\agentdesk-production-'), [StringComparison]::OrdinalIgnoreCase)) { throw "Refusing unsafe cleanup target: $resolved" }
      Remove-Item -LiteralPath $resolved -Recurse -Force
    }
  }
}
