[CmdletBinding()]
param(
    [string]$AgePath,
    [string]$AgeKeygenPath,
    [string]$UsbDestination = 'E:\AgentDesk-Production-Recovery-Custody',
    [string]$OneDriveDestination = 'C:\Users\Abdul Halim Tabibzay\OneDrive\AgentDesk-Production-Recovery-Custody',
    [string]$StateDirectory = 'C:\Users\Abdul Halim Tabibzay\Documents\AgentDesk-Production-Recovery-State',
    [string]$ExpectedUsbSerial = '09010f68e9482f693f08',
    [switch]$PreflightOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($AgePath)) {
    $AgePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\.tools\age\v1.3.2\age\age.exe'))
}
if ([string]::IsNullOrWhiteSpace($AgeKeygenPath)) {
    $AgeKeygenPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\.tools\age\v1.3.2\age\age-keygen.exe'))
}

function Get-Sha256Hex {
    param([Parameter(Mandatory)][string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
        finally { $sha.Dispose() }
    }
    finally { $stream.Dispose() }
}

function Assert-Directory {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Label)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { throw "$Label does not exist." }
}

function New-EncryptedIdentity {
    param([Parameter(Mandatory)][string]$Destination, [Parameter(Mandatory)][string]$Label, [Parameter(Mandatory)][string]$Timestamp)

    $final = Join-Path $Destination "agentdesk-production-$Label-$Timestamp.identity.age"
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
    $exitCode = $process.ExitCode
    $process.Dispose()
    if ($exitCode -ne 0 -or [string]::IsNullOrWhiteSpace($identity)) { throw "$Label identity generation failed." }
    $recipient = if ($keygenMessage -match 'Public key:\s*(age1[0-9a-z]+)') { $Matches[1] } else { '' }
    if ($recipient -notmatch '^age1[0-9a-z]+$') { throw "$Label recipient derivation failed." }

    try {
        Write-Host "Enter and confirm a unique password-manager-generated passphrase for $Label in the hidden age prompt."
        $identity | & $AgePath --passphrase --output $partial -
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $partial -PathType Leaf)) {
            throw "$Label identity encryption failed."
        }
        Move-Item -LiteralPath $partial -Destination $final -ErrorAction Stop
    }
    finally {
        $identity = $null
        $keygenMessage = $null
        if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue }
    }

    [pscustomobject]@{
        Label = $Label
        Artifact = $final
        Recipient = $recipient
        Sha256 = Get-Sha256Hex $final
        Bytes = (Get-Item -LiteralPath $final).Length
    }
}

foreach ($tool in @($AgePath, $AgeKeygenPath)) {
    if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Verified age tool is unavailable: $tool" }
    $version = (& $tool --version 2>$null)
    if ($LASTEXITCODE -ne 0 -or $version -notmatch 'v1\.3\.2') { throw "Verified age v1.3.2 is required: $tool" }
}
Assert-Directory $UsbDestination 'USB custody directory'
Assert-Directory $OneDriveDestination 'OneDrive custody directory'
Assert-Directory $StateDirectory 'Public state directory'

$partition = Get-Partition -DriveLetter E -ErrorAction Stop
$disk = $partition | Get-Disk
if ($disk.BusType -ne 'USB' -or $disk.FriendlyName -notmatch 'SanDisk' -or $disk.SerialNumber.Trim() -ne $ExpectedUsbSerial) {
    throw 'USB recovery destination identity does not match the approved SanDisk device.'
}
if ($disk.IsReadOnly -or $disk.IsOffline -or $disk.HealthStatus -ne 'Healthy') { throw 'Approved SanDisk recovery device is not healthy and writable.' }

$repository = (Resolve-Path "$PSScriptRoot\..\..").Path
foreach ($destination in @($UsbDestination, $OneDriveDestination, $StateDirectory)) {
    $full = [IO.Path]::GetFullPath($destination)
    if ($full.StartsWith($repository, [StringComparison]::OrdinalIgnoreCase)) { throw 'Recovery artifacts are forbidden inside the repository.' }
}
if ([IO.Path]::GetPathRoot($UsbDestination) -eq [IO.Path]::GetPathRoot($OneDriveDestination)) {
    throw 'Recovery identities must use separate storage roots.'
}

if ($PreflightOnly) {
    [pscustomobject]@{
        Validation = 'PASS'
        UsbDestination = $UsbDestination
        OneDriveDestination = $OneDriveDestination
        StateDirectory = $StateDirectory
        AgeVersion = (& $AgePath --version)
        AgeKeygenVersion = (& $AgeKeygenPath --version)
        KeysGenerated = $false
    }
    return
}

$timestamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$identityA = New-EncryptedIdentity $UsbDestination 'identity-a' $timestamp
$identityB = New-EncryptedIdentity $OneDriveDestination 'identity-b' $timestamp
if ($identityA.Recipient -ceq $identityB.Recipient) { throw 'Generated recovery recipients are not independent.' }

$statePath = Join-Path $StateDirectory "agentdesk-production-recovery-$timestamp.public.json"
$publicState = [ordered]@{
    created_utc = $timestamp
    project_ref = 'cdynahtkwtcinjzmxjcs'
    identity_a = [ordered]@{ artifact=$identityA.Artifact; recipient=$identityA.Recipient; sha256=$identityA.Sha256; bytes=$identityA.Bytes }
    identity_b = [ordered]@{ artifact=$identityB.Artifact; recipient=$identityB.Recipient; sha256=$identityB.Sha256; bytes=$identityB.Bytes }
}
[IO.File]::WriteAllText($statePath, ($publicState | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))

Write-Host 'PRODUCTION RECOVERY IDENTITIES CREATED. No plaintext identity was written to disk.' -ForegroundColor Green
Write-Host 'Save both distinct passphrases in the OneDrive-independent password manager, then independently verify retrieval.'
Write-Host "Public state file: $statePath"
