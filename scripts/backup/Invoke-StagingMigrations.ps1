[CmdletBinding()]
param(
 [string]$DatabaseUrl='postgresql://postgres.koqlnjctqeaykhbqkyuj@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require',
 [string]$SupabaseCli='D:\AgentDesk-Supabase-Tools\bin\supabase.exe',
 [string]$PostgresRoot="$env:LOCALAPPDATA\AgentDeskAI\tools\postgresql-17.11-5\extracted\pgsql",
 [string]$SslRootCert="$env:LOCALAPPDATA\AgentDeskAI\certificates\supabase-prod-ca-2021-official.crt",
 [string]$BackupDirectory="$env:LOCALAPPDATA\AgentDeskAI\staging-encrypted-backups\20261028-143641Z"
)
Set-StrictMode -Version Latest;$ErrorActionPreference='Stop';. "$PSScriptRoot\Backup.Common.ps1"
$staging='koqlnjctqeaykhbqkyuj';$production='cdynahtkwtcinjzmxjcs';$uri=[Uri]$DatabaseUrl
if($DatabaseUrl-match[regex]::Escape($production)-or$uri.UserInfo-ne"postgres.$staging"-or$uri.Host-ne'aws-0-ap-northeast-2.pooler.supabase.com'-or$uri.Port-ne5432-or$uri.AbsolutePath-ne'/postgres'){throw 'Exact staging Session Pooler target is required and production is forbidden.'}
foreach($p in @($SupabaseCli,(Join-Path $PostgresRoot 'bin\psql.exe'),$SslRootCert)){Assert-ExternalCommand $p}
if((& $SupabaseCli --version).Trim()-ne'2.120.0'){throw 'Only the verified Supabase CLI 2.120.0 is approved.'}
$migrationRoot=(Resolve-Path "$PSScriptRoot\..\..\supabase\migrations").Path;$repository=(Resolve-Path "$PSScriptRoot\..\..").Path
$approved=[ordered]@{
 '20261006000000_initial_application_schema.sql'='4D9A4B81354E11A3BEBF4838E1D66FE5E9E629D27054AE79E3089C45373A7C82'
 '20261007000000_add_agent_allowed_domains.sql'='ED0491002406C8854650BFD8C05ACB4A8D5C2EBD417D34FA63F472B5F4E1E926'
 '20261007010000_security_hardening.sql'='ED1A69BADC675AEE76C3518924C42424409E72A7807DCDECE9DC8CFBCF7679E6'
 '20261009000000_subscription_billing.sql'='8921FAD60BBAE5B2E0BD4EEDF108BA5A469470B841F9523E9A466134ABDD5FE5'
 '20261010000000_chat_attachments.sql'='88B987219B9351DC519A8CF94FBA22048F7B7472B90AC7B2C272D85861AD87A6'
 '20261011000000_super_admin.sql'='D9C0EB550151FB58000852CD2734C59A68A54E99A451E4A2EC4901BFE5EC4318'
 '20261012000000_leads_appointments.sql'='CA1FA45DFED11B103EBCA802646D6C6AF7A36F2792E1AB3D0855E2D6D8C40164'
 '20261013000000_marketing_consent.sql'='F50837F33BC1A210E8FC20BC89C70DCD533DFCAFA34E1C08A0895BE45B0795B2'
 '20261014000000_trial_recurring_payment_methods.sql'='612A1F2D616318823A2943EC28548A37CCAEFAC137DF11F3C38F5E8E65D41360'
 '20261015000000_conversation_history.sql'='BF8B10CE535ED3AACD7E59D5B0310F97073A5784DD16774991101D16ABFB652F'
 '20261016000000_chat_request_idempotency.sql'='A3A5B2F2E0C3F9F40C39C9CBCA53651931DB09107B0EBD9490BF13150041A72D'
 '20261017000000_ai_credit_controls.sql'='FB74CDA86EDB256B3F03FADE35C54003BBE2164761EA05E401099C3DD1DA1988'
 '20261018000000_nowpayments.sql'='0697ECA13519E42DA3CC7F6BD32745A10D8576B7F66796737433D425196B92E7'
}
if(@(Get-ChildItem $migrationRoot -File -Filter '*.sql').Count-ne13){throw 'The migration directory must contain exactly 13 SQL files.'}
foreach($entry in $approved.GetEnumerator()){$path=Join-Path $migrationRoot $entry.Key;if(-not(Test-Path $path)-or(Get-FileHash $path -Algorithm SHA256).Hash-ne$entry.Value){throw "Approved migration hash mismatch: $($entry.Key)"}}
$manifest=Get-Content (Join-Path $BackupDirectory 'manifest.json') -Raw|ConvertFrom-Json;$restore=Get-Content (Join-Path $BackupDirectory 'owner-restore-evidence.json') -Raw|ConvertFrom-Json;$rehearsal=Get-Content (Join-Path $BackupDirectory 'migration-rehearsal-evidence.json') -Raw|ConvertFrom-Json
if($manifest.project_ref-ne$staging-or-not$manifest.recovery_a_verified-or-not$manifest.recovery_b_verified-or-not$manifest.isolated_restore_verified-or-not$manifest.ownership_restore_verified-or$restore.result-ne'PASS'-or-not$restore.inventory_match-or$rehearsal.result-ne'PASS'-or@($rehearsal.migrations).Count-ne13-or@($rehearsal.migrations|Where-Object{-not$_.idempotent}).Count-ne0){throw 'Backup, restore, or rehearsal evidence gate failed.'}
foreach($artifact in @($manifest.artifacts)){if((Get-FileHash (Join-Path $BackupDirectory $artifact.name) -Algorithm SHA256).Hash.ToLowerInvariant()-ne$artifact.ciphertext_sha256){throw "Backup ciphertext hash mismatch: $($artifact.name)"}}

$psql=Join-Path $PostgresRoot 'bin\psql.exe'
function Invoke-WithPassword([string]$Tool,[string[]]$Arguments,[Security.SecureString]$Password,[hashtable]$Environment=@{}){
 $b=[IntPtr]::Zero;$p=$null;try{$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password);$plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b);$i=New-ProcessInfo $Tool $Arguments;$i.RedirectStandardOutput=$true;$i.RedirectStandardError=$true;$i.Environment['PGPASSWORD']=$plain;$i.Environment['PGSSLMODE']='verify-full';$i.Environment['PGSSLROOTCERT']=$SslRootCert;foreach($key in $Environment.Keys){$i.Environment[$key]=$Environment[$key]};$p=[Diagnostics.Process]::new();$p.StartInfo=$i;if(-not$p.Start()){throw 'Authorized staging process did not start.'};$o=$p.StandardOutput.ReadToEnd();$e=$p.StandardError.ReadToEnd();$p.WaitForExit();return [pscustomobject]@{ExitCode=$p.ExitCode;Output=$o;Error=$e}}finally{if($p){$p.Dispose()};if($b-ne[IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)};$plain=$null}}
function Invoke-ReadOnly([Security.SecureString]$Password,[string]$Sql){
 $args=@('--host',$uri.Host,'--port','5432','--username',"postgres.$staging",'--dbname','postgres','--no-password','--no-psqlrc','--quiet','--tuples-only','--no-align','--field-separator','|','--set','ON_ERROR_STOP=1','--command',$Sql)
 $r=Invoke-WithPassword $psql $args $Password @{PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=60000 -c lock_timeout=3000'}
 if($r.ExitCode -ne 0){throw "Read-only staging verification failed: $($r.Error.Trim())"}
 return $r.Output
}
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
$countSql="begin read only;select n.nspname||'|'||c.relname||'|'||(xpath('/row/c/text()',query_to_xml(format('select count(*) c from %I.%I',n.nspname,c.relname),false,true,'')))[1]::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('auth','public','storage','agentdesk_private') order by 1;rollback;"
$password=(Read-StarredSecureString 'Enter the existing STAGING database password').SecureString;if($password.Length-eq0){$password.Dispose();throw 'A non-empty staging password is required.'}
try{
 $currentLines=@((Invoke-ReadOnly $password $inventorySql)-split'\r?\n'|ForEach-Object{$_.Trim()}|Where-Object{$_});$baselineLines=@($restore.source_inventory|ForEach-Object{$_.Trim()});if(@(Compare-Object $baselineLines $currentLines).Count-ne0){throw 'Unexpected staging schema or aggregate-data drift since the verified backup.'}
 $beforeCounts=@((Invoke-ReadOnly $password $countSql)-split'\r?\n'|ForEach-Object{$_.Trim()}|Where-Object{$_})
 $cliUrl='postgresql://postgres.'+$staging+'@'+$uri.Host+':5432/postgres?sslmode=verify-full'
 $baseArgs=@('db','push','--db-url',$cliUrl,'--include-all','--skip-vault','--yes','--workdir',$repository)
 $dry=Invoke-WithPassword $SupabaseCli ($baseArgs+@('--dry-run')) $password @{}
 if($dry.ExitCode-ne0){throw "Supabase migration dry-run failed: $($dry.Error.Trim())"}
 $dryText=$dry.Output+"`n"+$dry.Error;foreach($name in $approved.Keys){if($dryText-notmatch[regex]::Escape($name)){throw "Dry-run did not include approved migration: $name"}}
 $push=Invoke-WithPassword $SupabaseCli $baseArgs $password @{}
 if($push.ExitCode-ne0){throw "Staging migration push failed: $($push.Error.Trim())"}
 $versions=@($approved.Keys|ForEach-Object{$_.Substring(0,14)})
 $quoted=($versions|ForEach-Object{"'$_'"})-join','
 $verifySql="begin read only;set local statement_timeout='30s';select current_database(),current_setting('transaction_read_only'),current_user;select version from supabase_migrations.schema_migrations where version in ($quoted) order by version;select (select count(*) from supabase_migrations.schema_migrations where version in ($quoted)),to_regclass('public.nowpayments_payment_orders') is not null,to_regclass('public.chat_request_keys') is not null,to_regclass('public.ai_credit_control_config') is not null,(select count(*) from storage.buckets where id='chat-attachments'),(select relrowsecurity and relforcerowsecurity from pg_class where oid='public.nowpayments_payment_orders'::regclass);rollback;"
 $verifyLines=@((Invoke-ReadOnly $password $verifySql)-split'\r?\n'|ForEach-Object{$_.Trim()}|Where-Object{$_})
 $summary=$verifyLines[-1]-split'\|'
 if($verifyLines[0] -notmatch '^postgres\|on\|postgres' -or
    $summary.Count -ne 6 -or $summary[0] -ne '13' -or
    $summary[1] -ne 't' -or $summary[2] -ne 't' -or
    $summary[3] -ne 't' -or $summary[4] -ne '1' -or
    $summary[5] -ne 't'){
  throw 'Post-migration ledger or terminal-object verification failed.'
 }
 $afterCounts=@((Invoke-ReadOnly $password $countSql)-split'\r?\n'|ForEach-Object{$_.Trim()}|Where-Object{$_});$afterMap=@{};foreach($line in $afterCounts){$parts=$line-split'\|';if($parts.Count-eq3){$afterMap["$($parts[0])|$($parts[1])"]=[int64]$parts[2]}};$losses=@();foreach($line in $beforeCounts){$parts=$line-split'\|';if($parts.Count-eq3){$key="$($parts[0])|$($parts[1])";if(-not$afterMap.ContainsKey($key)-or$afterMap[$key]-lt[int64]$parts[2]){$losses+=$key}}};if($losses.Count){throw "Existing-table data preservation failed: $($losses-join',')"}
 $evidence=[ordered]@{result='PASS';project_ref=$staging;cli_version='2.120.0';backup='20261028-143641Z';dry_run_verified=$true;migrations_applied=13;ledger_versions=$versions;terminal_objects_verified=$true;rls_verified=$true;chat_attachments_bucket_verified=$true;existing_table_rows_preserved=$true;completed_utc=[DateTime]::UtcNow.ToString('o')};Write-Utf8NoBomFile (Join-Path $BackupDirectory 'staging-migration-execution-evidence.json') ($evidence|ConvertTo-Json -Depth 6);Write-Host 'STAGING MIGRATIONS VERIFIED: 13/13' -ForegroundColor Green
}finally{$password.Dispose();$password=$null}
