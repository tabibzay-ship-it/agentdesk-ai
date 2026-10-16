Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ProductionProjectRef = 'cdynahtkwtcinjzmxjcs'

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
    $lines = Get-ChildItem -LiteralPath $Directory -Filter '*.age' -File |
        Sort-Object Name |
        ForEach-Object { '{0} *{1}' -f (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(), $_.Name }
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
