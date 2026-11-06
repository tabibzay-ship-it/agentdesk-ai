[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BackupDirectory,
    [string]$RecoveryStatePath = 'C:\Users\Abdul Halim Tabibzay\Documents\AgentDesk-Production-Recovery-State\agentdesk-production-recovery-20261106T213959Z.public.json',
    [string]$AgePath = "$PSScriptRoot\..\..\.tools\age\v1.3.2\age\age.exe",
    [string]$PgRestorePath = "$PSScriptRoot\..\..\.tools\postgresql-17.11-client\bin\pg_restore.exe"
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'

function Get-Sha256Hex([string]$Path){$s=[IO.File]::OpenRead($Path);try{$h=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($h.ComputeHash($s))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}finally{$s.Dispose()}}

foreach($tool in @($AgePath,$PgRestorePath)){if(-not(Test-Path -LiteralPath $tool -PathType Leaf)){throw "Required tool missing: $tool"}}
if((Get-Command pwsh).Version.Major -lt 7){throw 'PowerShell 7 is required for byte-preserving native pipelines.'}
if(-not(Test-Path -LiteralPath (Join-Path $BackupDirectory 'BACKUP_COMPLETE') -PathType Leaf)){throw 'Backup completion marker is missing.'}
if(Test-Path -LiteralPath (Join-Path $BackupDirectory 'BACKUP_INVALID_EMPTY_STREAM') -PathType Leaf){throw 'Backup is quarantined as invalid.'}
$manifest=Get-Content -LiteralPath (Join-Path $BackupDirectory 'manifest.json') -Raw|ConvertFrom-Json
if($manifest.project_ref -cne 'cdynahtkwtcinjzmxjcs' -or $manifest.status -cne 'complete'){throw 'Production backup manifest identity/status mismatch.'}
$archive=Join-Path $BackupDirectory ([string]$manifest.artifact)
if((Get-Item -LiteralPath $archive).Length -ne [int64]$manifest.encrypted_bytes -or (Get-Sha256Hex $archive) -cne [string]$manifest.ciphertext_sha256){throw 'Production backup ciphertext integrity failed.'}
$state=Get-Content -LiteralPath $RecoveryStatePath -Raw|ConvertFrom-Json
if($state.project_ref -cne 'cdynahtkwtcinjzmxjcs'){throw 'Production recovery state mismatch.'}

$pairs=@([pscustomobject]@{Label='A';Entry=$state.identity_a},[pscustomobject]@{Label='B';Entry=$state.identity_b})
foreach($pair in $pairs){
    $label=[string]$pair.Label;$entry=$pair.Entry;$identity=[string]$entry.artifact
    if((Get-Sha256Hex $identity) -cne ([string]$entry.sha256).ToLowerInvariant()){throw "Identity $label integrity failed."}
    Write-Host "Retrieve Production Identity $label passphrase. Stars will appear."
    $listing = & $AgePath --decrypt $identity | & $AgePath --decrypt --identity - $archive | & $PgRestorePath --list
    if($LASTEXITCODE -ne 0 -or @($listing).Count -lt 10){throw "Identity $label archive verification failed."}
    Write-Host "PRODUCTION IDENTITY $label ARCHIVE RECOVERY: PASS" -ForegroundColor Green
}
[pscustomobject]@{Validation='PASS';ProjectRef='cdynahtkwtcinjzmxjcs';CiphertextIntegrity=$true;IdentityARecovery=$true;IdentityBRecovery=$true;ArchiveReadable=$true;PlaintextWritten=$false;BackupDirectory=[IO.Path]::GetFullPath($BackupDirectory)}
