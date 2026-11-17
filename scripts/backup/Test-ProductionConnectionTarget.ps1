param([string]$DatabaseUrl = $env:PROD_DB_URL)
. "$PSScriptRoot\Backup.Common.ps1"
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) { throw 'Provide PROD_DB_URL without a password.' }
Assert-ProductionConnection $DatabaseUrl
$uri = [Uri]$DatabaseUrl
[pscustomobject]@{
    Validation = 'PASS (syntax only; no network connection made)'
    ProjectRef = $script:ProductionProjectRef
    HostSuffix = ($uri.Host -replace '^.*?(?=[^.]+\.supabase\.com$)', '')
    Database = $uri.AbsolutePath.TrimStart('/')
    CredentialsLogged = $false
}
