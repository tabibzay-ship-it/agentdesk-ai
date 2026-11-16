[CmdletBinding()]
param(
    [string]$AgeRoot = 'C:\Users\Abdul Halim Tabibzay\AppData\Local\AgentDesk-Tools\age-v1.3.2\extracted\age',
    [string]$PowerShellPath = 'C:\Users\Abdul Halim Tabibzay\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe',
    [string]$TemporaryRootParent = "$PSScriptRoot\..\..\.tmp-e2e"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Backup.Common.ps1"

$age = Join-Path $AgeRoot 'age.exe'
$ageKeygen = Join-Path $AgeRoot 'age-keygen.exe'
foreach ($tool in @($age,$ageKeygen,$PowerShellPath)) { Assert-ExternalCommand $tool }
if ((& $age --version).Trim() -ne 'v1.3.2') { throw 'Only verified age v1.3.2 is approved.' }

$temporaryParent = [IO.Path]::GetFullPath($TemporaryRootParent)
if (-not (Test-Path -LiteralPath $temporaryParent -PathType Container)) {
    New-Item -ItemType Directory -Path $temporaryParent | Out-Null
}
$root = Join-Path $temporaryParent ('agentdesk-age-interactive-' + [Guid]::NewGuid().ToString('N'))
$identity = Join-Path $root 'ephemeral-test-identity.txt'
$payload = Join-Path $root 'synthetic-payload.txt'
$ciphertext = Join-Path $root 'synthetic-payload.age'

try {
    New-Item -ItemType Directory -Path $root | Out-Null
    & $ageKeygen '--output' $identity 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Ephemeral identity generation failed.' }
    $recipient = (& $ageKeygen '--y' $identity 2>$null).Trim()
    if ($recipient -notmatch '^age1[0-9a-z]+$') { throw 'Ephemeral recipient is invalid.' }

    [IO.File]::WriteAllText($payload, 'AgentDesk synthetic interactive age pipeline', [Text.UTF8Encoding]::new($false))
    $expectedHash = (Get-FileHash -LiteralPath $payload -Algorithm SHA256).Hash.ToLowerInvariant()
    & $age '--encrypt' '--recipient' $recipient '--output' $ciphertext $payload
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $ciphertext -PathType Leaf)) {
        throw 'Synthetic encryption failed.'
    }

    $drainCommand = '[Console]::OpenStandardInput().CopyTo([IO.Stream]::Null)'
    $actualHash = Invoke-CheckedNativePipeline $age @('--decrypt','--identity',$identity,$ciphertext) $PowerShellPath @('-NoProfile','-Command',$drainCommand) -InteractiveProducer
    if ($actualHash -ne $expectedHash) { throw 'Interactive producer pipeline hash mismatch.' }

    [pscustomobject]@{
        Result = 'PASS'
        InteractiveProducer = $true
        PlaintextDatabaseDumpWritten = $false
        CiphertextBytes = (Get-Item -LiteralPath $ciphertext).Length
        RecoveredHashMatches = $true
    }
}
finally {
    $cleanupRoot = [IO.Path]::GetFullPath($root)
    $cleanupPrefix = $temporaryParent.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $cleanupRoot.StartsWith($cleanupPrefix,[StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($cleanupRoot) -notlike 'agentdesk-age-interactive-*') {
        throw 'Refusing unsafe synthetic cleanup target.'
    }
    if (Test-Path -LiteralPath $cleanupRoot) { Remove-Item -LiteralPath $cleanupRoot -Recurse -Force }
}
