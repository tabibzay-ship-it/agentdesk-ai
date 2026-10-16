param(
    [Parameter(Mandatory)][string]$BackupDirectory,
    [Parameter(Mandatory)][string]$IdentityPath,
    [string]$AgePath = "$PSScriptRoot\..\..\.tools\age\v1.3.2\age\age.exe"
)
. "$PSScriptRoot\Backup.Common.ps1"
Assert-ExternalCommand $AgePath
if (Test-Path -LiteralPath (Join-Path $BackupDirectory 'BACKUP_INCOMPLETE')) {
    throw 'Backup set is incomplete or failed and must remain quarantined.'
}
if (-not (Test-Path -LiteralPath (Join-Path $BackupDirectory 'BACKUP_COMPLETE') -PathType Leaf)) {
    throw 'Backup completion marker is missing.'
}
Test-EncryptedChecksums $BackupDirectory
$metadata = Get-Content -Raw -LiteralPath (Join-Path $BackupDirectory 'metadata.json') | ConvertFrom-Json
if ($metadata.status -ne 'complete' -or @($metadata.artifacts).Count -ne 3) {
    throw 'Backup metadata does not describe one complete three-artifact set.'
}
foreach ($artifact in $metadata.artifacts) {
    $actual = Get-DecryptedSha256 $AgePath $IdentityPath (Join-Path $BackupDirectory $artifact.name)
    if ($actual -ne $artifact.plaintext_sha256) { throw "Decrypted hash mismatch: $($artifact.name)" }
}
'Checksum and streaming decryption verification passed; no plaintext files were created.'
