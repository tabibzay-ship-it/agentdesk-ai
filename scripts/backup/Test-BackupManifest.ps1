Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. "$PSScriptRoot\Backup.Common.ps1"
Assert-SyntheticTestEnvironment

$root=Join-Path $PSScriptRoot ('.manifest-test-work-'+[Guid]::NewGuid().ToString('N'))
$passed=0; $failed=0
function Invoke-Case([string]$Name,[scriptblock]$Body,[bool]$ShouldFail=$false){
    try { & $Body; if($ShouldFail){throw 'Unsafe case unexpectedly passed.'}; $script:passed++; "PASS $Name" }
    catch { if($ShouldFail){$script:passed++; "PASS $Name (rejected)"}else{$script:failed++; "FAIL $Name :: $($_.Exception.Message) :: $($_.ScriptStackTrace)"} }
}
function New-Fixture([string]$Name){
    $dir=Join-Path $root $Name; New-Item -ItemType Directory -Path (Join-Path $dir 'storage') -Force|Out-Null
    $artifacts=@(); foreach($file in $script:RequiredDatabaseArtifacts){$path=Join-Path $dir $file;'synthetic'|Set-Content -LiteralPath $path -NoNewline;$artifacts+=[ordered]@{name=$file;encrypted_bytes=(Get-Item $path).Length;ciphertext_sha256=Get-FileSha256Lower $path;plaintext_sha256=('0'*64);coverage='synthetic'}}
    $object='storage/00000001.object.age'; 'ciphertext'|Set-Content -LiteralPath (Join-Path $dir $object) -NoNewline
    $manifest=[ordered]@{manifest_version=2;backup_id=$Name;project_ref='synthetic-local-only';created_utc=[DateTime]::UtcNow.ToString('o');database_version='17.synthetic';application_commit='synthetic';status='complete';artifacts=$artifacts;storage=[ordered]@{inventory_verified=$true;bucket_count=1;object_count=1;buckets=@([ordered]@{name='private';public=$false});objects=@([ordered]@{bucket='private';path='one.txt';size=3;encrypted_artifact=$object;plaintext_sha256=('1'*64);ciphertext_sha256=Get-FileSha256Lower (Join-Path $dir $object)})};required_recovery_dependencies=@('age identity','PostgreSQL 17','Supabase-compatible services')}
    $manifest|ConvertTo-Json -Depth 20|Set-Content -LiteralPath (Join-Path $dir 'manifest.json') -Encoding utf8NoBOM
    Write-AtomicCompletionMarker $dir; return $dir
}
try {
    New-Item -ItemType Directory -Path $root|Out-Null
    Invoke-Case 'valid manifest' {Test-BackupManifest (New-Fixture 'valid') -RequireCompleteMarker|Out-Null}
    Invoke-Case 'missing component' {$d=New-Fixture 'missing';Remove-Item (Join-Path $d 'roles.sql.age');Test-BackupManifest $d -RequireCompleteMarker|Out-Null} $true
    Invoke-Case 'corrupt artifact' {$d=New-Fixture 'corrupt';Add-Content (Join-Path $d 'data.sql.age') 'tamper';Test-BackupManifest $d -RequireCompleteMarker|Out-Null} $true
    Invoke-Case 'missing migration ledger' {$d=New-Fixture 'ledger';Remove-Item (Join-Path $d 'migration-history-data.sql.age');Test-BackupManifest $d -RequireCompleteMarker|Out-Null} $true
    Invoke-Case 'missing managed customization' {$d=New-Fixture 'managed';Remove-Item (Join-Path $d 'managed-schema-customizations.sql.age');Test-BackupManifest $d -RequireCompleteMarker|Out-Null} $true
    Invoke-Case 'duplicate object path' {$d=New-Fixture 'duplicate';$m=Get-Content (Join-Path $d 'manifest.json') -Raw|ConvertFrom-Json -Depth 20;$m.storage.objects=@($m.storage.objects)+@($m.storage.objects);$m.storage.object_count=2;$m|ConvertTo-Json -Depth 20|Set-Content (Join-Path $d 'manifest.json');Test-BackupManifest $d|Out-Null} $true
    Invoke-Case 'missing storage artifact' {$d=New-Fixture 'storage-missing';Remove-Item (Join-Path $d 'storage/00000001.object.age');Test-BackupManifest $d|Out-Null} $true
    Invoke-Case 'object hash malformed' {$d=New-Fixture 'hash';$m=Get-Content (Join-Path $d 'manifest.json') -Raw|ConvertFrom-Json -Depth 20;$m.storage.objects[0].plaintext_sha256='bad';$m|ConvertTo-Json -Depth 20|Set-Content (Join-Path $d 'manifest.json');Test-BackupManifest $d|Out-Null} $true
    Invoke-Case 'interrupted backup' {$d=New-Fixture 'interrupted';'x'|Set-Content (Join-Path $d 'BACKUP_INCOMPLETE');Test-BackupManifest $d -RequireCompleteMarker|Out-Null} $true
    Invoke-Case 'invalid manifest status' {$d=New-Fixture 'status';$m=Get-Content (Join-Path $d 'manifest.json') -Raw|ConvertFrom-Json -Depth 20;$m.status='failed';$m|ConvertTo-Json -Depth 20|Set-Content (Join-Path $d 'manifest.json');Test-BackupManifest $d|Out-Null} $true
    Invoke-Case 'incorrect project reference' {$d=New-Fixture 'project';$m=Get-Content (Join-Path $d 'manifest.json') -Raw|ConvertFrom-Json -Depth 20;$m.project_ref='wrong';$m|ConvertTo-Json -Depth 20|Set-Content (Join-Path $d 'manifest.json');Test-BackupManifest $d|Out-Null} $true
    Invoke-Case 'unsafe artifact path' {$d=New-Fixture 'path';$m=Get-Content (Join-Path $d 'manifest.json') -Raw|ConvertFrom-Json -Depth 20;$m.artifacts[0].name='../escape.age';$m|ConvertTo-Json -Depth 20|Set-Content (Join-Path $d 'manifest.json');Test-BackupManifest $d|Out-Null} $true
    Invoke-Case 'incorrect complete marker' {$d=New-Fixture 'marker';Remove-Item (Join-Path $d 'BACKUP_COMPLETE');Test-BackupManifest $d -RequireCompleteMarker|Out-Null} $true
    if($failed){throw "$failed backup manifest tests failed."}; "RESULT PASS=$passed FAIL=$failed"
} finally { if(Test-Path $root){Remove-Item -LiteralPath $root -Recurse -Force} }
