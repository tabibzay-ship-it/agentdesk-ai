Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. "$PSScriptRoot\Storage.Backup.ps1"
Assert-SyntheticTestEnvironment

$age="$PSScriptRoot\..\..\.tools\age\v1.3.2\age\age.exe"
$keygen="$PSScriptRoot\..\..\.tools\age\v1.3.2\age\age-keygen.exe"
Assert-ExternalCommand $age;Assert-ExternalCommand $keygen
$root=Join-Path $PSScriptRoot ('.storage-test-work-'+[Guid]::NewGuid().ToString('N'))
$passed=0;$failed=0
function Invoke-Case([string]$Name,[scriptblock]$Body,[bool]$ShouldFail=$false){try{& $Body;if($ShouldFail){throw 'Unsafe case unexpectedly passed.'};$script:passed++;"PASS $Name"}catch{if($ShouldFail){$script:passed++;"PASS $Name (rejected)"}else{$script:failed++;"FAIL $Name :: $($_.Exception.Message)"}}}
function New-MockAdapter([hashtable]$Data,[switch]$Duplicate,[switch]$WrongSize){
    $keys=@($Data.Keys|Sort-Object)
    return @{
        ListBuckets={@([pscustomobject]@{name='private';public=$false;file_size_limit=1048576})}.GetNewClosure()
        ListObjects={param($bucket,$cursor,$pageSize);$offset=if($cursor){[int]$cursor}else{0};$slice=@($keys|Select-Object -Skip $offset -First $pageSize);$items=@($slice|ForEach-Object{[pscustomobject]@{path=$_.Substring(8);size=if($WrongSize){$Data[$_].Length+1}else{$Data[$_].Length};content_type='application/octet-stream';etag="synthetic-$($Data[$_].Length)";metadata=@{synthetic=$true}}});if($Duplicate -and $items.Count){$items=@($items[0],$items[0])};[pscustomobject]@{items=$items;next_cursor=if($offset+$slice.Count -lt $keys.Count){[string]($offset+$slice.Count)}else{$null}}}.GetNewClosure()
        OpenRead={param($bucket,$path);$key="$bucket/$path";[IO.MemoryStream]::new([byte[]]$Data[$key],$false)}.GetNewClosure()
    }
}
try{
    New-Item -ItemType Directory -Path $root|Out-Null
    $ids=@();$recipients=@();foreach($n in 1..3){$id=Join-Path $root "identity-$n.txt";& $keygen -o $id 2>$null;if($LASTEXITCODE){throw 'Synthetic identity generation failed.'};$ids+=$id;$recipients+=(& $keygen -y $id).Trim()}
    $data=@{'private/a.txt'=[Text.Encoding]::UTF8.GetBytes('alpha');'private/folder/b.bin'=[byte[]](1,2,3,4,5)}
    $dest=Join-Path $root 'valid';New-Item -ItemType Directory -Path $dest|Out-Null
    $storage=$null
    Invoke-Case 'paginated private Storage export' {$script:storage=Export-EncryptedStorageInventory -Adapter (New-MockAdapter $data) -Destination $dest -AgePath $age -AgeRecipient $recipients[0..1] -PageSize 1;if($storage.object_count -ne 2){throw 'Wrong object count.'}}
    $artifacts=@();foreach($name in $script:RequiredDatabaseArtifacts){$path=Join-Path $dest $name;'synthetic-db-artifact'|Set-Content -LiteralPath $path -NoNewline;$artifacts+=[ordered]@{name=$name;coverage='synthetic';plaintext_sha256=('0'*64);encrypted_bytes=(Get-Item $path).Length;ciphertext_sha256=Get-FileSha256Lower $path}}
    $manifest=[ordered]@{manifest_version=2;backup_id='synthetic-storage';project_ref='synthetic-local-only';created_utc=[DateTime]::UtcNow.ToString('o');database_version='17.synthetic';application_commit='synthetic';status='complete';artifacts=$artifacts;storage=$storage;required_recovery_dependencies=@('synthetic')}
    $manifest|ConvertTo-Json -Depth 20|Set-Content -LiteralPath (Join-Path $dest 'manifest.json') -Encoding utf8NoBOM;Write-EncryptedChecksums $dest;Write-AtomicCompletionMarker $dest
    Invoke-Case 'first identity decrypts every object' {foreach($o in $storage.objects){if((Get-DecryptedSha256 $age $ids[0] (Join-Path $dest $o.encrypted_artifact)) -ne $o.plaintext_sha256){throw 'Hash mismatch.'}}}
    Invoke-Case 'second identity decrypts every object' {foreach($o in $storage.objects){if((Get-DecryptedSha256 $age $ids[1] (Join-Path $dest $o.encrypted_artifact)) -ne $o.plaintext_sha256){throw 'Hash mismatch.'}}}
    $restoreRoot=Join-Path $root 'restored';New-Item -ItemType Directory -Path $restoreRoot|Out-Null
    $adapterPath=Join-Path $root 'restore-adapter.ps1';$escaped=$restoreRoot.Replace("'","''")
    @"
`$root='$escaped'
@{
 BeginObject={param(`$bucket,`$path,`$contentType,`$metadata);`$final=Join-Path `$root (`$bucket+'/'+`$path);`$parent=Split-Path `$final -Parent;New-Item -ItemType Directory -Path `$parent -Force|Out-Null;`$partial=`$final+'.partial';@{Stream=[IO.File]::Open(`$partial,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);Partial=`$partial;Final=`$final}}.GetNewClosure()
 WriteChunk={param(`$handle,[byte[]]`$buffer,[int]`$count);`$handle.Stream.Write(`$buffer,0,`$count)}
 CompleteObject={param(`$handle);`$handle.Stream.Dispose();[IO.File]::Move(`$handle.Partial,`$handle.Final)}
 AbortObject={param(`$handle);`$handle.Stream.Dispose();if(Test-Path `$handle.Partial){Remove-Item -LiteralPath `$handle.Partial -Force}}
 Reconcile={param(`$expected);@((Get-ChildItem -LiteralPath `$root -File -Recurse|Where-Object Extension -ne '.partial')).Count -eq [int]`$expected.object_count}.GetNewClosure()
}
"@|Set-Content -LiteralPath $adapterPath -Encoding utf8NoBOM
    Invoke-Case 'streaming isolated Storage restore and reconciliation' {& "$PSScriptRoot\Restore-EncryptedStorage.ps1" -BackupDirectory $dest -IdentityPath $ids[0] -RestoreAdapterPath $adapterPath -AgePath $age -Confirm:$false|Out-Null;foreach($key in $data.Keys){$restored=Join-Path $restoreRoot $key;if(-not (Test-Path $restored) -or -not [Linq.Enumerable]::SequenceEqual([byte[]](Get-Content -LiteralPath $restored -AsByteStream -Raw),[byte[]]$data[$key])){throw "Restored content mismatch: $key"}}}
    Invoke-Case 'incorrect recovery identity' {Get-DecryptedSha256 $age $ids[2] (Join-Path $dest $storage.objects[0].encrypted_artifact)|Out-Null} $true
    Invoke-Case 'duplicate object path' {$d=Join-Path $root 'duplicate';New-Item -ItemType Directory $d|Out-Null;Export-EncryptedStorageInventory -Adapter (New-MockAdapter $data -Duplicate) -Destination $d -AgePath $age -AgeRecipient $recipients[0..1]|Out-Null} $true
    Invoke-Case 'changed or truncated object' {$d=Join-Path $root 'size';New-Item -ItemType Directory $d|Out-Null;Export-EncryptedStorageInventory -Adapter (New-MockAdapter $data -WrongSize) -Destination $d -AgePath $age -AgeRecipient $recipients[0..1]|Out-Null} $true
    Invoke-Case 'duplicate encryption recipients' {$d=Join-Path $root 'recipients';New-Item -ItemType Directory $d|Out-Null;Export-EncryptedStorageInventory -Adapter (New-MockAdapter $data) -Destination $d -AgePath $age -AgeRecipient @($recipients[0],$recipients[0])|Out-Null} $true
    Invoke-Case 'missing encryption executable' {$d=Join-Path $root 'no-age';New-Item -ItemType Directory $d|Out-Null;Export-EncryptedStorageInventory -Adapter (New-MockAdapter $data) -Destination $d -AgePath (Join-Path $root 'missing.exe') -AgeRecipient $recipients[0..1]|Out-Null} $true
    Invoke-Case 'no plaintext object persisted' {if(Get-ChildItem -LiteralPath (Join-Path $dest 'storage') -File -Recurse|Where-Object Extension -ne '.age'){throw 'Unexpected plaintext Storage artifact.'}}
    if($failed){throw "$failed synthetic Storage tests failed."};"RESULT PASS=$passed FAIL=$failed"
}finally{if(Test-Path $root){Remove-Item -LiteralPath $root -Recurse -Force}}
