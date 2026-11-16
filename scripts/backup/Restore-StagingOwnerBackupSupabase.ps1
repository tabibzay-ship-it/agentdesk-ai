[CmdletBinding()]
param(
 [Parameter(Mandatory)][string]$BackupDirectory,
 [Parameter(Mandatory)][string]$PublicStatePath,
 [string]$Image='public.ecr.aws/supabase/postgres@sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc',
 [string]$DatabaseUrl='postgresql://postgres.koqlnjctqeaykhbqkyuj@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require',
 [string]$PostgresRoot="$env:LOCALAPPDATA\AgentDeskAI\tools\postgresql-17.11-5\extracted\pgsql",
 [string]$AgeRoot="$PSScriptRoot\..\..\.tools\age\v1.3.2\age",
 [string]$SslRootCert="$env:LOCALAPPDATA\AgentDeskAI\certificates\supabase-prod-ca-2021-official.crt",
 [switch]$RehearseMigrations,
 [string]$MigrationRoot="$PSScriptRoot\..\..\supabase\migrations"
)
Set-StrictMode -Version Latest;$ErrorActionPreference='Stop';. "$PSScriptRoot\Backup.Common.ps1"
$staging='koqlnjctqeaykhbqkyuj';$production='cdynahtkwtcinjzmxjcs';$expectedImage='public.ecr.aws/supabase/postgres@sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc'
if($Image-ne$expectedImage-or$DatabaseUrl-match[regex]::Escape($production)){throw 'Pinned image or staging project guard failed.'}
$uri=[Uri]$DatabaseUrl;if($uri.UserInfo-ne"postgres.$staging"-or$uri.Host-notlike'*.pooler.supabase.com'-or$uri.AbsolutePath-ne'/postgres'-or$uri.Query-notmatch'sslmode=require'){throw 'Exact staging session-pooler URL is required.'}
$backup=[IO.Path]::GetFullPath($BackupDirectory);$manifestPath=Join-Path $backup 'manifest.json';$rolesArchive=Join-Path $backup 'staging-roles.sql.age';$databaseArchive=Join-Path $backup 'staging-database.dump.age'
foreach($p in @($manifestPath,$rolesArchive,$databaseArchive,$PublicStatePath,$SslRootCert,(Join-Path $backup 'BACKUP_COMPLETE'))){if(-not(Test-Path -LiteralPath $p -PathType Leaf)){throw "Required artifact missing: $p"}}
$manifest=Get-Content $manifestPath -Raw|ConvertFrom-Json
if($manifest.project_ref-ne$staging-or-not$manifest.recovery_a_verified-or-not$manifest.recovery_b_verified-or-not$manifest.archive_list_verified-or-not$manifest.privileges_included-or-not$manifest.ownership_included-or-not$manifest.roles_included-or$manifest.role_passwords_included-or$manifest.plaintext_archives_written){throw 'Owner-preserving backup manifest validation failed.'}
$rolesExpected=@($manifest.artifacts|Where-Object name -eq 'staging-roles.sql.age')[0];$databaseExpected=@($manifest.artifacts|Where-Object name -eq 'staging-database.dump.age')[0]
if((Get-FileSha256Lower $rolesArchive)-ne[string]$rolesExpected.ciphertext_sha256-or(Get-FileSha256Lower $databaseArchive)-ne[string]$databaseExpected.ciphertext_sha256){throw 'Backup ciphertext integrity failed.'}
$state=Get-Content $PublicStatePath -Raw|ConvertFrom-Json;$identityA=$state.identity_a
if((Get-FileHash $identityA.artifact -Algorithm SHA256).Hash-ne[string]$identityA.sha256){throw 'Recovery Identity A baseline mismatch.'}
$age=Join-Path $AgeRoot 'age.exe';$batchpass=Join-Path $AgeRoot 'age-plugin-batchpass.exe';$psql=Join-Path $PostgresRoot 'bin\psql.exe';foreach($p in @($age,$batchpass,$psql)){Assert-ExternalCommand $p}
$setup=(Resolve-Path "$PSScriptRoot\supabase-owner-restore-container.sh").Path;$container='agentdesk-owner-restore-'+[Guid]::NewGuid().ToString('N')
function Unlock-A{$s=(Read-StarredSecureString 'Recovery Identity A passphrase').SecureString;if($s.Length-eq 0){$s.Dispose();throw 'Identity A passphrase is empty.'};$b=[IntPtr]::Zero;$p=$null;try{$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b);$i=New-ProcessInfo $age @('--decrypt','-j','batchpass',[string]$identityA.artifact);$i.RedirectStandardOutput=$true;$i.RedirectStandardError=$true;$i.Environment['AGE_PASSPHRASE']=$plain;$i.Environment['PATH']=([IO.Path]::GetDirectoryName($batchpass)+';'+$i.Environment['PATH']);$p=[Diagnostics.Process]::new();$p.StartInfo=$i;if(-not$p.Start()){throw 'Identity A unlock process failed to start.'};$text=$p.StandardOutput.ReadToEnd();$null=$p.StandardError.ReadToEnd();$p.WaitForExit();if($p.ExitCode-ne 0-or$text-notmatch'AGE-SECRET-KEY-1'){throw 'Identity A unlock failed.'};return $text}finally{if($p){$p.Dispose()};if($b-ne[IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)};$plain=$null;$s.Dispose()}}
function Invoke-Source([Security.SecureString]$Password,[string]$Sql){$b=[IntPtr]::Zero;$p=$null;try{$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password);$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b);$i=New-ProcessInfo $psql @('--host',$uri.Host,'--port','5432','--username',"postgres.$staging",'--dbname','postgres','--no-password','--no-psqlrc','--quiet','--tuples-only','--no-align','--field-separator','|','--set','ON_ERROR_STOP=1','--command',$Sql);$i.RedirectStandardOutput=$true;$i.RedirectStandardError=$true;$i.Environment['PGPASSWORD']=$plain;$i.Environment['PGSSLMODE']='verify-full';$i.Environment['PGSSLROOTCERT']=$SslRootCert;$i.Environment['PGCONNECT_TIMEOUT']='10';$i.Environment['PGOPTIONS']='-c default_transaction_read_only=on -c statement_timeout=60000';$p=[Diagnostics.Process]::new();$p.StartInfo=$i;if(-not$p.Start()){throw 'Source inventory process failed to start.'};$o=$p.StandardOutput.ReadToEnd();$e=$p.StandardError.ReadToEnd();$p.WaitForExit();if($p.ExitCode-ne 0){throw "Source inventory failed: $($e.Trim())"};return $o}finally{if($p){$p.Dispose()};if($b-ne[IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)};$plain=$null}}
$inventorySql=@"
begin read only;set local statement_timeout='60s';
select 'OBJECTS',json_build_object('schemas',(select count(*) from pg_namespace where nspname in ('auth','public','storage')),'tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','public','storage') and c.relkind in ('r','p')),'indexes',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','public','storage') and c.relkind='i'),'functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('auth','public','storage')),'policies',(select count(*) from pg_policies where schemaname in ('auth','public','storage')));
select 'EXT',e.extname,e.extversion,n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by e.extname;
select 'TABLE',t.table_schema,t.table_name,(xpath('/row/c/text()',query_to_xml(format('select count(*) c from %I.%I',t.table_schema,t.table_name),false,true,'')))[1]::text::bigint from information_schema.tables t where t.table_type='BASE TABLE' and t.table_schema in ('auth','public','storage') order by 2,3;
select 'SCHEMA_OWNER',n.nspname,pg_get_userbyid(n.nspowner) from pg_namespace n where n.nspname in ('auth','public','storage') order by 2;
select 'REL_OWNER',n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','public','storage') and c.relkind in ('r','p','v','m','S','f') order by 2,3,4;
select 'FUNCTION_OWNER',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('auth','public','storage') order by 2,3,4;
select 'SCHEMA_ACL',n.nspname,coalesce(pg_get_userbyid(x.grantee),'PUBLIC'),pg_get_userbyid(x.grantor),x.privilege_type,x.is_grantable from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n'::"char",n.nspowner))) x where n.nspname in ('auth','public','storage') order by 2,3,4,5,6;
select 'REL_ACL',n.nspname,c.relname,c.relkind,coalesce(pg_get_userbyid(x.grantee),'PUBLIC'),pg_get_userbyid(x.grantor),x.privilege_type,x.is_grantable from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))) x where n.nspname in ('auth','public','storage') and c.relkind in ('r','p','v','m','S','f') order by 2,3,4,5,6,7,8;
select 'FUNCTION_ACL',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),coalesce(pg_get_userbyid(x.grantee),'PUBLIC'),pg_get_userbyid(x.grantor),x.privilege_type,x.is_grantable from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f'::"char",p.proowner))) x where n.nspname in ('auth','public','storage') order by 2,3,4,5,6,7,8;
select 'DEFAULT_ACL',coalesce(n.nspname,'*'),pg_get_userbyid(d.defaclrole),d.defaclobjtype,coalesce(pg_get_userbyid(x.grantee),'PUBLIC'),pg_get_userbyid(x.grantor),x.privilege_type,x.is_grantable from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace cross join lateral aclexplode(d.defaclacl) x where n.nspname in ('auth','public','storage') or d.defaclnamespace=0 order by 2,3,4,5,6,7,8;
select 'LEDGER',coalesce(to_regclass('supabase_migrations.schema_migrations')::text,'missing');rollback;
"@
$started=$false
try{
 $id=(docker image inspect $Image --format '{{index .RepoDigests 0}}').Trim();if($LASTEXITCODE-ne 0-or$id-notmatch'6058a6759ab9'){throw 'Pinned Supabase image digest is unavailable.'}
 $dockerArgs=@('run','-d','--name',$container,'--network','none','--read-only','--tmpfs','/tmp:rw,nosuid,size=256m','--tmpfs','/var/lib/postgresql/data:rw,nosuid,size=1g','--mount',"type=bind,source=$setup,target=/runner.sh,readonly")
 if($RehearseMigrations){$resolvedMigrations=(Resolve-Path $MigrationRoot).Path;$dockerArgs+=@('--mount',"type=bind,source=$resolvedMigrations,target=/migrations,readonly")}
 $dockerArgs+=@('--entrypoint','/bin/bash',$Image,'/runner.sh');docker @dockerArgs|Out-Null;if($LASTEXITCODE-ne 0){throw 'Disposable owner restore container failed to start.'};$started=$true
 $ready=$false;foreach($n in 1..60){$logs=docker logs $container 2>&1;if($logs-match'AGENTDESK_OWNER_RESTORE_READY'){$ready=$true;break};Start-Sleep -Milliseconds 250};if(-not$ready){throw "Disposable owner restore database did not become ready: $logs"}
 $inspect=@(docker inspect $container|ConvertFrom-Json)[0];$mounts=@($inspect.Mounts);$portProperties=@($inspect.HostConfig.PortBindings.PSObject.Properties);$expectedMounts=$(if($RehearseMigrations){2}else{1});if($inspect.HostConfig.NetworkMode-ne'none'-or$mounts.Count-ne$expectedMounts-or@($mounts|Where-Object{$_.Type-ne'bind'-or$_.RW}).Count-ne 0-or$portProperties.Count-ne 0){throw 'Disposable container isolation validation failed.'}
 Write-Host 'Retrieve Recovery Identity A passphrase. Stars will appear.';$identity=Unlock-A
 try{
  # PostgreSQL 17 records role-membership grantor provenance (GRANTED BY).
  # A fresh bootstrap superuser cannot impersonate Supabase-managed grantors.
  # Strip only that provenance while retaining each role, membership and ADMIN
  # option; object owners and database ACL grantors are restored unchanged.
  $roleRestore="sed -E 's/ GRANTED BY [^;]+;/;/' | psql -h /tmp -U agentdesk_bootstrap -d postgres --no-psqlrc --set ON_ERROR_STOP=1"
  $rolesHash=Invoke-CheckedNativePipeline $age @('--decrypt','--identity','-',$rolesArchive) 'docker' @('exec','-i','--user','postgres',$container,'bash','-c',$roleRestore) -ProducerStandardInput $identity
  if($rolesHash-ne[string]$rolesExpected.plaintext_sha256){throw 'Roles stream hash mismatch.'}
  docker exec --user postgres $container createdb -h /tmp -U agentdesk_bootstrap -O postgres agentdesk_restore;if($LASTEXITCODE-ne 0){throw 'Disposable restore database creation failed.'}
  $databaseHash=Invoke-CheckedNativePipeline $age @('--decrypt','--identity','-',$databaseArchive) 'docker' @('exec','-i','--user','postgres',$container,'pg_restore','-h','/tmp','-U','agentdesk_bootstrap','-d','agentdesk_restore','--exit-on-error') -ProducerStandardInput $identity
  if($databaseHash-ne[string]$databaseExpected.plaintext_sha256){throw 'Database stream hash mismatch.'}
 }finally{$identity=$null}
 $remotePassword=(Read-StarredSecureString 'Enter the existing STAGING database password').SecureString;if($remotePassword.Length-eq 0){throw 'Staging password is empty.'};try{$source=Invoke-Source $remotePassword $inventorySql}finally{$remotePassword.Dispose()}
 $restored=(docker exec --user postgres $container psql -h /tmp -U agentdesk_bootstrap -d agentdesk_restore --no-psqlrc --quiet --tuples-only --no-align --field-separator '|' --set ON_ERROR_STOP=1 --command $inventorySql|Out-String);if($LASTEXITCODE-ne 0){throw 'Restored inventory query failed.'}
 $sourceLines=@($source-split'\r?\n'|ForEach-Object{$_.Trim()}|Where-Object{$_});$restoreLines=@($restored-split'\r?\n'|ForEach-Object{$_.Trim()}|Where-Object{$_});$differences=@(Compare-Object $sourceLines $restoreLines);$match=($differences.Count-eq 0)
 $evidence=[ordered]@{result=$(if($match){'PASS'}else{'FAIL'});project_ref=$staging;image=$Image;network='none';persistent_volumes=0;plaintext_dump_written=$false;roles_stream_sha256=$rolesHash;database_stream_sha256=$databaseHash;role_membership_grantor_provenance='normalized_for_disposable_restore';source_inventory=$sourceLines;restored_inventory=$restoreLines;inventory_differences=@($differences|ForEach-Object{[ordered]@{line=$_.InputObject;side=$_.SideIndicator}});inventory_match=$match;vault_plaintext_decryption_tested=$false;completed_utc=[DateTime]::UtcNow.ToString('o')};Write-Utf8NoBomFile (Join-Path $backup 'owner-restore-evidence.json') ($evidence|ConvertTo-Json -Depth 7)
 if(-not$match){throw 'Source and restored ownership/ACL inventories did not match.'}
 if($RehearseMigrations){
  $migrationFiles=@(Get-ChildItem -LiteralPath $resolvedMigrations -Filter '*.sql' -File|Sort-Object Name);if($migrationFiles.Count-ne 13){throw "Expected exactly 13 migrations, found $($migrationFiles.Count)."}
  docker exec --user postgres $container createdb -h /tmp -U agentdesk_bootstrap -O postgres -T agentdesk_restore agentdesk_rehearsal;if($LASTEXITCODE-ne 0){throw 'Disposable rehearsal database creation failed.'}
  $countSql="select n.nspname||'|'||c.relname||'|'||(xpath('/row/c/text()',query_to_xml(format('select count(*) c from %I.%I',n.nspname,c.relname),false,true,'')))[1]::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('auth','public','storage','agentdesk_private') order by 1;"
  $beforeCounts=@(docker exec --user postgres $container psql -h /tmp -U agentdesk_bootstrap -d agentdesk_rehearsal -At -v ON_ERROR_STOP=1 -c $countSql);if($LASTEXITCODE-ne 0){throw 'Pre-migration row-count inventory failed.'}
  $markers=[ordered]@{
   '20261006000000_initial_application_schema.sql'="to_regclass('public.business_profiles') is not null"
   '20261007000000_add_agent_allowed_domains.sql'="exists(select 1 from information_schema.columns where table_schema='public' and table_name='agent_settings' and column_name='allowed_domains')"
   '20261007010000_security_hardening.sql'="to_regclass('agentdesk_private.chat_rate_buckets') is not null and to_regprocedure('public.check_chat_rate_limit(uuid,text,integer,integer)') is not null"
   '20261009000000_subscription_billing.sql'="to_regclass('public.subscription_plans') is not null and to_regprocedure('public.billing_process_verified_event(text,text,text,text,text,text,text,text,timestamp with time zone)') is not null"
   '20261010000000_chat_attachments.sql'="to_regclass('public.chat_attachments') is not null"
   '20261011000000_super_admin.sql'="to_regclass('public.super_admins') is not null"
   '20261012000000_leads_appointments.sql'="to_regclass('public.leads') is not null and to_regclass('public.appointments') is not null"
   '20261013000000_marketing_consent.sql'="to_regclass('public.marketing_preferences') is not null"
   '20261014000000_trial_recurring_payment_methods.sql'="to_regclass('public.trial_entitlements') is not null and to_regclass('public.payment_methods') is not null"
   '20261015000000_conversation_history.sql'="to_regprocedure('public.agentdesk_touch_conversation()') is not null and exists(select 1 from information_schema.columns where table_schema='public' and table_name='conversations' and column_name='title')"
   '20261016000000_chat_request_idempotency.sql'="to_regclass('public.chat_request_keys') is not null"
   '20261017000000_ai_credit_controls.sql'="to_regclass('public.ai_credit_control_config') is not null and to_regclass('agentdesk_private.ai_credit_ledger') is not null"
   '20261018000000_nowpayments.sql'="to_regclass('public.nowpayments_payment_orders') is not null and to_regprocedure('public.billing_process_nowpayments_ipn(uuid,text,text,numeric,text,timestamp with time zone)') is not null"
  }
  $results=@();$sequencePass=$true
  foreach($migration in $migrationFiles){
   $name=$migration.Name;$markerBefore=(docker exec --user postgres $container psql -h /tmp -U agentdesk_bootstrap -d agentdesk_rehearsal -At -v ON_ERROR_STOP=1 -c "select ($($markers[$name]));").Trim();if($LASTEXITCODE-ne 0){throw "Marker query failed for $name"}
   $schemaHashCommand="pg_dump -h /tmp -U agentdesk_bootstrap -d agentdesk_rehearsal --schema-only | sed -E '/^\\(un)?restrict /d' | sha256sum | cut -d' ' -f1"
   $beforeHash=(docker exec --user postgres $container bash -c $schemaHashCommand).Trim()
   $firstOutput=(docker exec --user postgres $container psql -h /tmp -U agentdesk_bootstrap -d agentdesk_rehearsal --no-psqlrc -v ON_ERROR_STOP=1 -f "/migrations/$name" 2>&1|Out-String);$firstExit=$LASTEXITCODE
   if($firstExit-ne 0){$classification=$(if($markerBefore-eq't'){'PARTIALLY APPLIED'}else{'AMBIGUOUS'});$results+=[ordered]@{migration=$name;classification=$classification;marker_before=$markerBefore;first_apply='FAIL';second_apply='NOT_RUN';schema_changed=$null;idempotent=$false;error=($firstOutput.Trim()-split'\r?\n'|Select-Object -Last 1)};$sequencePass=$false;break}
   $afterHash=(docker exec --user postgres $container bash -c $schemaHashCommand).Trim();$changed=($beforeHash-ne$afterHash);$classification=$(if(-not$changed){'EXACTLY APPLIED'}elseif($markerBefore-eq't'){'PARTIALLY APPLIED'}else{'NOT APPLIED'})
   $secondOutput=(docker exec --user postgres $container psql -h /tmp -U agentdesk_bootstrap -d agentdesk_rehearsal --no-psqlrc -v ON_ERROR_STOP=1 -f "/migrations/$name" 2>&1|Out-String);$secondExit=$LASTEXITCODE
   $secondHash=$(if($secondExit-eq 0){(docker exec --user postgres $container bash -c $schemaHashCommand).Trim()}else{''});$idempotent=($secondExit-eq 0-and$secondHash-eq$afterHash)
   $results+=[ordered]@{migration=$name;classification=$classification;marker_before=$markerBefore;first_apply='PASS';second_apply=$(if($secondExit-eq 0){'PASS'}else{'FAIL'});schema_changed=$changed;idempotent=$idempotent;error=$(if($secondExit-ne 0){($secondOutput.Trim()-split'\r?\n'|Select-Object -Last 1)}else{$null})}
   if(-not$idempotent){$sequencePass=$false}
  }
  $afterCounts=@(docker exec --user postgres $container psql -h /tmp -U agentdesk_bootstrap -d agentdesk_rehearsal -At -v ON_ERROR_STOP=1 -c $countSql);if($LASTEXITCODE-ne 0){throw 'Post-migration row-count inventory failed.'}
  $afterMap=@{};foreach($line in $afterCounts){$parts=$line-split'\|';if($parts.Count-eq 3){$afterMap["$($parts[0])|$($parts[1])"]=$parts[2]}}
  $preserved=$true
  $rowDiffs=@()
  $rowIncreases=@()
  foreach($line in $beforeCounts){
   $parts=$line-split'\|'
   if($parts.Count-eq 3){
    $key="$($parts[0])|$($parts[1])"
    $actual=$afterMap[$key]
    if($null-eq$actual-or[int64]$actual-lt[int64]$parts[2]){
     $preserved=$false
     $rowDiffs+=[ordered]@{table=$key;before=$parts[2];after=$actual}
    }elseif([int64]$actual-gt[int64]$parts[2]){
     $rowIncreases+=[ordered]@{table=$key;before=$parts[2];after=$actual}
    }
   }
  }
  $rehearsal=[ordered]@{result=$(if($sequencePass-and$preserved-and$results.Count-eq 13){'PASS'}else{'FAIL'});project_ref=$staging;database='disposable_clone';network='none';source_backup=(Split-Path $backup -Leaf);migrations=$results;existing_table_rows_preserved=$preserved;row_count_differences=$rowDiffs;expected_row_count_increases=$rowIncreases;completed_utc=[DateTime]::UtcNow.ToString('o')};Write-Utf8NoBomFile (Join-Path $backup 'migration-rehearsal-evidence.json') ($rehearsal|ConvertTo-Json -Depth 8)
 }
 $manifest.isolated_restore_verified=$true
 if($null-eq$manifest.PSObject.Properties['ownership_restore_verified']){$manifest|Add-Member -NotePropertyName ownership_restore_verified -NotePropertyValue $true}else{$manifest.ownership_restore_verified=$true}
 Write-Utf8NoBomFile $manifestPath ($manifest|ConvertTo-Json -Depth 7);Write-Host "OWNER-PRESERVING ISOLATED RESTORE VERIFIED: $backup"
}finally{if($started){docker rm -f $container|Out-Null}}
