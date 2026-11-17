[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BackupRoot,
    [Parameter(Mandatory)][ValidateCount(2,2)][string[]]$AgeRecipient,
    [Parameter(Mandatory)][ValidateCount(2,2)][string[]]$RecoveryIdentityPath,
    [string]$PostgresRoot="$env:LOCALAPPDATA\AgentDeskAI\tools\postgresql-17.11-5\extracted\pgsql",
    [string]$AgeRoot="$env:LOCALAPPDATA\AgentDesk-Tools\age-v1.3.2\extracted\age",
    [string]$HostName='aws-0-ap-northeast-2.pooler.supabase.com',
    [string]$DatabaseUser='postgres.koqlnjctqeaykhbqkyuj',
    [string]$SslRootCert="$env:LOCALAPPDATA\AgentDeskAI\certificates\supabase-prod-ca-2021-official.crt"
)

Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. "$PSScriptRoot\Backup.Common.ps1"
$stagingRef='koqlnjctqeaykhbqkyuj';$productionRef='cdynahtkwtcinjzmxjcs'
if($HostName -match [regex]::Escape($productionRef) -or $DatabaseUser -match [regex]::Escape($productionRef)){throw 'Production project references are forbidden.'}
if($HostName -ne 'aws-0-ap-northeast-2.pooler.supabase.com' -or $DatabaseUser -ne "postgres.$stagingRef"){throw 'Staging session-pooler host or username mismatch.'}
if(@($AgeRecipient|Sort-Object -Unique).Count -ne 2){throw 'Two distinct age recipients are required.'}
foreach($recipient in $AgeRecipient){if($recipient -notmatch '^age1[0-9a-z]+$'){throw 'Invalid age recipient.'}}
$repository=(Resolve-Path "$PSScriptRoot\..\..").Path;$backupRootFull=[IO.Path]::GetFullPath($BackupRoot)
if($backupRootFull.StartsWith($repository,[StringComparison]::OrdinalIgnoreCase)){throw 'Backup root must be outside the repository.'}
if(-not(Test-Path -LiteralPath $backupRootFull -PathType Container)){throw 'Approved backup root must already exist.'}
$identities=@($RecoveryIdentityPath|ForEach-Object{[IO.Path]::GetFullPath($_)})
if(@($identities|Sort-Object -Unique).Count -ne 2){throw 'Two distinct recovery identities are required.'}
foreach($identity in $identities){if($identity.StartsWith($repository,[StringComparison]::OrdinalIgnoreCase)-or $identity.StartsWith($backupRootFull,[StringComparison]::OrdinalIgnoreCase)){throw 'Private identities must be outside the repository and backup destination.'};if(-not(Test-Path -LiteralPath $identity -PathType Leaf)){throw 'Recovery identity is unavailable.'}}

$age=Join-Path $AgeRoot 'age.exe';$batchpass=Join-Path $AgeRoot 'age-plugin-batchpass.exe';$bin=Join-Path $PostgresRoot 'bin';$psql=Join-Path $bin 'psql.exe';$pgDump=Join-Path $bin 'pg_dump.exe';$pgDumpAll=Join-Path $bin 'pg_dumpall.exe';$pgRestore=Join-Path $bin 'pg_restore.exe'
foreach($tool in @($age,$batchpass,$psql,$pgDump,$pgDumpAll,$pgRestore)){Assert-ExternalCommand $tool}
if((& $age --version).Trim() -ne 'v1.3.2'){throw 'Only verified age v1.3.2 is approved.'}
foreach($tool in @($psql,$pgDump,$pgDumpAll,$pgRestore)){if((& $tool --version)-notmatch '\b17(?:\.\d+)?\b'){throw 'PostgreSQL 17 client verification failed.'}}
if(-not(Test-Path -LiteralPath $SslRootCert -PathType Leaf)){throw 'The pinned Supabase Root CA certificate is unavailable.'}
$certificate=[Security.Cryptography.X509Certificates.X509Certificate2]::new($SslRootCert)
try{
    $fingerprint=$certificate.GetCertHashString([Security.Cryptography.HashAlgorithmName]::SHA256)
    if($fingerprint -cne '807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA'){throw 'The Supabase Root CA SHA-256 fingerprint does not match the approved certificate.'}
    if($certificate.Subject -notmatch 'CN=Supabase Root 2021 CA' -or $certificate.Issuer -notmatch 'CN=Supabase Root 2021 CA'){throw 'The approved Supabase Root CA identity did not match.'}
    $now=Get-Date;if($now-lt$certificate.NotBefore -or $now-gt$certificate.NotAfter){throw 'The approved Supabase Root CA is outside its validity period.'}
}finally{$certificate.Dispose()}

function Invoke-RemoteCaptured([string]$Tool,[string[]]$Arguments,[SecureString]$Password){
    $bstr=[IntPtr]::Zero;$process=$null
    try{$bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password);$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr);$info=New-ProcessInfo $Tool $Arguments;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.Environment['PGPASSWORD']=$plain;$info.Environment['PGSSLMODE']='verify-full';$info.Environment['PGSSLROOTCERT']=$SslRootCert;$info.Environment['PGOPTIONS']='-c default_transaction_read_only=on -c statement_timeout=30000 -c lock_timeout=3000';$process=[Diagnostics.Process]::new();$process.StartInfo=$info;if(-not $process.Start()){throw 'Could not start PostgreSQL client.'};$stdout=$process.StandardOutput.ReadToEnd();$stderr=$process.StandardError.ReadToEnd();$process.WaitForExit();if($process.ExitCode -ne 0){throw "Read-only command failed with exit code $($process.ExitCode): $stderr"};return $stdout}
    finally{if($process){$process.Dispose()};if($bstr-ne[IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)};$plain=$null}
}

function Invoke-RemoteEncryptedStream([string]$Producer,[string[]]$Arguments,[string]$Output,[SecureString]$Password){
    $bstr=[IntPtr]::Zero;$producerProcess=$null;$consumerProcess=$null;$hash=[Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
    try{$bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password);$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr);$producerInfo=New-ProcessInfo $Producer $Arguments;$producerInfo.RedirectStandardOutput=$true;$producerInfo.RedirectStandardError=$true;$producerInfo.Environment['PGPASSWORD']=$plain;$producerInfo.Environment['PGSSLMODE']='verify-full';$producerInfo.Environment['PGSSLROOTCERT']=$SslRootCert;$producerInfo.Environment['PGOPTIONS']='-c default_transaction_read_only=on -c statement_timeout=0 -c lock_timeout=3000';$ageArgs=@('--encrypt');foreach($recipient in $AgeRecipient){$ageArgs+=@('--recipient',$recipient)};$ageArgs+=@('--output',$Output,'-');$consumerInfo=New-ProcessInfo $age $ageArgs;[void]$consumerInfo.Environment.Remove('PGPASSWORD');[void]$consumerInfo.Environment.Remove('PGSSLROOTCERT');$consumerInfo.RedirectStandardInput=$true;$consumerInfo.RedirectStandardOutput=$true;$consumerInfo.RedirectStandardError=$true;$producerProcess=[Diagnostics.Process]::new();$producerProcess.StartInfo=$producerInfo;$consumerProcess=[Diagnostics.Process]::new();$consumerProcess.StartInfo=$consumerInfo;if(-not $producerProcess.Start()){throw 'Could not start pg_dump.'};$producerError=$producerProcess.StandardError.ReadToEndAsync();if(-not $consumerProcess.Start()){throw 'Could not start age.'};$consumerError=$consumerProcess.StandardError.ReadToEndAsync();$consumerOutput=$consumerProcess.StandardOutput.ReadToEndAsync();$buffer=[byte[]]::new(65536);while(($count=$producerProcess.StandardOutput.BaseStream.Read($buffer,0,$buffer.Length))-gt 0){$hash.AppendData($buffer,0,$count);$consumerProcess.StandardInput.BaseStream.Write($buffer,0,$count)};$consumerProcess.StandardInput.Close();$producerProcess.WaitForExit();$consumerProcess.WaitForExit();$producerMessage=$producerError.GetAwaiter().GetResult();$consumerMessage=$consumerError.GetAwaiter().GetResult();$null=$consumerOutput.GetAwaiter().GetResult();if($producerProcess.ExitCode-ne 0){throw "pg_dump failed: $producerMessage"};if($consumerProcess.ExitCode-ne 0){throw "age failed: $consumerMessage"};if(-not(Test-Path $Output)-or(Get-Item $Output).Length-eq 0){throw 'Encrypted output is missing.'};return ConvertTo-LowerHex ($hash.GetHashAndReset())}
    finally{$hash.Dispose();foreach($process in @($producerProcess,$consumerProcess)){if($process){if(-not $process.HasExited){$process.Kill($true)};$process.Dispose()}};if($bstr-ne[IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)};$plain=$null}
}

function Unlock-RecoveryIdentity([string]$Label,[string]$IdentityPath){
    Write-Host "Retrieve Recovery Identity $Label passphrase from the independent password manager. Stars will appear."
    $passphrase=(Read-StarredSecureString "Recovery Identity $Label passphrase").SecureString
    if($passphrase.Length-eq 0){$passphrase.Dispose();throw "Recovery Identity $Label passphrase was empty."}
    $bstr=[IntPtr]::Zero;$process=$null
    try{
        $bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($passphrase)
        $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        $info=New-ProcessInfo $age @('--decrypt','-j','batchpass',$IdentityPath)
        $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
        $info.Environment['AGE_PASSPHRASE']=$plain
        $info.Environment['PATH']=([IO.Path]::GetDirectoryName($batchpass)+';'+$info.Environment['PATH'])
        $process=[Diagnostics.Process]::new();$process.StartInfo=$info
        if(-not $process.Start()){throw 'Encrypted recovery identity process did not start.'}
        $identity=$process.StandardOutput.ReadToEnd();$null=$process.StandardError.ReadToEnd();$process.WaitForExit()
        if($process.ExitCode-ne 0-or$identity-notmatch'AGE-SECRET-KEY-1[0-9A-Z]+'){throw "Recovery Identity $Label could not be unlocked."}
        return $identity
    }finally{
        if($process){$process.Dispose()}
        if($bstr-ne[IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)}
        $plain=$null;$passphrase.Dispose()
    }
}

$run=Join-Path $backupRootFull ([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssZ'));New-Item -ItemType Directory -Path $run|Out-Null;'INCOMPLETE'|Set-Content (Join-Path $run 'BACKUP_INCOMPLETE') -Encoding ascii
$password=(Read-StarredSecureString 'Enter the existing STAGING database password').SecureString;if($password.Length-eq 0){$password.Dispose();throw 'A non-empty staging password is required.'}
$rolesOutput=Join-Path $run 'staging-roles.sql.age';$databaseOutput=Join-Path $run 'staging-database.dump.age';$schemaOutput=Join-Path $run 'staging-schema.sql.age';$rolesHash=$null;$databaseHash=$null;$schemaHash=$null
try{
    $common=@('--host',$HostName,'--port','5432','--username',$DatabaseUser,'--dbname','postgres','--no-password')
    $sql="begin read only; set local statement_timeout='10s'; select current_database(),current_setting('transaction_read_only'),current_setting('server_version_num')::int between 170000 and 179999,has_schema_privilege(session_user,'auth','USAGE'),has_schema_privilege(session_user,'public','USAGE'); rollback;"
    $identity=(Invoke-RemoteCaptured $psql ($common+@('--no-psqlrc','--quiet','--tuples-only','--no-align','--field-separator','|','--set','ON_ERROR_STOP=1','--command',$sql)) $password).Trim()
    $parts=$identity-split'\|'
    if($parts.Count-ne 5-or$parts[0]-ne'postgres'-or$parts[1]-ne'on'-or$parts[2]-ne't'-or$parts[3]-ne't'-or$parts[4]-ne't'){throw 'Reliable staging read-only identity could not be established.'}
    $roles=@('--host',$HostName,'--port','5432','--username',$DatabaseUser,'--no-password','--roles-only','--no-role-passwords')
    $rolesHash=Invoke-RemoteEncryptedStream $pgDumpAll $roles $rolesOutput $password
    $dump=@('--host',$HostName,'--port','5432','--username',$DatabaseUser,'--dbname','postgres','--no-password')
    $databaseHash=Invoke-RemoteEncryptedStream $pgDump ($dump+@('--format','custom')) $databaseOutput $password
    $schemaHash=Invoke-RemoteEncryptedStream $pgDump ($dump+@('--schema-only','--format','plain')) $schemaOutput $password
}finally{$password.Dispose();$password=$null}
$identityTextA=$null;$identityTextB=$null
try{
    $identityTextA=Unlock-RecoveryIdentity 'A' $identities[0]
    Write-Host 'RECOVERY IDENTITY A: verify encrypted roles archive'
    if((Get-DecryptedSha256FromIdentityText $age $identityTextA $rolesOutput)-ne$rolesHash){throw 'Independent roles recovery verification failed for Identity A.'}
    Write-Host 'RECOVERY IDENTITY A: verify encrypted database archive'
    if((Get-DecryptedSha256FromIdentityText $age $identityTextA $databaseOutput)-ne$databaseHash){throw 'Independent database recovery verification failed for Identity A.'}
    Write-Host 'RECOVERY IDENTITY A: verify encrypted schema archive'
    if((Get-DecryptedSha256FromIdentityText $age $identityTextA $schemaOutput)-ne$schemaHash){throw 'Independent schema recovery verification failed for Identity A.'}

    $identityTextB=Unlock-RecoveryIdentity 'B' $identities[1]
    Write-Host 'RECOVERY IDENTITY B: verify encrypted roles archive'
    if((Get-DecryptedSha256FromIdentityText $age $identityTextB $rolesOutput)-ne$rolesHash){throw 'Independent roles recovery verification failed for Identity B.'}
    Write-Host 'RECOVERY IDENTITY B: verify encrypted database archive'
    if((Get-DecryptedSha256FromIdentityText $age $identityTextB $databaseOutput)-ne$databaseHash){throw 'Independent database recovery verification failed for Identity B.'}
    Write-Host 'RECOVERY IDENTITY B: verify encrypted schema archive'
    if((Get-DecryptedSha256FromIdentityText $age $identityTextB $schemaOutput)-ne$schemaHash){throw 'Independent schema recovery verification failed for Identity B.'}

    Write-Host 'ARCHIVE INTEGRITY: list custom archive with Recovery Identity A'
    [void](Invoke-CheckedNativePipeline $age @('--decrypt','--identity','-',$databaseOutput) $pgRestore @('--list') -ProducerStandardInput $identityTextA)
}finally{$identityTextA=$null;$identityTextB=$null}
$artifacts=@([ordered]@{name='staging-roles.sql.age';plaintext_sha256=$rolesHash;ciphertext_sha256=Get-FileSha256Lower $rolesOutput;bytes=(Get-Item $rolesOutput).Length},[ordered]@{name='staging-database.dump.age';plaintext_sha256=$databaseHash;ciphertext_sha256=Get-FileSha256Lower $databaseOutput;bytes=(Get-Item $databaseOutput).Length},[ordered]@{name='staging-schema.sql.age';plaintext_sha256=$schemaHash;ciphertext_sha256=Get-FileSha256Lower $schemaOutput;bytes=(Get-Item $schemaOutput).Length});$manifest=[ordered]@{project_ref=$stagingRef;host=$HostName;tls='verify-full';read_only=$true;created_utc=[DateTime]::UtcNow.ToString('o');recipients=2;plaintext_archives_written=$false;privileges_included=$true;ownership_included=$true;roles_included=$true;role_passwords_included=$false;recovery_a_verified=$true;recovery_b_verified=$true;archive_list_verified=$true;isolated_restore_verified=$false;artifacts=$artifacts};Write-Utf8NoBomFile (Join-Path $run 'manifest.json') ($manifest|ConvertTo-Json -Depth 6);Write-EncryptedChecksums $run;'COMPLETE'|Set-Content (Join-Path $run 'BACKUP_COMPLETE') -Encoding ascii;Remove-Item (Join-Path $run 'BACKUP_INCOMPLETE');Write-Host "OWNER-PRESERVING ENCRYPTED STAGING BACKUP COMPLETE: $run"
