[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$BackupDirectory,
    [Parameter(Mandatory)][string]$PublicStatePath,
    [string]$PostgresRoot = "$env:LOCALAPPDATA\AgentDeskAI\tools\postgresql-17.11-5\extracted\pgsql",
    [string]$AgeRoot = "$PSScriptRoot\..\..\.tools\age\v1.3.2\age",
    [string]$TemporaryRootParent = "$env:LOCALAPPDATA\AgentDeskAI\staging-restore-temp"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Backup.Common.ps1"

$stagingRef='koqlnjctqeaykhbqkyuj';$productionRef='cdynahtkwtcinjzmxjcs'
$backup=[IO.Path]::GetFullPath($BackupDirectory)
if($backup-match[regex]::Escape($productionRef)){throw 'Production project references are forbidden.'}
$manifestPath=Join-Path $backup 'manifest.json';$archive=Join-Path $backup 'staging-database.dump.age'
foreach($path in @($manifestPath,$archive,$PublicStatePath,(Join-Path $backup 'BACKUP_COMPLETE'))){if(-not(Test-Path -LiteralPath $path -PathType Leaf)){throw "Required verified backup artifact is missing: $path"}}
$manifest=Get-Content -LiteralPath $manifestPath -Raw|ConvertFrom-Json
if($manifest.project_ref-ne$stagingRef-or$manifest.host-notlike'*.pooler.supabase.com'-or$manifest.tls-ne'verify-full'-or-not$manifest.read_only-or-not$manifest.recovery_a_verified-or-not$manifest.recovery_b_verified-or-not$manifest.archive_list_verified-or-not$manifest.privileges_included-or$manifest.plaintext_archives_written){throw 'The backup manifest does not satisfy the approved staging safety gates.'}
$expected=@($manifest.artifacts|Where-Object name -eq 'staging-database.dump.age')[0]
if(-not$expected-or(Get-Item -LiteralPath $archive).Length-ne[int64]$expected.bytes-or(Get-FileSha256Lower $archive)-ne[string]$expected.ciphertext_sha256){throw 'Encrypted database archive integrity check failed.'}

$state=Get-Content -LiteralPath $PublicStatePath -Raw|ConvertFrom-Json;$identityA=$state.identity_a
if(-not(Test-Path -LiteralPath $identityA.artifact -PathType Leaf)-or(Get-Item -LiteralPath $identityA.artifact).Length-ne[int64]$identityA.bytes-or(Get-FileHash -LiteralPath $identityA.artifact -Algorithm SHA256).Hash-ne[string]$identityA.sha256){throw 'Recovery Identity A does not match the trusted baseline.'}

$age=Join-Path $AgeRoot 'age.exe';$batchpass=Join-Path $AgeRoot 'age-plugin-batchpass.exe';$bin=Join-Path $PostgresRoot 'bin';$tools=@{}
foreach($name in @('initdb','pg_ctl','pg_isready','createdb','psql','pg_restore','postgres')){$tools[$name]=Join-Path $bin "$name.exe";Assert-ExternalCommand $tools[$name]}
foreach($path in @($age,$batchpass)){Assert-ExternalCommand $path}
if((&$age --version).Trim()-ne'v1.3.2'-or(&$tools.pg_restore --version)-notmatch'\b17(?:\.\d+)?\b'){throw 'Verified age v1.3.2 or PostgreSQL 17 tooling is unavailable.'}

function Unlock-IdentityA {
    Write-Host 'Retrieve Recovery Identity A passphrase. Stars will appear.'
    $secure=(Read-StarredSecureString 'Recovery Identity A passphrase').SecureString
    if($secure.Length-eq 0){$secure.Dispose();throw 'Recovery Identity A passphrase was empty.'}
    $bstr=[IntPtr]::Zero;$process=$null
    try{$bstr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure);$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr);$info=New-ProcessInfo $age @('--decrypt','-j','batchpass',[string]$identityA.artifact);$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true;$info.Environment['AGE_PASSPHRASE']=$plain;$info.Environment['PATH']=([IO.Path]::GetDirectoryName($batchpass)+';'+$info.Environment['PATH']);$process=[Diagnostics.Process]::new();$process.StartInfo=$info;if(-not$process.Start()){throw 'Encrypted Recovery Identity A process did not start.'};$text=$process.StandardOutput.ReadToEnd();$null=$process.StandardError.ReadToEnd();$process.WaitForExit();if($process.ExitCode-ne 0-or$text-notmatch'AGE-SECRET-KEY-1[0-9A-Z]+'){throw 'Recovery Identity A could not be unlocked.'};return $text}
    finally{if($process){$process.Dispose()};if($bstr-ne[IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)};$plain=$null;$secure.Dispose()}
}

$tempParent=[IO.Path]::GetFullPath($TemporaryRootParent);if(-not(Test-Path -LiteralPath $tempParent)){New-Item -ItemType Directory -Path $tempParent|Out-Null}
$root=Join-Path $tempParent ('agentdesk-staging-restore-'+[Guid]::NewGuid().ToString('N'));$data=Join-Path $root 'pgdata';$log=Join-Path $root 'postgres.log';$errorLog=Join-Path $root 'postgres-error.log';$server=$null;$started=$false;$port=$null
try{
    New-Item -ItemType Directory -Path $root|Out-Null
    # The disposable server is explicitly bound to 127.0.0.1 below. Host trust
    # is required for its own loopback client; no non-loopback listener exists.
    &$tools.initdb '--pgdata' $data '--username' 'postgres' '--auth-local' 'trust' '--auth-host' 'trust' '--no-sync'|Out-Null;if($LASTEXITCODE-ne 0){throw 'Disposable PostgreSQL 17 initdb failed.'}
    $listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0);$listener.Start();$port=([Net.IPEndPoint]$listener.LocalEndpoint).Port;$listener.Stop()
    $server=Start-Process -FilePath $tools.postgres -ArgumentList "-D `"$data`" -h 127.0.0.1 -p $port" -RedirectStandardOutput $log -RedirectStandardError $errorLog -WindowStyle Hidden -PassThru;$started=$true;$ready=$false
    foreach($attempt in 1..40){&$tools.pg_isready '--host' '127.0.0.1' '--port' "$port" '--username' 'postgres' '--timeout' '1'|Out-Null;if($LASTEXITCODE-eq 0){$ready=$true;break};Start-Sleep -Milliseconds 250};if(-not$ready){throw 'Disposable localhost-only PostgreSQL 17 did not become ready.'}
    $listeners=@([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()|Where-Object Port -eq $port)
    if($listeners.Count-ne 1-or$listeners[0].Address.ToString()-ne'127.0.0.1'){throw 'Disposable PostgreSQL listener is not exclusively bound to IPv4 loopback.'}
    &$tools.createdb '--host' '127.0.0.1' '--port' "$port" '--username' 'postgres' 'agentdesk_restore';if($LASTEXITCODE-ne 0){throw 'Disposable restore database creation failed.'}
    $roles=@('anon','authenticated','service_role','authenticator','dashboard_user','pgbouncer','supabase_admin','supabase_auth_admin','supabase_storage_admin','supabase_functions_admin','supabase_read_only_user','supabase_replication_admin','supabase_etl_admin','supabase_pooler_user','supabase_pg_net_admin','pgsodium_keyholder','pgsodium_keyiduser','pgsodium_keymaker')
    $roleSql=($roles|ForEach-Object{"DO `$`$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$_') THEN CREATE ROLE `"$_`" NOLOGIN; END IF; END `$`$;"})-join"`n";&$tools.psql '--host' '127.0.0.1' '--port' "$port" '--username' 'postgres' '--dbname' 'agentdesk_restore' '--no-psqlrc' '--set' 'ON_ERROR_STOP=1' '--command' $roleSql|Out-Null;if($LASTEXITCODE-ne 0){throw 'Disposable Supabase role preparation failed.'}
    $identityText=Unlock-IdentityA;try{$restoredHash=Invoke-CheckedNativePipeline $age @('--decrypt','--identity','-',$archive) $tools.pg_restore @('--host','127.0.0.1','--port',"$port",'--username','postgres','--dbname','agentdesk_restore','--no-owner','--exit-on-error') -ProducerStandardInput $identityText}finally{$identityText=$null}
    if($restoredHash-ne[string]$expected.plaintext_sha256){throw 'Streaming restore plaintext hash did not match the verified manifest.'}
    $sql="select json_build_object('schemas',(select count(*) from pg_namespace where nspname in ('auth','public','storage')),'tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','public','storage') and c.relkind in ('r','p')),'indexes',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','public','storage') and c.relkind='i'),'functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('auth','public','storage')),'policies',(select count(*) from pg_policies where schemaname in ('auth','public','storage')),'grants',(select count(*) from information_schema.role_table_grants where table_schema in ('auth','public','storage')));"
    $json=(&$tools.psql '--host' '127.0.0.1' '--port' "$port" '--username' 'postgres' '--dbname' 'agentdesk_restore' '--no-psqlrc' '--tuples-only' '--no-align' '--set' 'ON_ERROR_STOP=1' '--command' $sql).Trim();if($LASTEXITCODE-ne 0-or[string]::IsNullOrWhiteSpace($json)){throw 'Restored aggregate evidence query failed.'}
    $evidence=[ordered]@{result='PASS';project_ref=$stagingRef;localhost='127.0.0.1';port=$port;postgresql17=$true;plaintext_archive_written=$false;stream_sha256=$restoredHash;restored_aggregates=($json|ConvertFrom-Json);completed_utc=[DateTime]::UtcNow.ToString('o')};$evidence|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $backup 'restore-evidence.json') -Encoding utf8;$manifest.isolated_restore_verified=$true;$manifest|ConvertTo-Json -Depth 6|Set-Content -LiteralPath $manifestPath -Encoding utf8
    Write-Host "ISOLATED STAGING RESTORE VERIFIED: $backup";$evidence
}finally{
    if($started){&$tools.pg_ctl '--pgdata' $data 'stop' '--mode' 'fast' '--wait'|Out-Null;if($server-and-not$server.HasExited){$server.Kill($true);$server.WaitForExit()};if($server){$server.Dispose()}}
    $resolved=[IO.Path]::GetFullPath($root);$parentPrefix=$tempParent.TrimEnd('\')+'\';if($resolved.StartsWith($parentPrefix,[StringComparison]::OrdinalIgnoreCase)-and[IO.Path]::GetFileName($resolved)-like'agentdesk-staging-restore-*'){Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue}
}
