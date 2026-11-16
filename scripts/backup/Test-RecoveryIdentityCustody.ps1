[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$AgePath,
    [Parameter(Mandatory)][string]$BatchpassPath,
    [Parameter(Mandatory)][string]$StatePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-Sha256Hex([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace('-', '') }
    finally { $sha.Dispose() }
}

function Get-FileSha256Hex([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $sha = [Security.Cryptography.SHA256]::Create()
        try { return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
        finally { $sha.Dispose() }
    }
    finally { $stream.Dispose() }
}

function Read-StarredPassphrase([string]$Label) {
    Write-Host "Retrieve $Label from the independent password manager. Stars will appear."
    $secure = Read-Host "$Label passphrase" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        if ([string]::IsNullOrWhiteSpace($value)) { throw "$Label passphrase was empty." }
        return $value
    }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Invoke-AgeProcess {
    param([string]$Arguments, [string]$StandardInput, [string]$Passphrase)
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $AgePath
    $psi.Arguments = $Arguments
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.EnvironmentVariables['PATH'] = ([IO.Path]::GetDirectoryName($BatchpassPath) + ';' + $psi.EnvironmentVariables['PATH'])
    if ($null -ne $Passphrase) { $psi.EnvironmentVariables['AGE_PASSPHRASE'] = $Passphrase }
    $p = [Diagnostics.Process]::new(); $p.StartInfo = $psi
    if (-not $p.Start()) { throw 'age process could not start.' }
    $outTask = $p.StandardOutput.ReadToEndAsync(); $errTask = $p.StandardError.ReadToEndAsync()
    if ($null -ne $StandardInput) { $p.StandardInput.Write($StandardInput) }
    $p.StandardInput.Close(); $p.WaitForExit()
    $output = $outTask.GetAwaiter().GetResult(); $errorText = $errTask.GetAwaiter().GetResult()
    if ($p.ExitCode -ne 0) { throw "age operation failed: $errorText" }
    return $output
}

if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { throw 'Public state file is missing.' }
foreach ($path in @($AgePath, $BatchpassPath)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required tool is missing: $path" } }
$state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
$aPath = [string]$state.identity_a.artifact; $bPath = [string]$state.identity_b.artifact
foreach ($path in @($aPath, $bPath)) { if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Encrypted identity is missing: $path" } }
if ((Get-FileSha256Hex $aPath) -cne [string]$state.identity_a.sha256) { throw 'Identity A ciphertext integrity failed.' }
if ((Get-FileSha256Hex $bPath) -cne [string]$state.identity_b.sha256) { throw 'Identity B ciphertext integrity failed.' }

$stateDir = Split-Path -Parent $StatePath
$testCipher = Join-Path $stateDir ('.recovery-test-' + [guid]::NewGuid().ToString('N') + '.age')
$messageBytes = [byte[]]::new(64); [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($messageBytes)
$message = [Convert]::ToBase64String($messageBytes)
$messageHash = Get-Sha256Hex ([Text.Encoding]::UTF8.GetBytes($message))

try {
    $encryptArgs = "--encrypt --recipient $([string]$state.identity_a.recipient) --recipient $([string]$state.identity_b.recipient) --output `"$testCipher`" -"
    $null = Invoke-AgeProcess $encryptArgs $message $null

    $passA = Read-StarredPassphrase 'Identity A'
    try { $identityA = Invoke-AgeProcess "--decrypt -j batchpass `"$aPath`"" $null $passA }
    finally { $passA = $null }
    try { $plainA = Invoke-AgeProcess "--decrypt --identity - `"$testCipher`"" $identityA $null }
    finally { $identityA = $null }
    $aPass = (Get-Sha256Hex ([Text.Encoding]::UTF8.GetBytes($plainA.TrimEnd()))) -ceq $messageHash
    $plainA = $null

    $passB = Read-StarredPassphrase 'Identity B'
    try { $identityB = Invoke-AgeProcess "--decrypt -j batchpass `"$bPath`"" $null $passB }
    finally { $passB = $null }
    try { $plainB = Invoke-AgeProcess "--decrypt --identity - `"$testCipher`"" $identityB $null }
    finally { $identityB = $null }
    $bPass = (Get-Sha256Hex ([Text.Encoding]::UTF8.GetBytes($plainB.TrimEnd()))) -ceq $messageHash
    $plainB = $null

    if (-not $aPass -or -not $bPass) { throw 'Independent recovery comparison failed.' }
    Write-Host 'IDENTITY A INDEPENDENT DECRYPTION: PASS' -ForegroundColor Green
    Write-Host 'IDENTITY B INDEPENDENT DECRYPTION: PASS' -ForegroundColor Green
    Write-Host 'PASSWORD MANAGER RETRIEVAL: VERIFIED BY SUCCESSFUL DECRYPTION' -ForegroundColor Green
}
finally {
    $message = $null; $messageBytes = $null
    if (Test-Path -LiteralPath $testCipher) { Remove-Item -LiteralPath $testCipher -Force }
}

Read-Host 'Press Enter after reviewing the PASS results'
