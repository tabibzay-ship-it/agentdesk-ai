[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$AgePath,
    [Parameter(Mandatory)][string]$AgeKeygenPath,
    [Parameter(Mandatory)][string]$UsbDestination,
    [Parameter(Mandatory)][string]$OneDriveDestination,
    [Parameter(Mandatory)][string]$StateDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-ExternalPath {
    param([string]$Path, [string]$Label)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Label does not exist."
    }
}

function Get-Sha256Hex {
    param([Parameter(Mandatory)][string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try {
            return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '')
        }
        finally { $sha.Dispose() }
    }
    finally { $stream.Dispose() }
}

function New-EncryptedIdentity {
    param([string]$Destination, [string]$Label, [string]$Timestamp)

    $final = Join-Path $Destination "agentdesk-staging-$Label-$Timestamp.identity.age"
    $partial = "$final.partial"
    if ((Test-Path -LiteralPath $final) -or (Test-Path -LiteralPath $partial)) {
        throw "Refusing to overwrite an existing $Label identity artifact."
    }

    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $AgeKeygenPath
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    if (-not $process.Start()) { throw "$Label identity generation could not start." }
    $identity = $process.StandardOutput.ReadToEnd()
    $keygenMessage = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($identity)) {
        throw "$Label identity generation failed."
    }
    $recipient = if ($keygenMessage -match 'Public key:\s*(age1[0-9a-z]+)') { $Matches[1] } else { '' }
    if ($recipient -notmatch '^age1[0-9a-z]+$') {
        throw "$Label recipient derivation failed."
    }

    try {
        Write-Host "Enter and confirm the unique $Label passphrase in the hidden age prompt."
        $identity | & $AgePath --passphrase --output $partial -
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $partial -PathType Leaf)) {
            throw "$Label identity encryption failed."
        }
        Move-Item -LiteralPath $partial -Destination $final -ErrorAction Stop
    }
    finally {
        $identity = $null
        $keygenMessage = $null
        if (Test-Path -LiteralPath $partial) {
            Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue
        }
    }

    [pscustomobject]@{
        Label = $Label
        Artifact = $final
        Recipient = $recipient
        Sha256 = Get-Sha256Hex -Path $final
        Bytes = (Get-Item -LiteralPath $final).Length
    }
}

Assert-ExternalPath $UsbDestination 'USB custody directory'
Assert-ExternalPath $OneDriveDestination 'OneDrive custody directory'
Assert-ExternalPath $StateDirectory 'Local state directory'
if (-not (Test-Path -LiteralPath $AgePath -PathType Leaf) -or
    -not (Test-Path -LiteralPath $AgeKeygenPath -PathType Leaf)) {
    throw 'Verified age binaries are unavailable.'
}

$repository = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
foreach ($destination in @($UsbDestination, $OneDriveDestination, $StateDirectory)) {
    $full = [IO.Path]::GetFullPath($destination)
    if ($full.StartsWith($repository, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Recovery artifacts and state are forbidden inside the repository.'
    }
}
if ([IO.Path]::GetPathRoot($UsbDestination) -eq [IO.Path]::GetPathRoot($OneDriveDestination)) {
    throw 'Identity custody destinations must use separate storage roots.'
}

$timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$a = New-EncryptedIdentity $UsbDestination 'identity-a' $timestamp
$b = New-EncryptedIdentity $OneDriveDestination 'identity-b' $timestamp

$statePath = Join-Path $StateDirectory "agentdesk-staging-recovery-$timestamp.public.json"
@{
    created_utc = $timestamp
    identity_a = @{ artifact = $a.Artifact; recipient = $a.Recipient; sha256 = $a.Sha256; bytes = $a.Bytes }
    identity_b = @{ artifact = $b.Artifact; recipient = $b.Recipient; sha256 = $b.Sha256; bytes = $b.Bytes }
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8

Write-Host ''
Write-Host 'Encrypted recovery identities created. No plaintext identity was written to disk.'
Write-Host 'Save both distinct passphrases in the independent password manager, clear the original inputs, and verify retrieval.'
Write-Host "Public state file: $statePath"
Read-Host 'Press Enter only after both password-manager entries are saved; retrieval will be verified in the next phase'
