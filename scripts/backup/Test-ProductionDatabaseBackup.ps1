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
function New-NativeProcess([string]$Path,[string[]]$Arguments){$i=[Diagnostics.ProcessStartInfo]::new();$i.FileName=$Path;$i.UseShellExecute=$false;$i.CreateNoWindow=$true;foreach($a in $Arguments){[void]$i.ArgumentList.Add($a)};$p=[Diagnostics.Process]::new();$p.StartInfo=$i;return $p}
function Test-ArchiveWithEncryptedIdentity([string]$Label,[string]$IdentityPath){
    Write-Host "Retrieve Production Identity $Label passphrase. Stars will appear."
    $identityLines=@(& $AgePath --decrypt $IdentityPath)
    if($LASTEXITCODE -ne 0 -or $identityLines.Count -lt 2){throw "Identity $Label decryption failed."}
    $identityText=($identityLines -join "`n")+"`n"
    $decrypt=New-NativeProcess $AgePath @('--decrypt','--identity','-',$archive)
    $decrypt.StartInfo.RedirectStandardInput=$true;$decrypt.StartInfo.RedirectStandardOutput=$true;$decrypt.StartInfo.RedirectStandardError=$true
    $hash=[Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
    try{
        [void]$decrypt.Start();$decryptError=$decrypt.StandardError.ReadToEndAsync()
        $decrypt.StandardInput.Write($identityText);$decrypt.StandardInput.Close();$identityText=$null;$identityLines=$null
        $buffer=[byte[]]::new(65536);$total=[int64]0;$magic=[byte[]]::new(5);$magicCount=0
        while(($count=$decrypt.StandardOutput.BaseStream.Read($buffer,0,$buffer.Length))-gt 0){
            if($magicCount-lt 5){$take=[Math]::Min(5-$magicCount,$count);[Array]::Copy($buffer,0,$magic,$magicCount,$take);$magicCount+=$take}
            $hash.AppendData($buffer,0,$count);$total+=$count
        }
        $decrypt.WaitForExit();$de=$decryptError.GetAwaiter().GetResult()
        if($decrypt.ExitCode-ne 0){throw "Identity $Label archive decryption failed: $de"}
        $plainHash=[Convert]::ToHexString($hash.GetHashAndReset()).ToLowerInvariant()
        if($plainHash-cne[string]$manifest.plaintext_sha256-or$total-lt 1024){throw "Identity $Label decrypted archive integrity failed."}
        if($magicCount-ne 5-or[Text.Encoding]::ASCII.GetString($magic)-cne'PGDMP'){throw "Identity $Label PostgreSQL custom archive header failed."}
    }finally{$identityText=$null;$identityLines=$null;$hash.Dispose();if(-not$decrypt.HasExited){$decrypt.Kill($true)};$decrypt.Dispose()}
}

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
    Test-ArchiveWithEncryptedIdentity $label $identity
    Write-Host "PRODUCTION IDENTITY $label ARCHIVE RECOVERY: PASS" -ForegroundColor Green
}
[pscustomobject]@{Validation='PASS';ProjectRef='cdynahtkwtcinjzmxjcs';CiphertextIntegrity=$true;IdentityARecovery=$true;IdentityBRecovery=$true;CustomArchiveHeader=$true;PlaintextHashMatch=$true;PlaintextWritten=$false;BackupDirectory=[IO.Path]::GetFullPath($BackupDirectory)}
