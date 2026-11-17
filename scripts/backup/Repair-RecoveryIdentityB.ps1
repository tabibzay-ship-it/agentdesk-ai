[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$AgePath,
    [Parameter(Mandatory)][string]$AgeKeygenPath,
    [Parameter(Mandatory)][string]$BatchpassPath,
    [Parameter(Mandatory)][string]$ExistingStatePath,
    [Parameter(Mandatory)][string]$OneDriveDestination,
    [Parameter(Mandatory)][string]$StateDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-Sha256Hex([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
        finally { $sha.Dispose() }
    }
    finally { $stream.Dispose() }
}

function Read-MatchingPassphrase {
    while ($true) {
        Write-Host 'Create a NEW Identity B passphrase. Stars will appear while you type or paste.'
        $first = Read-Host 'Identity B passphrase' -AsSecureString
        $second = Read-Host 'Confirm Identity B passphrase' -AsSecureString
        $p1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
        $p2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($second)
        try {
            $s1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p1)
            $s2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p2)
            if ($s1.Length -lt 20) { Write-Host 'Passphrase must be at least 20 characters.' -ForegroundColor Red; continue }
            if (-not [string]::Equals($s1, $s2, [StringComparison]::Ordinal)) { Write-Host 'Passphrases did not match. Try again.' -ForegroundColor Red; continue }
            return $s1
        }
        finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p1)
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p2)
            $s2 = $null
        }
    }
}

foreach ($path in @($AgePath, $AgeKeygenPath, $BatchpassPath, $ExistingStatePath)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required file is missing: $path" }
}
foreach ($path in @($OneDriveDestination, $StateDirectory)) {
    if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw "Required directory is missing: $path" }
}

$old = Get-Content -LiteralPath $ExistingStatePath -Raw | ConvertFrom-Json
$aPath = [string]$old.identity_a.artifact
if (-not (Test-Path -LiteralPath $aPath -PathType Leaf)) { throw 'The valid Identity A artifact is missing.' }
if ((Get-Sha256Hex $aPath) -cne [string]$old.identity_a.sha256) { throw 'Identity A integrity check failed.' }

$startInfo = [Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $AgeKeygenPath
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$keygen = [Diagnostics.Process]::new(); $keygen.StartInfo = $startInfo
if (-not $keygen.Start()) { throw 'Identity B key generation could not start.' }
$identity = $keygen.StandardOutput.ReadToEnd()
$keygenMessage = $keygen.StandardError.ReadToEnd()
$keygen.WaitForExit()
if ($keygen.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($identity)) { throw 'Identity B key generation failed.' }
$recipient = if ($keygenMessage -match 'Public key:\s*(age1[0-9a-z]+)') { $Matches[1] } else { '' }
if ($recipient -notmatch '^age1[0-9a-z]+$') { throw 'Identity B recipient derivation failed.' }

$passphrase = Read-MatchingPassphrase
$timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$final = Join-Path $OneDriveDestination "agentdesk-staging-identity-b-$timestamp.identity.age"
$partial = "$final.partial"
if ((Test-Path -LiteralPath $final) -or (Test-Path -LiteralPath $partial)) { throw 'Refusing to overwrite an Identity B artifact.' }

try {
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $AgePath
    $psi.Arguments = "--encrypt -j batchpass --output `"$partial`" -"
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.EnvironmentVariables['AGE_PASSPHRASE'] = $passphrase
    $psi.EnvironmentVariables['PATH'] = ([IO.Path]::GetDirectoryName($BatchpassPath) + ';' + $psi.EnvironmentVariables['PATH'])
    $age = [Diagnostics.Process]::new(); $age.StartInfo = $psi
    if (-not $age.Start()) { throw 'Identity B encryption could not start.' }
    $stdoutTask = $age.StandardOutput.ReadToEndAsync(); $stderrTask = $age.StandardError.ReadToEndAsync()
    $age.StandardInput.Write($identity); $age.StandardInput.Close(); $age.WaitForExit()
    $null = $stdoutTask.GetAwaiter().GetResult(); $ageError = $stderrTask.GetAwaiter().GetResult()
    if ($age.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $partial -PathType Leaf)) { throw "Identity B encryption failed: $ageError" }
    Move-Item -LiteralPath $partial -Destination $final -ErrorAction Stop
}
finally {
    $passphrase = $null; $identity = $null; $keygenMessage = $null
    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force -ErrorAction SilentlyContinue }
}

$newState = Join-Path $StateDirectory "agentdesk-staging-recovery-$timestamp.public.json"
@{
    created_utc = $timestamp
    replaces_state = $ExistingStatePath
    identity_a = @{ artifact = $aPath; recipient = [string]$old.identity_a.recipient; sha256 = [string]$old.identity_a.sha256; bytes = [int64]$old.identity_a.bytes }
    identity_b = @{ artifact = $final; recipient = $recipient; sha256 = (Get-Sha256Hex $final); bytes = (Get-Item -LiteralPath $final).Length }
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $newState -Encoding UTF8

Write-Host 'NEW Identity B created with the starred prompt.' -ForegroundColor Green
Write-Host 'Save the new B passphrase in the independent password manager, then verify retrieval.'
Write-Host "New public state: $newState"
Read-Host 'Press Enter after saving it; decryption testing waits for explicit retrieval confirmation'
