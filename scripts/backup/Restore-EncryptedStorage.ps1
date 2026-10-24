[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][string]$BackupDirectory,
    [Parameter(Mandatory)][string]$IdentityPath,
    [Parameter(Mandatory)][string]$RestoreAdapterPath,
    [string]$AgePath = "$PSScriptRoot\..\..\.tools\age\v1.3.2\age\age.exe"
)
. "$PSScriptRoot\Backup.Common.ps1"
Assert-ExternalCommand $AgePath
if (-not (Test-Path -LiteralPath $RestoreAdapterPath -PathType Leaf)) { throw 'Reviewed Storage restore adapter is required.' }
$manifest=Test-BackupManifest $BackupDirectory -RequireCompleteMarker
$adapter=& $RestoreAdapterPath
foreach($operation in @('BeginObject','WriteChunk','CompleteObject','AbortObject','Reconcile')){if($adapter -isnot [hashtable] -or $adapter[$operation] -isnot [scriptblock]){throw "Storage restore adapter is missing operation: $operation"}}
if(-not $PSCmdlet.ShouldProcess('explicitly isolated disposable Storage target','stream and verify private Storage objects')){return}
foreach($object in @($manifest.storage.objects)){
    $encrypted=Join-Path $BackupDirectory ([string]$object.encrypted_artifact)
    $info=New-ProcessInfo $AgePath @('--decrypt','--identity',$IdentityPath,$encrypted)
    $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $process=[Diagnostics.Process]::new();$process.StartInfo=$info
    $hash=[Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
    $handle=$null;$completed=$false
    try{
        [void]$process.Start();$errorTask=$process.StandardError.ReadToEndAsync()
        $handle=& $adapter.BeginObject $object.bucket $object.path $object.content_type $object.metadata
        $buffer=[byte[]]::new(65536);$count=0L
        while(($read=$process.StandardOutput.BaseStream.Read($buffer,0,$buffer.Length)) -gt 0){$hash.AppendData($buffer,0,$read);& $adapter.WriteChunk $handle $buffer $read;$count+=$read}
        $process.WaitForExit();$message=$errorTask.GetAwaiter().GetResult()
        if($process.ExitCode -ne 0){throw "Storage decryption failed: $message"}
        if($count -ne [int64]$object.size -or [Convert]::ToHexString($hash.GetHashAndReset()).ToLowerInvariant() -ne $object.plaintext_sha256){throw "Storage plaintext integrity mismatch: $($object.bucket)/$($object.path)"}
        & $adapter.CompleteObject $handle;$completed=$true
    }finally{if(-not $completed -and $null -ne $handle){& $adapter.AbortObject $handle};$hash.Dispose();$process.Dispose()}
}
$result=& $adapter.Reconcile $manifest.storage
if($result -ne $true){throw 'Restored Storage metadata-to-object reconciliation failed.'}
'Encrypted Storage restore, plaintext hash verification, and reconciliation passed.'
