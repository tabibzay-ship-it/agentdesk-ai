[CmdletBinding(SupportsShouldProcess, ConfirmImpact='High')]
param(
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][ValidateCount(2, 8)][string[]]$AgeRecipient,
    [Parameter(Mandatory)][string]$ManagedSchemaCustomizationPath,
    [Parameter(Mandatory)][string]$StorageAdapterPath,
    [Parameter(Mandatory)][string]$ApplicationCommit,
    [string]$DatabaseVersion = 'unknown',
    [string]$SupabasePath = 'D:\AgentDesk-Supabase-Tools\bin\supabase.exe',
    [string]$AgePath = "$PSScriptRoot\..\..\.tools\age\v1.3.2\age\age.exe",
    [switch]$ProductionDataAccessApproved
)
. "$PSScriptRoot\Backup.Common.ps1"
. "$PSScriptRoot\Storage.Backup.ps1"

if (-not $ProductionDataAccessApproved) { throw 'Production backup approval is required.' }
if (-not $PSCmdlet.ShouldProcess('Supabase production cdynahtkwtcinjzmxjcs', 'Read and encrypt a logical backup')) { return }
Assert-ExternalCommand $SupabasePath; Assert-ExternalCommand $AgePath
if (-not (Test-Path -LiteralPath $ManagedSchemaCustomizationPath -PathType Leaf)) { throw 'Reviewed managed-schema customization artifact is required.' }
if (-not (Test-Path -LiteralPath $StorageAdapterPath -PathType Leaf)) { throw 'Reviewed Storage adapter is required.' }
if (-not $env:PROD_DB_URL) { throw 'PROD_DB_URL must be supplied without a password.' }
Assert-ProductionConnection $env:PROD_DB_URL -RequirePassword

$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$destinationPath = [IO.Path]::GetFullPath($Destination)
if ($destinationPath.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase)) { throw 'Backup destination must be outside the repository.' }
if (-not (Test-Path -LiteralPath $destinationPath -PathType Container)) { throw 'Approved encrypted destination must already exist.' }
$drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($destinationPath).TrimEnd(':\'))
if ($drive.Free -lt 500MB) { throw 'At least 500 MiB free space is required.' }

$run = Join-Path $destinationPath ([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssZ'))
New-Item -ItemType Directory -Path $run | Out-Null
$incompleteMarker = Join-Path $run 'BACKUP_INCOMPLETE'
$completeMarker = Join-Path $run 'BACKUP_COMPLETE'
[DateTime]::UtcNow.ToString('o') | Set-Content -LiteralPath $incompleteMarker -Encoding ascii
$base = @('db','dump','--db-url',$env:PROD_DB_URL)
$jobs = @(
    @{ Name='roles.sql'; Args=@('--role-only') },
    @{ Name='schema.sql'; Args=@() },
    @{ Name='data.sql'; Args=@('--data-only','--use-copy','--exclude','storage.buckets_vectors','--exclude','storage.vector_indexes') },
    @{ Name='migration-history-schema.sql'; Args=@('--schema','supabase_migrations') },
    @{ Name='migration-history-data.sql'; Args=@('--data-only','--use-copy','--schema','supabase_migrations') }
)
$metadata = [ordered]@{
    manifest_version=$script:BackupManifestVersion; backup_id=[IO.Path]::GetFileName($run)
    project_ref=$script:ProductionProjectRef; created_utc=[DateTime]::UtcNow.ToString('o')
    database_version=$DatabaseVersion; application_commit=$ApplicationCommit; status='incomplete'; artifacts=@()
    storage=$null; required_recovery_dependencies=@('age v1.3.2 compatible identity','PostgreSQL 17','Supabase-compatible Auth and Storage services','sanitized platform configuration record')
}
try {
    if (@($AgeRecipient | Sort-Object -Unique).Count -ne $AgeRecipient.Count) {
        throw 'Age recipients must be distinct.'
    }
    foreach ($job in $jobs) {
        $output = Join-Path $run ($job.Name + '.age')
        $ageArguments = @('--encrypt')
        foreach ($recipient in $AgeRecipient) {
            if ($recipient -notmatch '^age1[0-9a-z]+$') { throw 'Invalid native age recipient.' }
            $ageArguments += @('--recipient', $recipient)
        }
        $ageArguments += @('--output', $output, '-')
        $plainHash = Invoke-CheckedNativePipeline $SupabasePath ($base + $job.Args) $AgePath $ageArguments $output -ProducerNeedsDatabasePassword
        $metadata.artifacts += [ordered]@{ name=[IO.Path]::GetFileName($output); coverage=$job.Name; plaintext_sha256=$plainHash; encrypted_bytes=(Get-Item $output).Length; ciphertext_sha256=Get-FileSha256Lower $output }
    }
    $managedOutput=Join-Path $run 'managed-schema-customizations.sql.age'
    $managedArgs=@('--encrypt');foreach($recipient in $AgeRecipient){$managedArgs+=@('--recipient',$recipient)};$managedArgs+=@('--output',$managedOutput,$ManagedSchemaCustomizationPath)
    & $AgePath @managedArgs
    if($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $managedOutput)){throw 'Managed-schema customization encryption failed.'}
    $metadata.artifacts += [ordered]@{name='managed-schema-customizations.sql.age';coverage='reviewed auth/storage customizations';plaintext_sha256=Get-FileSha256Lower $ManagedSchemaCustomizationPath;encrypted_bytes=(Get-Item $managedOutput).Length;ciphertext_sha256=Get-FileSha256Lower $managedOutput}
    $adapter=& $StorageAdapterPath
    if($adapter -isnot [hashtable]){throw 'Storage adapter did not return its required operation table.'}
    $metadata.storage=Export-EncryptedStorageInventory -Adapter $adapter -Destination $run -AgePath $AgePath -AgeRecipient $AgeRecipient
    $metadata.status = 'complete'
    $metadata.completed_utc = [DateTime]::UtcNow.ToString('o')
    $metadata | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $run 'manifest.json') -Encoding utf8NoBOM
    Write-EncryptedChecksums $run
    Test-EncryptedChecksums $run
    Test-BackupManifest $run | Out-Null
    Write-AtomicCompletionMarker $run
    Remove-Item -LiteralPath $incompleteMarker
    Write-Output "Encrypted backup prepared at $run"
}
catch {
    $metadata.status = 'failed'
    $metadata.failed_utc = [DateTime]::UtcNow.ToString('o')
    $metadata | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $run 'manifest.failed.json') -Encoding utf8NoBOM
    throw "Encrypted backup failed. The quarantined partial set remains marked BACKUP_INCOMPLETE at: $run"
}
