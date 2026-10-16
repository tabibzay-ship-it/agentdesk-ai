[CmdletBinding(SupportsShouldProcess, ConfirmImpact='High')]
param(
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][ValidateCount(2, 8)][string[]]$AgeRecipient,
    [string]$SupabasePath = 'D:\AgentDesk-Supabase-Tools\bin\supabase.exe',
    [string]$AgePath = "$PSScriptRoot\..\..\.tools\age\v1.3.2\age\age.exe",
    [switch]$ProductionDataAccessApproved
)
. "$PSScriptRoot\Backup.Common.ps1"

if (-not $ProductionDataAccessApproved) { throw 'Production backup approval is required.' }
if (-not $PSCmdlet.ShouldProcess('Supabase production cdynahtkwtcinjzmxjcs', 'Read and encrypt a logical backup')) { return }
Assert-ExternalCommand $SupabasePath; Assert-ExternalCommand $AgePath
if (-not $env:PROD_DB_URL) { throw 'PROD_DB_URL must be supplied without a password.' }
Assert-ProductionConnection $env:PROD_DB_URL -RequirePassword

$repo = (Resolve-Path "$PSScriptRoot\..\..").Path
$destinationPath = [IO.Path]::GetFullPath($Destination)
if ($destinationPath.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase)) { throw 'Backup destination must be outside the repository.' }
if (-not (Test-Path -LiteralPath $destinationPath -PathType Container)) { throw 'Approved encrypted destination must already exist.' }
$drive = Get-PSDrive -Name ([IO.Path]::GetPathRoot($destinationPath).TrimEnd(':\'))
if ($drive.Free -lt 500MB) { throw 'At least 500 MiB free space is required.' }

$run = Join-Path $destinationPath ([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssZ'))
New-Item -ItemType Directory -Path $run | Out-Null
$incompleteMarker = Join-Path $run 'BACKUP_INCOMPLETE'
$completeMarker = Join-Path $run 'BACKUP_COMPLETE'
[DateTime]::UtcNow.ToString('o') | Set-Content -LiteralPath $incompleteMarker -Encoding ascii
$base = @('db','dump','--db-url',$env:PROD_DB_URL)
$jobs = @(
    @{ Name='roles.sql'; Args=@('--role-only') },
    @{ Name='schema.sql'; Args=@() },
    @{ Name='data.sql'; Args=@('--data-only','--use-copy','--exclude','storage.buckets_vectors','--exclude','storage.vector_indexes') }
)
$metadata = [ordered]@{ project_ref=$script:ProductionProjectRef; created_utc=[DateTime]::UtcNow.ToString('o'); status='incomplete'; artifacts=@() }
try {
    if (@($AgeRecipient | Sort-Object -Unique).Count -ne $AgeRecipient.Count) {
        throw 'Age recipients must be distinct.'
    }
    foreach ($job in $jobs) {
        $output = Join-Path $run ($job.Name + '.age')
        $ageArguments = @('--encrypt')
        foreach ($recipient in $AgeRecipient) {
            if ($recipient -notmatch '^age1[0-9a-z]+$') { throw 'Invalid native age recipient.' }
            $ageArguments += @('--recipient', $recipient)
        }
        $ageArguments += @('--output', $output, '-')
        $plainHash = Invoke-CheckedNativePipeline $SupabasePath ($base + $job.Args) $AgePath $ageArguments $output -ProducerNeedsDatabasePassword
        $metadata.artifacts += [ordered]@{ name=[IO.Path]::GetFileName($output); plaintext_sha256=$plainHash }
    }
    $metadata.status = 'complete'
    $metadata.completed_utc = [DateTime]::UtcNow.ToString('o')
    $metadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $run 'metadata.json') -Encoding utf8NoBOM
    Write-EncryptedChecksums $run
    Test-EncryptedChecksums $run
    'Verified complete encrypted backup set.' | Set-Content -LiteralPath $completeMarker -Encoding ascii
    Remove-Item -LiteralPath $incompleteMarker
    Write-Output "Encrypted backup prepared at $run"
}
catch {
    $metadata.status = 'failed'
    $metadata.failed_utc = [DateTime]::UtcNow.ToString('o')
    $metadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $run 'metadata.failed.json') -Encoding utf8NoBOM
    throw "Encrypted backup failed. The quarantined partial set remains marked BACKUP_INCOMPLETE at: $run"
}
