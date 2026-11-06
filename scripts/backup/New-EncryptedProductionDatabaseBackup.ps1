[CmdletBinding(SupportsShouldProcess, ConfirmImpact='High')]
param(
    [string]$PrimaryDestination = "$env:LOCALAPPDATA\AgentDeskAI\production-encrypted-backups",
    [string]$SecondaryDestination = 'E:\AgentDesk-Production-Encrypted-Backups',
    [string]$RecoveryStatePath = 'C:\Users\Abdul Halim Tabibzay\Documents\AgentDesk-Production-Recovery-State\agentdesk-production-recovery-20261106T213959Z.public.json',
    [string]$PgDumpPath = "$PSScriptRoot\..\..\.tools\postgresql-17.11-client\bin\pg_dump.exe",
    [string]$PgRestorePath = "$PSScriptRoot\..\..\.tools\postgresql-17.11-client\bin\pg_restore.exe",
    [string]$AgePath = "$PSScriptRoot\..\..\.tools\age\v1.3.2\age\age.exe",
    [string]$SslRootCertPath = "$PSScriptRoot\certificates\supabase-root-2021-ca.crt",
    [switch]$ProductionDataAccessApproved
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Backup.Common.ps1"

function ConvertFrom-LocalSecureString([Security.SecureString]$Value) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}
function Get-Sha256Hex([string]$Path) {
    $stream=[IO.File]::OpenRead($Path)
    try {$sha=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}}
    finally {$stream.Dispose()}
}

if (-not $ProductionDataAccessApproved) { throw 'Explicit production backup approval is required.' }
foreach($tool in @($PgDumpPath,$PgRestorePath,$AgePath)){Assert-ExternalCommand ([IO.Path]::GetFullPath($tool))}
if ((& $PgDumpPath --version 2>$null) -notmatch 'pg_dump \(PostgreSQL\) 17\.') { throw 'PostgreSQL 17 pg_dump is required.' }
if ((& $PgRestorePath --version 2>$null) -notmatch 'pg_restore \(PostgreSQL\) 17\.') { throw 'PostgreSQL 17 pg_restore is required.' }
if ((& $AgePath --version 2>$null) -notmatch 'v1\.3\.2') { throw 'Verified age v1.3.2 is required.' }

$state=Get-Content -LiteralPath $RecoveryStatePath -Raw|ConvertFrom-Json
if($state.project_ref -cne 'cdynahtkwtcinjzmxjcs'){throw 'Production recovery state project mismatch.'}
$recipients=@([string]$state.identity_a.recipient,[string]$state.identity_b.recipient)
if(@($recipients|Sort-Object -Unique).Count -ne 2 -or @($recipients|Where-Object{$_ -notmatch '^age1[0-9a-z]+$'}).Count){throw 'Two distinct valid production recipients are required.'}
foreach($entry in @($state.identity_a,$state.identity_b)){
    if(-not(Test-Path -LiteralPath ([string]$entry.artifact) -PathType Leaf)){throw 'A production recovery artifact is unavailable.'}
    if((Get-Sha256Hex ([string]$entry.artifact)) -cne ([string]$entry.sha256).ToLowerInvariant()){throw 'Production recovery artifact integrity failed.'}
}

$primary=[IO.Path]::GetFullPath($PrimaryDestination);$secondary=[IO.Path]::GetFullPath($SecondaryDestination)
foreach($destination in @($primary,$secondary)){
    if(-not(Test-Path -LiteralPath $destination -PathType Container)){throw "Approved backup destination is unavailable: $destination"}
    $drive=Get-PSDrive -Name ([IO.Path]::GetPathRoot($destination).TrimEnd(':\'))
    if($drive.Free -lt 500MB){throw "Insufficient free space: $destination"}
}
if($primary.StartsWith((Resolve-Path "$PSScriptRoot\..\..").Path,[StringComparison]::OrdinalIgnoreCase)){throw 'Primary backup destination must be outside Git.'}
if($secondary.StartsWith((Resolve-Path "$PSScriptRoot\..\..").Path,[StringComparison]::OrdinalIgnoreCase)){throw 'Secondary backup destination must be outside Git.'}

$cert=[Security.Cryptography.X509Certificates.X509Certificate2]::new([IO.Path]::GetFullPath($SslRootCertPath))
try{if($cert.GetCertHashString([Security.Cryptography.HashAlgorithmName]::SHA256)-cne '807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA'){throw 'Pinned Supabase CA mismatch.'}}finally{$cert.Dispose()}

$urlSecure=Read-Host 'Paste the copied password-free PRODUCTION Session Pooler URI (hidden)' -AsSecureString
$databaseUrl=ConvertFrom-LocalSecureString $urlSecure;$urlSecure.Dispose()
Assert-ProductionConnection $databaseUrl
$uri=[Uri]$databaseUrl;if($uri.Port-ne 5432){throw 'Production Session Pooler must use port 5432.'}
$builder=[UriBuilder]$uri;$query=@($uri.Query.TrimStart('?')-split'&'|Where-Object{$_ -and $_ -notmatch '^(?i:sslmode|sslrootcert)='})
$query+='sslmode=verify-full';$query+='sslrootcert='+[Uri]::EscapeDataString([IO.Path]::GetFullPath($SslRootCertPath));$builder.Query=$query-join'&';$verifiedUrl=$builder.Uri.AbsoluteUri
$passwordSecure=Read-Host 'Enter the existing PRODUCTION database password (hidden)' -AsSecureString
$password=ConvertFrom-LocalSecureString $passwordSecure;$passwordSecure.Dispose();if([string]::IsNullOrWhiteSpace($password)){throw 'A non-empty production password is required.'}

$id=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssZ');$run=Join-Path $primary $id;$copyRun=Join-Path $secondary $id
New-Item -ItemType Directory -Path $run,$copyRun -ErrorAction Stop|Out-Null
$incomplete=Join-Path $run 'BACKUP_INCOMPLETE';[IO.File]::WriteAllText($incomplete,[DateTime]::UtcNow.ToString('o'))
$archive=Join-Path $run 'production-database.custom.age'
try{
    if(-not$PSCmdlet.ShouldProcess('Supabase production cdynahtkwtcinjzmxjcs','read-only pg_dump streamed directly to age')){return}
    $ageArgs=@('--encrypt');foreach($recipient in $recipients){$ageArgs+=@('--recipient',$recipient)};$ageArgs+=@('--output',$archive,'-')
    $env:PGPASSWORD=$password;$env:PGOPTIONS='-c default_transaction_read_only=on -c lock_timeout=3000 -c statement_timeout=1800000'
    $plainHash=Invoke-CheckedNativePipeline $PgDumpPath @('--dbname',$verifiedUrl,'--format=custom','--no-owner','--file=-') $AgePath $ageArgs $archive -ProducerNeedsDatabasePassword
    $password=$null;Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue;Remove-Item Env:PGOPTIONS -ErrorAction SilentlyContinue
    $cipherHash=Get-Sha256Hex $archive;$bytes=(Get-Item $archive).Length
    Copy-Item -LiteralPath $archive -Destination (Join-Path $copyRun 'production-database.custom.age') -ErrorAction Stop
    if((Get-Sha256Hex (Join-Path $copyRun 'production-database.custom.age'))-cne$cipherHash){throw 'Independent ciphertext copy hash mismatch.'}
    $manifest=[ordered]@{manifest_version=1;backup_id=$id;project_ref='cdynahtkwtcinjzmxjcs';created_utc=[DateTime]::UtcNow.ToString('o');source_read_only=$true;tls_verify_full=$true;plaintext_written_to_disk=$false;artifact='production-database.custom.age';encrypted_bytes=$bytes;plaintext_sha256=$plainHash;ciphertext_sha256=$cipherHash;recipients=$recipients;secondary_copy=$copyRun;status='complete'}
    $manifest|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $run 'manifest.json') -Encoding utf8
    Copy-Item -LiteralPath (Join-Path $run 'manifest.json') -Destination (Join-Path $copyRun 'manifest.json')
    $cipherHash+' *production-database.custom.age'|Set-Content -LiteralPath (Join-Path $run 'SHA256SUMS.txt') -Encoding ascii
    Copy-Item -LiteralPath (Join-Path $run 'SHA256SUMS.txt') -Destination (Join-Path $copyRun 'SHA256SUMS.txt')
    'VERIFIED ENCRYPTED PRODUCTION DATABASE BACKUP'|Set-Content -LiteralPath (Join-Path $run 'BACKUP_COMPLETE') -Encoding ascii
    Copy-Item -LiteralPath (Join-Path $run 'BACKUP_COMPLETE') -Destination (Join-Path $copyRun 'BACKUP_COMPLETE')
    Remove-Item -LiteralPath $incomplete
    [pscustomobject]@{Validation='PASS';ProjectRef='cdynahtkwtcinjzmxjcs';TlsVerifyFull=$true;SourceReadOnly=$true;PlaintextWritten=$false;Primary=$run;Secondary=$copyRun;EncryptedBytes=$bytes;CiphertextSha256=$cipherHash;PlaintextSha256=$plainHash}
}catch{throw "Production encrypted database backup failed; incomplete set remains quarantined at $run. $($_.Exception.Message)"}
finally{$password=$null;$databaseUrl=$null;$verifiedUrl=$null;Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue;Remove-Item Env:PGOPTIONS -ErrorAction SilentlyContinue}
