[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BackupDirectory,
    [Parameter(Mandatory)][string]$PublicStatePath,
    [switch]$PrivilegesIncluded,
    [string]$PostgresRoot = 'C:\Users\Abdul Halim Tabibzay\AppData\Local\AgentDeskAI\tools\postgresql-17.11-5\extracted\pgsql',
    [string]$AgeRoot = 'C:\Users\Abdul Halim Tabibzay\AppData\Local\AgentDesk-Tools\age-v1.3.2\extracted\age'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Backup.Common.ps1"

$backupRoot = 'C:\Users\Abdul Halim Tabibzay\AppData\Local\AgentDeskAI\staging-encrypted-backups'
$backup = [IO.Path]::GetFullPath($BackupDirectory)
$backupPrefix = $backupRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not $backup.StartsWith($backupPrefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Backup directory is outside the approved root.' }
if (-not (Test-Path -LiteralPath $backup -PathType Container)) { throw 'Backup directory is unavailable.' }
$incomplete = Join-Path $backup 'BACKUP_INCOMPLETE'
$complete = Join-Path $backup 'BACKUP_COMPLETE'
$manifestPath = Join-Path $backup 'manifest.json'
if (-not (Test-Path -LiteralPath $incomplete -PathType Leaf) -or (Test-Path -LiteralPath $complete) -or (Test-Path -LiteralPath $manifestPath)) {
    throw 'Backup finalization state is not the expected incomplete, unfinalized state.'
}

$databaseArchive = Join-Path $backup 'staging-database.dump.age'
$schemaArchive = Join-Path $backup 'staging-schema.sql.age'
$rolesArchive = Join-Path $backup 'staging-roles.sql.age'
foreach ($artifact in @($rolesArchive,$databaseArchive,$schemaArchive,$PublicStatePath)) {
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { throw 'A required finalization artifact is unavailable.' }
}

$age = Join-Path $AgeRoot 'age.exe'
$batchpass = Join-Path $AgeRoot 'age-plugin-batchpass.exe'
$pgRestore = Join-Path $PostgresRoot 'bin\pg_restore.exe'
foreach ($tool in @($age,$batchpass,$pgRestore)) { Assert-ExternalCommand $tool }
if ((& $age --version).Trim() -ne 'v1.3.2' -or (& $pgRestore --version) -notmatch '\b17(?:\.\d+)?\b') {
    throw 'Verified age or PostgreSQL 17 restore tooling is unavailable.'
}

$state = Get-Content -LiteralPath $PublicStatePath -Raw | ConvertFrom-Json
$identities = @($state.identity_a,$state.identity_b)
foreach ($identity in $identities) {
    if (-not (Test-Path -LiteralPath $identity.artifact -PathType Leaf)) { throw 'A recovery identity is unavailable.' }
    if ((Get-Item -LiteralPath $identity.artifact).Length -ne [int64]$identity.bytes -or
        (Get-FileHash -LiteralPath $identity.artifact -Algorithm SHA256).Hash -ne [string]$identity.sha256) {
        throw 'A recovery identity does not match the trusted baseline.'
    }
}

function Unlock-RecoveryIdentity([string]$Label,[string]$IdentityPath) {
    Write-Host "Retrieve Recovery Identity $Label passphrase. Stars will appear."
    $passphrase = (Read-StarredSecureString "Recovery Identity $Label passphrase").SecureString
    if ($passphrase.Length -eq 0) { $passphrase.Dispose(); throw "Recovery Identity $Label passphrase was empty." }
    $bstr=[IntPtr]::Zero; $process=$null
    try {
        $bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($passphrase)
        $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        $info=New-ProcessInfo $age @('--decrypt','-j','batchpass',$IdentityPath)
        $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
        $info.Environment['AGE_PASSPHRASE']=$plain
        $info.Environment['PATH']=([IO.Path]::GetDirectoryName($batchpass)+';'+$info.Environment['PATH'])
        $process=[Diagnostics.Process]::new(); $process.StartInfo=$info
        if(-not $process.Start()){throw 'Encrypted recovery identity process did not start.'}
        $identityText=$process.StandardOutput.ReadToEnd(); $null=$process.StandardError.ReadToEnd(); $process.WaitForExit()
        if($process.ExitCode-ne 0-or$identityText-notmatch'AGE-SECRET-KEY-1[0-9A-Z]+'){throw "Recovery Identity $Label could not be unlocked."}
        return $identityText
    } finally {
        if($process){$process.Dispose()}
        if($bstr-ne[IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)}
        $plain=$null; $passphrase.Dispose()
    }
}

$identityTextA=$null; $identityTextB=$null
try {
    $identityTextA=Unlock-RecoveryIdentity 'A' $identities[0].artifact
    $rolesHashA=Get-DecryptedSha256FromIdentityText $age $identityTextA $rolesArchive
    $databaseHashA=Get-DecryptedSha256FromIdentityText $age $identityTextA $databaseArchive
    $schemaHashA=Get-DecryptedSha256FromIdentityText $age $identityTextA $schemaArchive

    $identityTextB=Unlock-RecoveryIdentity 'B' $identities[1].artifact
    $rolesHashB=Get-DecryptedSha256FromIdentityText $age $identityTextB $rolesArchive
    $databaseHashB=Get-DecryptedSha256FromIdentityText $age $identityTextB $databaseArchive
    $schemaHashB=Get-DecryptedSha256FromIdentityText $age $identityTextB $schemaArchive
    if($rolesHashA-ne$rolesHashB-or$databaseHashA-ne$databaseHashB-or$schemaHashA-ne$schemaHashB){throw 'Independent recovery hashes did not match.'}

    $listedHash=Invoke-CheckedNativePipeline $age @('--decrypt','--identity','-',$databaseArchive) $pgRestore @('--list') -ProducerStandardInput $identityTextA
    if($listedHash-ne$databaseHashA){throw 'Archive listing stream hash did not match independent recovery.'}

    $artifacts=@(
        [ordered]@{name='staging-roles.sql.age';plaintext_sha256=$rolesHashA;ciphertext_sha256=Get-FileSha256Lower $rolesArchive;bytes=(Get-Item $rolesArchive).Length},
        [ordered]@{name='staging-database.dump.age';plaintext_sha256=$databaseHashA;ciphertext_sha256=Get-FileSha256Lower $databaseArchive;bytes=(Get-Item $databaseArchive).Length},
        [ordered]@{name='staging-schema.sql.age';plaintext_sha256=$schemaHashA;ciphertext_sha256=Get-FileSha256Lower $schemaArchive;bytes=(Get-Item $schemaArchive).Length}
    )
    $manifest=[ordered]@{
        project_ref='koqlnjctqeaykhbqkyuj'; host='aws-0-ap-northeast-2.pooler.supabase.com'; tls='verify-full'; read_only=$true
        completed_utc=[DateTime]::UtcNow.ToString('o'); recipients=2; plaintext_archives_written=$false
        privileges_included=[bool]$PrivilegesIncluded; ownership_included=$true; roles_included=$true; role_passwords_included=$false
        recovery_a_verified=$true; recovery_b_verified=$true; archive_list_verified=$true; isolated_restore_verified=$false
        artifacts=$artifacts
    }
    Write-Utf8NoBomFile $manifestPath ($manifest|ConvertTo-Json -Depth 6)
    Write-EncryptedChecksums $backup
    'COMPLETE'|Set-Content -LiteralPath $complete -Encoding ascii
    Remove-Item -LiteralPath $incomplete
    Write-Host "ENCRYPTED STAGING BACKUP FINALIZED: $backup" -ForegroundColor Green
} finally { $identityTextA=$null; $identityTextB=$null }
