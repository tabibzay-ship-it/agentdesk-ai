[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$StatePath,
    [string]$AgePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($AgePath)) {
    $AgePath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\.tools\age\v1.3.2\age\age.exe'))
}
if (-not (Test-Path -LiteralPath $AgePath -PathType Leaf)) { throw 'Verified age executable is unavailable.' }
if ((& $AgePath --version 2>$null) -notmatch 'v1\.3\.2') { throw 'Verified age v1.3.2 is required.' }
if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { throw 'Production public recovery state is missing.' }

$state = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
if ($state.project_ref -cne 'cdynahtkwtcinjzmxjcs') { throw 'Production recovery project identity mismatch.' }
$aPath = [string]$state.identity_a.artifact
$bPath = [string]$state.identity_b.artifact
foreach ($entry in @($state.identity_a, $state.identity_b)) {
    $artifact = [string]$entry.artifact
    if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { throw "Encrypted recovery identity is missing: $artifact" }
    if ((Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash -cne [string]$entry.sha256) {
        throw "Encrypted recovery identity integrity failed: $artifact"
    }
}
if ([string]$state.identity_a.recipient -ceq [string]$state.identity_b.recipient) { throw 'Recovery recipients are not independent.' }

$stateDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($StatePath))
$cipher = Join-Path $stateDirectory ('.production-recovery-test-' + [guid]::NewGuid().ToString('N') + '.age')
$bytes = New-Object byte[] 64
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$message = [Convert]::ToBase64String($bytes)

try {
    $message | & $AgePath --encrypt --recipient ([string]$state.identity_a.recipient) --recipient ([string]$state.identity_b.recipient) --output $cipher -
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $cipher -PathType Leaf)) { throw 'Disposable two-recipient encryption failed.' }

    Write-Host 'Retrieve Production Identity A passphrase from the independent password manager.'
    $plainA = ((& $AgePath --decrypt $aPath | & $AgePath --decrypt --identity - $cipher) -join "`n").TrimEnd()
    if ($LASTEXITCODE -ne 0 -or $plainA -cne $message) { throw 'Production Identity A independent decryption failed.' }
    $plainA = $null
    Write-Host 'PRODUCTION IDENTITY A INDEPENDENT DECRYPTION: PASS' -ForegroundColor Green

    Write-Host 'Retrieve Production Identity B passphrase from the independent password manager.'
    $plainB = ((& $AgePath --decrypt $bPath | & $AgePath --decrypt --identity - $cipher) -join "`n").TrimEnd()
    if ($LASTEXITCODE -ne 0 -or $plainB -cne $message) { throw 'Production Identity B independent decryption failed.' }
    $plainB = $null
    Write-Host 'PRODUCTION IDENTITY B INDEPENDENT DECRYPTION: PASS' -ForegroundColor Green
    Write-Host 'PRODUCTION PASSWORD-MANAGER RETRIEVAL: VERIFIED BY SUCCESSFUL DECRYPTION' -ForegroundColor Green
}
finally {
    $message = $null
    $bytes = $null
    if (Test-Path -LiteralPath $cipher) { Remove-Item -LiteralPath $cipher -Force }
}
