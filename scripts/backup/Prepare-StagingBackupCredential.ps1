[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$DatabaseUrl,
    [string]$ProjectRef = 'koqlnjctqeaykhbqkyuj',
    [switch]$ValidateTargetOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$productionProjectRef = 'cdynahtkwtcinjzmxjcs'
$approvedStagingProjectRef = 'koqlnjctqeaykhbqkyuj'

if ($ProjectRef -eq $productionProjectRef) { throw 'Production project is forbidden in the staging backup workflow.' }
if ($ProjectRef -ne $approvedStagingProjectRef) { throw 'Staging project reference mismatch.' }

$uri = [Uri]$DatabaseUrl
if ($uri.Scheme -notin @('postgres', 'postgresql')) { throw 'Staging URL must use PostgreSQL.' }
if ($uri.UserInfo -match ':') { throw 'Do not put a password in the staging database URL.' }
if ($uri.UserInfo -ne "postgres.$approvedStagingProjectRef") { throw 'Staging URL project reference mismatch.' }
if ($uri.Host -notlike '*.pooler.supabase.com') { throw 'Use the Supabase session pooler hostname.' }
if ($uri.AbsolutePath -ne '/postgres') { throw 'The staging database name must be postgres.' }
if ($uri.Query -notmatch '(^|[?&])sslmode=require(&|$)') { throw 'The staging connection must require TLS with sslmode=require.' }

if ($ValidateTargetOnly) {
    [pscustomobject]@{
        Validation = 'PASS (syntax only; no network connection made)'
        ProjectRef = $approvedStagingProjectRef
        EnvironmentWritten = $false
        CredentialStored = $false
    }
    return
}

$credential = Read-Host 'Enter the existing STAGING database password (hidden)' -AsSecureString
if ($credential.Length -eq 0) { throw 'A non-empty staging password is required.' }

# This preparation step intentionally does not decrypt, persist, export, test, or
# transmit the credential. A separately authorized backup runner must pass it only
# to a pg_dump child process and clear that child environment after exit.
[pscustomobject]@{
    Validation = 'PASS (secure prompt accepted; no network connection made)'
    ProjectRef = $approvedStagingProjectRef
    EnvironmentWritten = $false
    CredentialStored = $false
    NextStep = 'Request authorization for the staging backup runner.'
}

