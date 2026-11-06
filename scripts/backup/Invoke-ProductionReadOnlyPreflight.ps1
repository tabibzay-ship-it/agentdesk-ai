[CmdletBinding()]
param(
    [string]$PsqlPath = "$env:LOCALAPPDATA\AgentDeskAI\tools\postgresql-17.11-5\extracted\pgsql\bin\psql.exe",
    [string]$SqlPath = "$PSScriptRoot\..\..\supabase\production-readonly-preflight.sql",
    [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Backup.Common.ps1"

function ConvertFrom-LocalSecureString {
    param([Parameter(Mandatory)][Security.SecureString]$Value)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

Assert-ExternalCommand $PsqlPath
if (-not (Test-Path -LiteralPath $SqlPath -PathType Leaf)) { throw 'Production preflight SQL is missing.' }

$version = (& $PsqlPath --version 2>$null)
if ($LASTEXITCODE -ne 0 -or $version -notmatch 'psql \(PostgreSQL\) 17\.') {
    throw 'Verified PostgreSQL 17 psql is required.'
}

$urlSecure = Read-Host 'Paste the password-free PRODUCTION Session Pooler URI (hidden)' -AsSecureString
$databaseUrl = ConvertFrom-LocalSecureString $urlSecure
$urlSecure.Dispose()
if ([string]::IsNullOrWhiteSpace($databaseUrl)) { throw 'A password-free production Session Pooler URI is required.' }

Assert-ProductionConnection $databaseUrl
$uri = [Uri]$databaseUrl
if ($uri.Port -ne 5432) { throw 'Production Session Pooler must use port 5432.' }

$builder = [UriBuilder]$uri
$queryParts = @($uri.Query.TrimStart('?') -split '&' | Where-Object {
    $_ -and $_ -notmatch '^(?i:sslmode|sslrootcert)='
})
$queryParts += 'sslmode=verify-full'
$queryParts += 'sslrootcert=system'
$builder.Query = $queryParts -join '&'
$verifiedUrl = $builder.Uri.AbsoluteUri

$passwordSecure = Read-Host 'Enter the existing PRODUCTION database password (hidden)' -AsSecureString
$password = ConvertFrom-LocalSecureString $passwordSecure
$passwordSecure.Dispose()
if ([string]::IsNullOrWhiteSpace($password)) { throw 'A non-empty production database password is required.' }

$processInfo = New-ProcessInfo $PsqlPath @(
    $verifiedUrl,
    '--no-psqlrc',
    '--no-align',
    '--tuples-only',
    '--set', 'ON_ERROR_STOP=1',
    '--file', ([IO.Path]::GetFullPath($SqlPath))
)
$processInfo.Environment['PGPASSWORD'] = $password
$processInfo.Environment['PGOPTIONS'] = '-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=45000'
$processInfo.RedirectStandardOutput = $true
$processInfo.RedirectStandardError = $true
$process = [Diagnostics.Process]::new()
$process.StartInfo = $processInfo
$processStarted = $false
$resolvedOutputPath = $null

try {
    $processStarted = $process.Start()
    if (-not $processStarted) { throw 'Production read-only preflight process did not start.' }
    $password = $null
    $outputTask = $process.StandardOutput.ReadToEndAsync()
    $errorTask = $process.StandardError.ReadToEndAsync()
    $process.WaitForExit()
    $output = $outputTask.GetAwaiter().GetResult()
    $errorOutput = $errorTask.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) {
        throw "Production read-only preflight failed with exit code $($process.ExitCode): $errorOutput"
    }
    if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
        $resolvedOutputPath = [IO.Path]::GetFullPath($OutputPath)
        $outputDirectory = Split-Path -Parent $resolvedOutputPath
        if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
            [void](New-Item -ItemType Directory -Path $outputDirectory)
        }
        [IO.File]::WriteAllText($resolvedOutputPath, $output, [Text.UTF8Encoding]::new($false))
    } else {
        Write-Output $output
    }
    [pscustomobject]@{
        Validation = 'PASS'
        ProjectRef = $script:ProductionProjectRef
        Database = 'postgres'
        SessionPooler = $true
        TlsVerifyFull = $true
        DefaultTransactionReadOnly = $true
        SqlTransactionReadOnly = $true
        StatementTimeoutSeconds = 30
        LockTimeoutSeconds = 3
        WritesPerformed = $false
        CredentialStored = $false
        OutputPath = if ($resolvedOutputPath) { $resolvedOutputPath } else { $null }
    }
}
finally {
    $password = $null
    $databaseUrl = $null
    $verifiedUrl = $null
    if ($processStarted -and -not $process.HasExited) { $process.Kill($true) }
    $process.Dispose()
}
