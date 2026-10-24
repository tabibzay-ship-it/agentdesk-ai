Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Backup.Common.ps1"

function Assert-StorageAdapter {
    param([Parameter(Mandatory)][hashtable]$Adapter)
    foreach ($operation in @('ListBuckets','ListObjects','OpenRead')) {
        if (-not $Adapter.ContainsKey($operation) -or $Adapter[$operation] -isnot [scriptblock]) {
            throw "Storage adapter is missing operation: $operation"
        }
    }
}

function Get-StorageInventory {
    param(
        [Parameter(Mandatory)][hashtable]$Adapter,
        [ValidateRange(1,1000)][int]$PageSize = 100
    )
    Assert-StorageAdapter $Adapter
    $buckets = @(& $Adapter.ListBuckets)
    $seenBuckets = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $seenObjects = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $objects = [Collections.Generic.List[object]]::new()
    foreach ($bucket in $buckets) {
        $bucketName = [string]$bucket.name
        if ([string]::IsNullOrWhiteSpace($bucketName) -or -not $seenBuckets.Add($bucketName)) { throw "Invalid or duplicate storage bucket: $bucketName" }
        $cursor = $null
        do {
            $page = & $Adapter.ListObjects $bucketName $cursor $PageSize
            if ($null -eq $page -or $null -eq $page.items) { throw "Invalid storage page for bucket: $bucketName" }
            foreach ($item in @($page.items)) {
                $path = [string]$item.path
                if ([string]::IsNullOrWhiteSpace($path) -or -not $seenObjects.Add("$bucketName/$path")) { throw "Invalid or duplicate storage object path: $bucketName/$path" }
                if ([int64]$item.size -lt 0) { throw "Invalid storage object size: $bucketName/$path" }
                $objects.Add([pscustomobject]@{
                    bucket=$bucketName; path=$path; size=[int64]$item.size
                    content_type=[string]$item.content_type; etag=[string]$item.etag
                    metadata=$item.metadata
                })
            }
            $next = if ([string]::IsNullOrWhiteSpace([string]$page.next_cursor)) { $null } else { [string]$page.next_cursor }
            if ($next -and $next -eq $cursor) { throw "Storage pagination did not advance for bucket: $bucketName" }
            $cursor = $next
        } while ($null -ne $cursor)
    }
    return [pscustomobject]@{ buckets=$buckets; objects=$objects.ToArray() }
}

function Export-EncryptedStorageInventory {
    param(
        [Parameter(Mandatory)][hashtable]$Adapter,
        [Parameter(Mandatory)][string]$Destination,
        [Parameter(Mandatory)][string]$AgePath,
        [Parameter(Mandatory)][ValidateCount(2,8)][string[]]$AgeRecipient,
        [ValidateRange(1,1000)][int]$PageSize = 100
    )
    Assert-ExternalCommand $AgePath
    if (@($AgeRecipient | Sort-Object -Unique).Count -ne $AgeRecipient.Count) { throw 'Age recipients must be distinct.' }
    foreach ($recipient in $AgeRecipient) { if ($recipient -notmatch '^age1[0-9a-z]+$') { throw 'Invalid native age recipient.' } }
    $inventory = Get-StorageInventory -Adapter $Adapter -PageSize $PageSize
    $storageRoot = Join-Path $Destination 'storage'
    New-Item -ItemType Directory -Path $storageRoot -ErrorAction Stop | Out-Null
    $result = [Collections.Generic.List[object]]::new()
    $ordinal = 0
    foreach ($object in $inventory.objects) {
        $ordinal++
        $artifact = 'storage/{0:d8}.object.age' -f $ordinal
        $output = Join-Path $Destination $artifact
        $stream = & $Adapter.OpenRead $object.bucket $object.path
        if ($stream -isnot [IO.Stream] -or -not $stream.CanRead) { throw "Storage adapter returned no readable stream: $($object.bucket)/$($object.path)" }
        $ageArgs = @('--encrypt')
        foreach ($recipient in $AgeRecipient) { $ageArgs += @('--recipient',$recipient) }
        $ageArgs += @('--output',$output,'-')
        $info = New-ProcessInfo $AgePath $ageArgs
        $info.RedirectStandardInput=$true; $info.RedirectStandardError=$true
        $process=[Diagnostics.Process]::new(); $process.StartInfo=$info
        $hash=[Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
        try {
            [void]$process.Start(); $errorTask=$process.StandardError.ReadToEndAsync(); $buffer=[byte[]]::new(65536); $count=0L
            while(($read=$stream.Read($buffer,0,$buffer.Length)) -gt 0){ $hash.AppendData($buffer,0,$read); $process.StandardInput.BaseStream.Write($buffer,0,$read); $count += $read }
            $process.StandardInput.Close(); $process.WaitForExit(); $message=$errorTask.GetAwaiter().GetResult()
            if($process.ExitCode -ne 0){ throw "Storage encryption failed: $message" }
            if($count -ne $object.size){ throw "Storage object changed or was truncated: $($object.bucket)/$($object.path)" }
            $result.Add([pscustomobject]@{
                bucket=$object.bucket; path=$object.path; size=$count; content_type=$object.content_type
                etag=$object.etag; metadata=$object.metadata; encrypted_artifact=$artifact
                plaintext_sha256=[Convert]::ToHexString($hash.GetHashAndReset()).ToLowerInvariant()
                ciphertext_sha256=Get-FileSha256Lower $output
            })
        } finally { $stream.Dispose(); $hash.Dispose(); if(-not $process.HasExited){$process.Kill($true)}; $process.Dispose() }
    }
    # Re-enumeration makes completion fail closed if the remote inventory changed mid-export.
    $after = Get-StorageInventory -Adapter $Adapter -PageSize $PageSize
    $beforeFingerprint = @($inventory.objects | ForEach-Object { "$($_.bucket)`u{0}$($_.path)`u{0}$($_.size)`u{0}$($_.etag)" }) -join "`n"
    $afterFingerprint = @($after.objects | ForEach-Object { "$($_.bucket)`u{0}$($_.path)`u{0}$($_.size)`u{0}$($_.etag)" }) -join "`n"
    if ($beforeFingerprint -cne $afterFingerprint) { throw 'Storage inventory changed during export.' }
    return [pscustomobject]@{
        inventory_verified=$true; bucket_count=@($inventory.buckets).Count; object_count=$result.Count
        buckets=$inventory.buckets; objects=$result.ToArray()
    }
}
