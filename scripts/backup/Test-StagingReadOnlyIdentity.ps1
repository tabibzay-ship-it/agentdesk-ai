[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$DatabaseUrl,
    [string]$PostgresRoot = "$env:LOCALAPPDATA\AgentDeskAI\tools\postgresql-17.11-5\extracted\pgsql",
    [string]$SslRootCert = "$env:LOCALAPPDATA\AgentDeskAI\certificates\supabase-prod-ca-2021-official.crt"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$stagingRef = 'koqlnjctqeaykhbqkyuj'
$productionRef = 'cdynahtkwtcinjzmxjcs'
if ($DatabaseUrl -match [regex]::Escape($productionRef)) { throw 'Production project references are forbidden.' }

$uri = [Uri]$DatabaseUrl
if ($uri.Scheme -notin @('postgres', 'postgresql')) { throw 'A PostgreSQL URL is required.' }
if ($uri.UserInfo -match ':') { throw 'Do not place a password in the database URL.' }
if ($uri.UserInfo -ne "postgres.$stagingRef") { throw 'Staging database username mismatch.' }
if ($uri.Host -notlike '*.pooler.supabase.com') { throw 'Use the staging Supabase session pooler hostname.' }
if ($uri.AbsolutePath -ne '/postgres') { throw 'The database name must be postgres.' }
if ($uri.Query -notmatch '(^|[?&])sslmode=require(&|$)') { throw 'TLS with sslmode=require is mandatory.' }

$psql = Join-Path $PostgresRoot 'bin\psql.exe'
if (-not (Test-Path -LiteralPath $psql -PathType Leaf)) { throw 'Verified PostgreSQL 17 psql is unavailable.' }
if ((& $psql --version 2>&1 | Out-String) -notmatch '\b17(?:\.\d+)?\b') { throw 'PostgreSQL 17 psql is required.' }
if (-not (Test-Path -LiteralPath $SslRootCert -PathType Leaf)) { throw 'The pinned Supabase Root CA certificate is unavailable.' }
$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($SslRootCert)
try {
    $fingerprint = $certificate.GetCertHashString([Security.Cryptography.HashAlgorithmName]::SHA256)
    if ($fingerprint -cne '807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA') {
        throw 'The Supabase Root CA SHA-256 fingerprint does not match the approved certificate.'
    }
    if ($certificate.Subject -notmatch 'CN=Supabase Root 2021 CA' -or $certificate.Issuer -notmatch 'CN=Supabase Root 2021 CA') {
        throw 'The approved Supabase Root CA identity did not match.'
    }
    $now = Get-Date
    if ($now -lt $certificate.NotBefore -or $now -gt $certificate.NotAfter) { throw 'The approved Supabase Root CA is outside its validity period.' }
}
finally { $certificate.Dispose() }

$password = Read-Host 'Enter the existing STAGING database password (hidden)' -AsSecureString
if ($password.Length -eq 0) { throw 'A non-empty staging password is required.' }
$bstr = [IntPtr]::Zero
$process = $null
try {
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $psql
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($argument in @(
        '--host', $uri.Host, '--port', ([string]$(if ($uri.Port -gt 0) { $uri.Port } else { 5432 })),
        '--username', "postgres.$stagingRef", '--dbname', 'postgres', '--no-password', '--no-psqlrc',
        '--quiet', '--tuples-only', '--no-align', '--field-separator', '|', '--set', 'ON_ERROR_STOP=1',
        '--command', @"
begin read only;
set local statement_timeout='10s';
select current_database(),current_setting('transaction_read_only'),current_setting('server_version_num')::int between 170000 and 179999,pg_database_size(current_database());
select coalesce(string_agg(schema_name,',' order by schema_name),'') from information_schema.schemata where schema_name in ('auth','public','storage','supabase_migrations');
select coalesce(to_regclass('supabase_migrations.schema_migrations')::text,'missing');
rollback;
"@
    )) { [void]$info.ArgumentList.Add($argument) }
    $info.Environment['PGPASSWORD'] = $plain
    $info.Environment['PGSSLMODE'] = 'verify-full'
    $info.Environment['PGSSLROOTCERT'] = $SslRootCert
    $info.Environment['PGCONNECT_TIMEOUT'] = '10'
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    if (-not $process.Start()) { throw 'Could not start the read-only identity check.' }
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        $safeError = ($stderr -replace '(?i)(password\s*=\s*)\S+', '$1[REDACTED]').Trim()
        if ($safeError.Length -gt 1000) { $safeError = $safeError.Substring(0, 1000) }
        throw "Read-only identity check failed with exit code $($process.ExitCode): $safeError"
    }
    $lines = @($stdout -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $identity = $lines[0] -split '\|'
    if ($lines.Count -lt 3 -or $identity.Count -ne 4 -or $identity[0] -ne 'postgres' -or $identity[1] -ne 'on' -or $identity[2] -ne 't' -or [int64]$identity[3] -le 0) {
        throw 'The remote session did not prove PostgreSQL 17 read-only staging compatibility.'
    }
    $schemas = @($lines[1] -split ',')
    foreach ($requiredSchema in @('auth','public','storage')) {
        if ($requiredSchema -notin $schemas) { throw "Required staging schema is missing: $requiredSchema" }
    }
    $ledgerRelation = $lines[2]
    if ($ledgerRelation -notin @('missing','supabase_migrations.schema_migrations','schema_migrations')) {
        throw 'The staging migration ledger inspection result was invalid.'
    }
    $ledgerPresent = $ledgerRelation -ne 'missing'
    [pscustomobject]@{
        Validation = 'PASS'
        ProjectRef = $stagingRef
        Database = 'postgres'
        DatabaseBytes = [int64]$identity[3]
        TransactionReadOnly = $true
        PostgreSQL17 = $true
        Schemas = $schemas
        MigrationLedgerPresent = $ledgerPresent
        MigrationLedgerRelation = $(if ($ledgerPresent) { 'supabase_migrations.schema_migrations' } else { $null })
        MigrationLedgerRows = $(if ($ledgerPresent) { $null } else { 0 })
        MigrationVersions = @()
        WritesPerformed = $false
        CredentialStored = $false
    }
} finally {
    if ($process) { $process.Dispose() }
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    $plain = $null
    $password.Dispose()
}
