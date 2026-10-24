Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ProductionProjectRef = 'cdynahtkwtcinjzmxjcs'
$script:BackupManifestVersion = 2
$script:RequiredDatabaseArtifacts = @(
    'roles.sql.age',
    'schema.sql.age',
    'data.sql.age',
    'migration-history-schema.sql.age',
    'migration-history-data.sql.age',
    'managed-schema-customizations.sql.age'
)

function Assert-ExternalCommand {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required executable not found: $Path"
    }
}

function Assert-ProductionConnection {
    param([Parameter(Mandatory)][string]$DatabaseUrl, [switch]$RequirePassword)

    $uri = [Uri]$DatabaseUrl
    if ($uri.Scheme -notin @('postgres', 'postgresql')) { throw 'Production URL must use PostgreSQL.' }
    if ($uri.UserInfo -match ':') { throw 'Do not put the database password in PROD_DB_URL; use PGPASSWORD.' }
    if ($uri.UserInfo -ne "postgres.$script:ProductionProjectRef") { throw 'Production project reference mismatch.' }
    if ($uri.Host -notlike '*.pooler.supabase.com') { throw 'Production URL must use the Supabase session pooler.' }
    if ($uri.AbsolutePath -ne '/postgres') { throw 'Production database must be postgres.' }
    if ($RequirePassword -and [string]::IsNullOrWhiteSpace($env:PGPASSWORD)) { throw 'PGPASSWORD is required in the current process.' }
}

function Assert-SyntheticTestEnvironment {
    param([string]$Label = 'synthetic-local-only')
    if ($Label -match [regex]::Escape($script:ProductionProjectRef)) { throw 'Production project references are forbidden in synthetic tests.' }
    if (-not [string]::IsNullOrWhiteSpace($env:PROD_DB_URL) -or -not [string]::IsNullOrWhiteSpace($env:PGPASSWORD)) {
        throw 'Production database environment variables must be absent during synthetic tests.'
    }
}

function Assert-IsolatedContainer {
    param([Parameter(Mandatory)][string]$ContainerName)
    if ($ContainerName -notmatch '^agentdesk-recovery-[a-z0-9-]+$') { throw 'Unapproved recovery container name.' }
    $network = (& docker inspect --format '{{.HostConfig.NetworkMode}}' $ContainerName 2>$null).Trim()
    if ($LASTEXITCODE -ne 0 -or $network -ne 'none') { throw 'Recovery container must exist with Docker network mode none.' }
}

function New-ProcessInfo {
    param([string]$FilePath, [string[]]$ArgumentList)
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $FilePath
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    foreach ($argument in $ArgumentList) { [void]$info.ArgumentList.Add($argument) }
    return $info
}

function Invoke-CheckedNativePipeline {
    param(
        [Parameter(Mandatory)][string]$ProducerPath,
        [Parameter(Mandatory)][string[]]$ProducerArguments,
        [Parameter(Mandatory)][string]$ConsumerPath,
        [Parameter(Mandatory)][string[]]$ConsumerArguments,
        [string]$OutputPath,
        [switch]$ProducerNeedsDatabasePassword
    )

    $producerInfo = New-ProcessInfo $ProducerPath $ProducerArguments
    if (-not $ProducerNeedsDatabasePassword) {
        [void]$producerInfo.Environment.Remove('PGPASSWORD')
        [void]$producerInfo.Environment.Remove('PROD_DB_URL')
    }
    $producerInfo.RedirectStandardOutput = $true
    $producerInfo.RedirectStandardError = $true
    $consumerInfo = New-ProcessInfo $ConsumerPath $ConsumerArguments
    [void]$consumerInfo.Environment.Remove('PGPASSWORD')
    [void]$consumerInfo.Environment.Remove('PROD_DB_URL')
    $consumerInfo.RedirectStandardInput = $true
    $consumerInfo.RedirectStandardOutput = $true
    $consumerInfo.RedirectStandardError = $true

    $producer = [Diagnostics.Process]::new(); $producer.StartInfo = $producerInfo
    $consumer = [Diagnostics.Process]::new(); $consumer.StartInfo = $consumerInfo
    $hash = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
    try {
        if (-not $producer.Start()) { throw 'Producer process did not start.' }
        $producerError = $producer.StandardError.ReadToEndAsync()
        if (-not $consumer.Start()) { throw 'Consumer process did not start.' }
        $consumerError = $consumer.StandardError.ReadToEndAsync()
        $consumerOutput = $consumer.StandardOutput.ReadToEndAsync()

        $buffer = [byte[]]::new(65536)
        while (($count = $producer.StandardOutput.BaseStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $hash.AppendData($buffer, 0, $count)
            $consumer.StandardInput.BaseStream.Write($buffer, 0, $count)
        }
        $consumer.StandardInput.Close()
        $producer.WaitForExit(); $consumer.WaitForExit()

        $producerMessage = $producerError.GetAwaiter().GetResult()
        $consumerMessage = $consumerError.GetAwaiter().GetResult()
        $null = $consumerOutput.GetAwaiter().GetResult()
        if ($producer.ExitCode -ne 0) { throw "Producer failed with exit code $($producer.ExitCode): $producerMessage" }
        if ($consumer.ExitCode -ne 0) { throw "Consumer failed with exit code $($consumer.ExitCode): $consumerMessage" }
        if ($OutputPath -and ((-not (Test-Path -LiteralPath $OutputPath)) -or (Get-Item -LiteralPath $OutputPath).Length -eq 0)) {
            throw "Expected output is missing or empty: $OutputPath"
        }
        return [Convert]::ToHexString($hash.GetHashAndReset()).ToLowerInvariant()
    }
    finally {
        $hash.Dispose()
        foreach ($process in @($producer, $consumer)) {
            if (-not $process.HasExited) { $process.Kill($true) }
            $process.Dispose()
        }
    }
}

function Get-DecryptedSha256 {
    param([string]$AgePath, [string]$IdentityPath, [string]$EncryptedPath)
    $info = New-ProcessInfo $AgePath @('--decrypt', '--identity', $IdentityPath, $EncryptedPath)
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new(); $process.StartInfo = $info
    $hash = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
    try {
        [void]$process.Start(); $errorTask = $process.StandardError.ReadToEndAsync()
        $buffer = [byte[]]::new(65536)
        while (($count = $process.StandardOutput.BaseStream.Read($buffer, 0, $buffer.Length)) -gt 0) { $hash.AppendData($buffer, 0, $count) }
        $process.WaitForExit(); $message = $errorTask.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw "age decryption verification failed: $message" }
        return [Convert]::ToHexString($hash.GetHashAndReset()).ToLowerInvariant()
    }
    finally { $hash.Dispose(); $process.Dispose() }
}

function Write-EncryptedChecksums {
    param([string]$Directory)
    $root = [IO.Path]::GetFullPath($Directory)
    $lines = Get-ChildItem -LiteralPath $Directory -Filter '*.age' -File -Recurse |
        Sort-Object FullName |
        ForEach-Object {
            $relative = [IO.Path]::GetRelativePath($root, $_.FullName).Replace('\','/')
            '{0} *{1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $relative
        }
    $lines | Set-Content -LiteralPath (Join-Path $Directory 'SHA256SUMS.txt') -Encoding ascii
}

function Test-EncryptedChecksums {
    param([string]$Directory)
    foreach ($line in Get-Content -LiteralPath (Join-Path $Directory 'SHA256SUMS.txt')) {
        if ($line -notmatch '^([0-9a-f]{64}) \*(.+)$') { throw "Invalid checksum line: $line" }
        $actual = (Get-FileHash -LiteralPath (Join-Path $Directory $Matches[2]) -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne $Matches[1]) { throw "Checksum mismatch: $($Matches[2])" }
    }
}

function Assert-SafeRelativeBackupPath {
    param([Parameter(Mandatory)][string]$Path)
    if ([IO.Path]::IsPathRooted($Path) -or $Path -match '(^|[\\/])\.\.([\\/]|$)' -or $Path.IndexOf([char]0) -ge 0) {
        throw "Unsafe backup-relative path: $Path"
    }
}

function Get-FileSha256Lower {
    param([Parameter(Mandatory)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-BackupManifest {
    param(
        [Parameter(Mandatory)][string]$Directory,
        [switch]$RequireCompleteMarker
    )
    $manifestPath = Join-Path $Directory 'manifest.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Backup manifest is missing.' }
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json -Depth 20
    if ($manifest.manifest_version -ne $script:BackupManifestVersion) { throw 'Unsupported backup manifest version.' }
    if ($manifest.project_ref -ne $script:ProductionProjectRef -and $manifest.project_ref -ne 'synthetic-local-only') {
        throw 'Backup manifest project reference mismatch.'
    }
    if ($manifest.status -ne 'complete') { throw 'Backup manifest is not complete.' }
    if ([string]::IsNullOrWhiteSpace($manifest.backup_id) -or [string]::IsNullOrWhiteSpace($manifest.created_utc)) {
        throw 'Backup manifest identity is incomplete.'
    }
    if ([string]::IsNullOrWhiteSpace($manifest.database_version) -or [string]::IsNullOrWhiteSpace($manifest.application_commit)) {
        throw 'Backup manifest recovery metadata is incomplete.'
    }
    $artifacts = @($manifest.artifacts)
    $names = @($artifacts | ForEach-Object { [string]$_.name })
    if (($names | Sort-Object -Unique).Count -ne $names.Count) { throw 'Backup manifest contains duplicate artifact names.' }
    foreach ($required in $script:RequiredDatabaseArtifacts) {
        if ($required -notin $names) { throw "Required database artifact is missing: $required" }
    }
    foreach ($artifact in $artifacts) {
        Assert-SafeRelativeBackupPath ([string]$artifact.name)
        $path = Join-Path $Directory ([string]$artifact.name)
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Manifest artifact is missing: $($artifact.name)" }
        $item = Get-Item -LiteralPath $path
        if ([int64]$artifact.encrypted_bytes -ne $item.Length) { throw "Artifact size mismatch: $($artifact.name)" }
        if ([string]$artifact.plaintext_sha256 -notmatch '^[0-9a-f]{64}$') { throw "Artifact plaintext hash is invalid: $($artifact.name)" }
        if ([string]$artifact.ciphertext_sha256 -notmatch '^[0-9a-f]{64}$' -or (Get-FileSha256Lower $path) -ne $artifact.ciphertext_sha256) {
            throw "Artifact hash mismatch: $($artifact.name)"
        }
    }
    $storage = $manifest.storage
    if ($null -eq $storage -or -not $storage.inventory_verified) { throw 'Storage inventory is missing or unverified.' }
    $objects = @($storage.objects)
    $buckets = @($storage.buckets)
    if ([int64]$storage.bucket_count -ne $buckets.Count) { throw 'Storage bucket count does not match its manifest.' }
    $paths = @($objects | ForEach-Object { "$( $_.bucket )/$($_.path)" })
    if (@($paths | Sort-Object -Unique).Count -ne $paths.Count) { throw 'Storage manifest contains a duplicate object path.' }
    if ([int64]$storage.object_count -ne $objects.Count) { throw 'Storage object count does not match its manifest.' }
    foreach ($object in $objects) {
        if ([string]::IsNullOrWhiteSpace($object.bucket) -or [string]::IsNullOrWhiteSpace($object.path)) { throw 'Storage object identity is incomplete.' }
        Assert-SafeRelativeBackupPath ([string]$object.encrypted_artifact)
        $objectArtifact = Join-Path $Directory ([string]$object.encrypted_artifact)
        if (-not (Test-Path -LiteralPath $objectArtifact -PathType Leaf)) { throw "Storage object artifact is missing: $($object.encrypted_artifact)" }
        if ([string]$object.plaintext_sha256 -notmatch '^[0-9a-f]{64}$') { throw "Storage object hash is invalid: $($object.path)" }
        if ([string]$object.ciphertext_sha256 -notmatch '^[0-9a-f]{64}$' -or (Get-FileSha256Lower $objectArtifact) -ne $object.ciphertext_sha256) {
            throw "Storage ciphertext hash mismatch: $($object.path)"
        }
    }
    if ($RequireCompleteMarker) {
        if (Test-Path -LiteralPath (Join-Path $Directory 'BACKUP_INCOMPLETE')) { throw 'Incomplete marker is present.' }
        if (-not (Test-Path -LiteralPath (Join-Path $Directory 'BACKUP_COMPLETE') -PathType Leaf)) { throw 'Completion marker is missing.' }
    }
    return $manifest
}

function Write-AtomicCompletionMarker {
    param([Parameter(Mandatory)][string]$Directory)
    $temporary = Join-Path $Directory 'BACKUP_COMPLETE.tmp'
    $final = Join-Path $Directory 'BACKUP_COMPLETE'
    'Verified complete encrypted backup set.' | Set-Content -LiteralPath $temporary -Encoding ascii -NoNewline
    try { [IO.File]::Move($temporary, $final, $false) }
    catch { throw "Could not atomically publish completion marker from '$temporary' to '$final': $($_.Exception.Message)" }
}
