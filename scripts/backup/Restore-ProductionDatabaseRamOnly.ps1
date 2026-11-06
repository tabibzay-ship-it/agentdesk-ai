[CmdletBinding()]
param(
 [Parameter(Mandatory)][string]$BackupDirectory,
 [string]$RecoveryStatePath='C:\Users\Abdul Halim Tabibzay\Documents\AgentDesk-Production-Recovery-State\agentdesk-production-recovery-20261106T213959Z.public.json',
 [string]$Image='public.ecr.aws/supabase/postgres@sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc',
 [string]$AgePath="$PSScriptRoot\..\..\.tools\age\v1.3.2\age\age.exe"
)
Set-StrictMode -Version Latest;$ErrorActionPreference='Stop'
$expectedImage='public.ecr.aws/supabase/postgres@sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc'
function Get-Sha([string]$Path){$s=[IO.File]::OpenRead($Path);try{$h=[Security.Cryptography.SHA256]::Create();try{([BitConverter]::ToString($h.ComputeHash($s))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}finally{$s.Dispose()}}
function New-Proc([string]$Path,[string[]]$Args){$i=[Diagnostics.ProcessStartInfo]::new();$i.FileName=$Path;$i.UseShellExecute=$false;$i.CreateNoWindow=$true;foreach($a in $Args){[void]$i.ArgumentList.Add($a)};$p=[Diagnostics.Process]::new();$p.StartInfo=$i;$p}
if($Image-cne$expectedImage){throw 'Pinned Supabase image mismatch.'}
$backup=[IO.Path]::GetFullPath($BackupDirectory);$manifest=Get-Content -LiteralPath (Join-Path $backup 'manifest.json') -Raw|ConvertFrom-Json
if($manifest.project_ref-cne'cdynahtkwtcinjzmxjcs'-or$manifest.status-cne'complete'-or-not$manifest.source_read_only-or-not$manifest.tls_verify_full-or$manifest.plaintext_written_to_disk){throw 'Approved production backup manifest gate failed.'}
if(-not(Test-Path -LiteralPath (Join-Path $backup 'BACKUP_COMPLETE') -PathType Leaf)-or(Test-Path -LiteralPath (Join-Path $backup 'BACKUP_INVALID_EMPTY_STREAM'))){throw 'Backup completion/quarantine gate failed.'}
$archive=Join-Path $backup ([string]$manifest.artifact);if((Get-Sha $archive)-cne[string]$manifest.ciphertext_sha256){throw 'Backup ciphertext hash mismatch.'}
$state=Get-Content -LiteralPath $RecoveryStatePath -Raw|ConvertFrom-Json;$identity=$state.identity_a
if($state.project_ref-cne'cdynahtkwtcinjzmxjcs'-or(Get-Sha ([string]$identity.artifact))-cne([string]$identity.sha256).ToLowerInvariant()){throw 'Recovery Identity A baseline mismatch.'}
$digest=(docker image inspect $Image --format '{{index .RepoDigests 0}}').Trim();if($LASTEXITCODE-ne 0-or$digest-notmatch'@sha256:6058a6759ab9268cff8ee70641d61f1bd75953316281b76427cf5a6b4db2eafc$'){throw 'Pinned image digest unavailable.'}
$container='agentdesk-production-ram-restore-'+[Guid]::NewGuid().ToString('N')
$startup=@'
set -euo pipefail
export PGDATA=/var/lib/postgresql/data/pgdata
mkdir -p "$PGDATA"
initdb -D "$PGDATA" --username=agentdesk_bootstrap --auth-local=trust --auth-host=reject --no-sync >/dev/null
pg_ctl -D "$PGDATA" -o "-c listen_addresses= -k /tmp -c logging_collector=off" -w start >/dev/null
echo AGENTDESK_RAM_RESTORE_READY
exec sleep infinity
'@
$started=$false;$identityText=$null
try{
 $args=@('run','-d','--name',$container,'--network','none','--read-only','--log-driver','none','--memory','2g','--memory-swap','2g','--pids-limit','512','--user','100:101','--tmpfs','/tmp:rw,nosuid,nodev,size=256m,mode=1777','--tmpfs','/backup:rw,nosuid,nodev,size=512m,uid=100,gid=101,mode=0700','--tmpfs','/var/lib/postgresql/data:rw,nosuid,nodev,noexec,size=1g,uid=100,gid=101,mode=0700','--entrypoint','/bin/bash',$Image,'-c',$startup)
 docker @args|Out-Null;if($LASTEXITCODE-ne 0){throw 'RAM-only restore container failed to start.'};$started=$true
 $ready=$false;foreach($n in 1..80){docker exec $container pg_isready -h /tmp -U agentdesk_bootstrap -d postgres 2>$null|Out-Null;if($LASTEXITCODE-eq 0){$ready=$true;break};Start-Sleep -Milliseconds 250};if(-not$ready){throw 'RAM-only PostgreSQL did not become ready.'}
 $inspect=@(docker inspect $container|ConvertFrom-Json)[0]
 $persistentMounts=@($inspect.Mounts|Where-Object{$null-ne$_});$hostBinds=@($inspect.HostConfig.Binds|Where-Object{-not[string]::IsNullOrWhiteSpace([string]$_)})
 if($inspect.HostConfig.NetworkMode-ne'none'-or$inspect.HostConfig.LogConfig.Type-ne'none'-or$inspect.HostConfig.Memory-ne 2147483648-or$inspect.HostConfig.MemorySwap-ne 2147483648-or$persistentMounts.Count-ne 0-or$hostBinds.Count-ne 0){throw 'Container isolation configuration failed.'}
 $tmpfs=$inspect.HostConfig.Tmpfs.PSObject.Properties.Name;if('/backup'-notin$tmpfs-or'/var/lib/postgresql/data'-notin$tmpfs){throw 'Required RAM-only tmpfs mounts are absent.'}
 Write-Host 'Retrieve Production Identity A passphrase. Stars will appear.';$lines=@(& $AgePath --decrypt ([string]$identity.artifact));if($LASTEXITCODE-ne 0-or$lines.Count-lt 2){throw 'Recovery Identity A decryption failed.'};$identityText=($lines-join"`n")+"`n";$lines=$null
 $decrypt=New-Proc $AgePath @('--decrypt','--identity','-',$archive);$decrypt.StartInfo.RedirectStandardInput=$true;$decrypt.StartInfo.RedirectStandardOutput=$true;$decrypt.StartInfo.RedirectStandardError=$true
 $sink=New-Proc 'docker' @('exec','-i',$container,'sh','-c','cat > /backup/production.dump');$sink.StartInfo.RedirectStandardInput=$true;$sink.StartInfo.RedirectStandardOutput=$true;$sink.StartInfo.RedirectStandardError=$true
 $hash=[Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
 try{[void]$decrypt.Start();$de=$decrypt.StandardError.ReadToEndAsync();[void]$sink.Start();$se=$sink.StandardError.ReadToEndAsync();$so=$sink.StandardOutput.ReadToEndAsync();$decrypt.StandardInput.Write($identityText);$decrypt.StandardInput.Close();$identityText=$null;$buffer=[byte[]]::new(65536);$total=[int64]0;while(($count=$decrypt.StandardOutput.BaseStream.Read($buffer,0,$buffer.Length))-gt 0){$hash.AppendData($buffer,0,$count);$sink.StandardInput.BaseStream.Write($buffer,0,$count);$total+=$count};$sink.StandardInput.Close();$decrypt.WaitForExit();$sink.WaitForExit();$dem=$de.GetAwaiter().GetResult();$sem=$se.GetAwaiter().GetResult();$null=$so.GetAwaiter().GetResult();if($decrypt.ExitCode-ne 0){throw "Archive decryption failed: $dem"};if($sink.ExitCode-ne 0){throw "RAM-only archive transfer failed: $sem"};$plainHash=[Convert]::ToHexString($hash.GetHashAndReset()).ToLowerInvariant();if($plainHash-cne[string]$manifest.plaintext_sha256-or$total-lt 1024){throw 'Decrypted archive hash/size mismatch.'}}finally{$hash.Dispose();foreach($p in @($decrypt,$sink)){if(-not$p.HasExited){$p.Kill($true)};$p.Dispose()}}
 $insideHash=(docker exec $container sha256sum /backup/production.dump).Split(' ')[0];if($LASTEXITCODE-ne 0-or$insideHash-cne[string]$manifest.plaintext_sha256){throw 'RAM archive hash mismatch.'}
 docker exec $container pg_restore --list /backup/production.dump 1>$null;if($LASTEXITCODE-ne 0){throw 'Custom archive listing failed.'}
 $roles=@('anon','authenticated','service_role','authenticator','supabase_admin','supabase_auth_admin','supabase_storage_admin','supabase_realtime_admin','dashboard_user','pgbouncer')
 foreach($role in $roles){docker exec $container psql -h /tmp -U agentdesk_bootstrap -d postgres -v ON_ERROR_STOP=1 -c "do `$`$ begin if not exists(select 1 from pg_roles where rolname='$role') then create role $role nologin; end if; end `$`$;" 1>$null;if($LASTEXITCODE-ne 0){throw "Disposable role preparation failed: $role"}}
 docker exec $container createdb -h /tmp -U agentdesk_bootstrap -O agentdesk_bootstrap agentdesk_restore;if($LASTEXITCODE-ne 0){throw 'Disposable restore database creation failed.'}
 docker exec $container pg_restore --no-owner --file=/backup/restore.raw.sql /backup/production.dump;if($LASTEXITCODE-ne 0){throw 'Archive-to-RAM SQL expansion failed.'}
 docker exec $container sh -c "sed -E 's/ GRANTED BY [^;]+;/;/' /backup/restore.raw.sql > /backup/restore.sql";if($LASTEXITCODE-ne 0){throw 'Disposable grantor normalization failed.'}
 docker exec $container psql -h /tmp -U agentdesk_bootstrap -d agentdesk_restore --no-psqlrc -v ON_ERROR_STOP=1 -f /backup/restore.sql 1>$null;if($LASTEXITCODE-ne 0){throw 'Isolated database restore failed.'}
 $sql=@'
select json_build_object(
'schemas',(select count(*) from pg_namespace where nspname in ('auth','public','storage')),
'tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','public','storage') and c.relkind in ('r','p')),
'indexes',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','public','storage') and c.relkind='i'),
'functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('auth','public','storage')),
'policies',(select count(*) from pg_policies where schemaname in ('auth','public','storage')),
'rls_tables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','public','storage') and c.relrowsecurity),
'acl_entries',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,'{}')) x where n.nspname in ('auth','public','storage')),
'extensions',(select json_agg(extname order by extname) from pg_extension),
'total_rows',(select sum((xpath('/row/c/text()',query_to_xml(format('select count(*) c from %I.%I',n.nspname,c.relname),false,true,'')))[1]::text::bigint) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','public','storage') and c.relkind in ('r','p')),
'ledger_present',(to_regclass('supabase_migrations.schema_migrations') is not null));
'@
 $inventory=(docker exec $container psql -h /tmp -U agentdesk_bootstrap -d agentdesk_restore -At -v ON_ERROR_STOP=1 -c $sql).Trim();if($LASTEXITCODE-ne 0-or$inventory-notmatch'^\{'){throw 'Sanitized restored inventory failed.'}
 $fk=(docker exec $container psql -h /tmp -U agentdesk_bootstrap -d agentdesk_restore -At -v ON_ERROR_STOP=1 -c "select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('auth','public','storage') and c.contype='f';").Trim();if($LASTEXITCODE-ne 0){throw 'Constraint consistency check failed.'}
 $evidence=[ordered]@{result='PASS';project_ref='cdynahtkwtcinjzmxjcs';backup_id=$manifest.backup_id;image=$Image;network='none';logging='none';memory_bytes=2147483648;memory_swap_bytes=2147483648;host_mounts=0;persistent_volumes=0;tmpfs=@('/backup','/var/lib/postgresql/data','/tmp');plaintext_host_artifacts=$false;archive_sha256=$plainHash;inventory=($inventory|ConvertFrom-Json);foreign_key_constraints=[int]$fk;grantor_provenance='normalized_in_disposable_restore_only';completed_utc=[DateTime]::UtcNow.ToString('o')}
 $evidence|ConvertTo-Json -Depth 6|Set-Content -LiteralPath (Join-Path $backup 'ram-only-restore-evidence.json') -Encoding utf8
 Write-Host 'PRODUCTION RAM-ONLY ISOLATED RESTORE: PASS' -ForegroundColor Green;$evidence
}finally{$identityText=$null;if($started){docker rm -f $container 1>$null};$remaining=@(docker ps -a --filter "name=$container" -q);if($remaining.Count){throw 'Disposable restore container cleanup failed.'}}
