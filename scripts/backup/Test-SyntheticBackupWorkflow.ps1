Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Backup.Common.ps1"
Assert-SyntheticTestEnvironment

$age = "$PSScriptRoot\..\..\.tools\age\v1.3.2\age\age.exe"
$keygen = "$PSScriptRoot\..\..\.tools\age\v1.3.2\age\age-keygen.exe"
Assert-ExternalCommand $age; Assert-ExternalCommand $keygen

$suffix = ([Guid]::NewGuid().ToString('N')).Substring(0, 10)
$source = "agentdesk-recovery-source-$suffix"
$target = "agentdesk-recovery-target-$suffix"
$sourceVolume = "agentdesk-recovery-source-data-$suffix"
$targetVolume = "agentdesk-recovery-target-data-$suffix"
$work = Join-Path ([IO.Path]::GetTempPath()) "agentdesk-backup-test-$suffix"
$identities = @(
    (Join-Path $work 'synthetic-operator-identity.txt'),
    (Join-Path $work 'synthetic-recovery-identity.txt')
)
$backup = Join-Path $work 'backup'
$pwsh = (Get-Process -Id $PID).Path
$password = "synthetic-$suffix"

try {
    New-Item -ItemType Directory -Path $backup -Force | Out-Null
    $recipients = @()
    foreach ($identity in $identities) {
        & $keygen -o $identity 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'Synthetic age identity generation failed.' }
        $recipient = (& $keygen -y $identity).Trim()
        if ($LASTEXITCODE -ne 0 -or $recipient -notmatch '^age1') { throw 'Synthetic age recipient derivation failed.' }
        $recipients += $recipient
    }
    if (($recipients | Sort-Object -Unique).Count -ne 2) { throw 'Synthetic age recipients are not distinct.' }
    $ageRecipientArgs = @('--encrypt')
    foreach ($recipient in $recipients) { $ageRecipientArgs += @('--recipient', $recipient) }

    foreach ($volume in @($sourceVolume, $targetVolume)) {
        & docker volume create --label agentdesk.synthetic-backup-test=true $volume | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not create disposable volume $volume." }
    }
    $containerVolumes = @{
        $source = $sourceVolume
        $target = $targetVolume
    }
    foreach ($container in @($source, $target)) {
        & docker run --detach --name $container --network none --env "POSTGRES_PASSWORD=$password" --label agentdesk.synthetic-backup-test=true --mount "type=volume,source=$($containerVolumes[$container]),target=/var/lib/postgresql/data" postgres:17.11-alpine | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not start $container." }
    }
    foreach ($container in @($source, $target)) {
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            & docker exec $container pg_isready -U postgres 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { break }
            Start-Sleep -Milliseconds 500
        }
        Assert-IsolatedContainer $container
    }

    & docker exec $source psql -U postgres -v ON_ERROR_STOP=1 -c 'create role anon nologin; create role authenticated nologin;' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic browser-role setup failed.' }

    $seed = @'
create table public.synthetic_users(id text primary key, email text not null unique);
create table public.agent_settings(user_id text primary key references public.synthetic_users(id), agent_name text not null);
create table public.conversations(id bigint generated always as identity primary key, user_id text not null references public.synthetic_users(id), title text not null, created_at timestamptz not null default now());
create index conversations_user_created_idx on public.conversations(user_id, created_at desc);
create table public.messages(id bigint generated always as identity primary key, conversation_id bigint not null references public.conversations(id), body text not null);
create table public.billing_records(id bigint generated always as identity primary key, user_id text not null references public.synthetic_users(id), amount_cents integer not null check (amount_cents >= 0));
create table public.subscription_records(id bigint generated always as identity primary key, user_id text not null references public.synthetic_users(id), status text not null);
create table public.ai_credit_ledger(id bigint generated always as identity primary key, user_id text not null references public.synthetic_users(id), delta integer not null, request_id text not null unique);
create table public.storage_objects(id bigint generated always as identity primary key, owner_id text not null references public.synthetic_users(id), bucket text not null, object_path text not null, sha256 text not null, unique(bucket, object_path));
create table public.trigger_audit(id bigint generated always as identity primary key, conversation_id bigint not null, event text not null);
create function public.audit_conversation_insert() returns trigger language plpgsql as $fn$ begin insert into public.trigger_audit(conversation_id,event) values(new.id,'insert'); return new; end $fn$;
create trigger conversations_insert_audit after insert on public.conversations for each row execute function public.audit_conversation_insert();
alter table public.conversations enable row level security;
create policy conversations_owner on public.conversations for select to authenticated using (user_id = current_setting('request.jwt.claim.sub', true));
grant usage on schema public to authenticated;
grant select on public.conversations to authenticated;
insert into public.synthetic_users values ('synthetic-user-a','a@example.invalid'),('synthetic-user-b','b@example.invalid');
insert into public.agent_settings values ('synthetic-user-a','Synthetic Agent');
insert into public.conversations(user_id,title) values ('synthetic-user-a','Private A'),('synthetic-user-b','Private B');
insert into public.messages(conversation_id,body) values (1,'synthetic message');
insert into public.billing_records(user_id,amount_cents) values ('synthetic-user-a',1200);
insert into public.subscription_records(user_id,status) values ('synthetic-user-a','test_active');
insert into public.ai_credit_ledger(user_id,delta,request_id) values ('synthetic-user-a',-3,'synthetic-request-1');
insert into public.storage_objects(owner_id,bucket,object_path,sha256) values ('synthetic-user-a','private','synthetic/file.txt',repeat('a',64));
'@
    & docker exec $source psql -U postgres -v ON_ERROR_STOP=1 -c $seed | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic seed failed.' }

    $artifacts = @()
    $rolesOut = Join-Path $backup 'roles.sql.age'
    $rolesSql = "create role anon nologin; create role authenticated nologin; alter default privileges in schema public grant all on tables to anon, authenticated;`n"
    $rolesHash = Invoke-CheckedNativePipeline $pwsh @('-NoProfile','-Command',"[Console]::Out.Write('$rolesSql')") $age ($ageRecipientArgs + @('--output',$rolesOut,'-')) $rolesOut
    $artifacts += [ordered]@{ name='roles.sql.age'; plaintext_sha256=$rolesHash }
    foreach ($item in @(
        @{ Name='schema.sql.age'; Args=@('exec',$source,'pg_dump','-U','postgres','--schema-only','--no-owner','postgres') },
        @{ Name='data.sql.age'; Args=@('exec',$source,'pg_dump','-U','postgres','--data-only','--no-owner','--no-privileges','postgres') }
    )) {
        $out = Join-Path $backup $item.Name
        $plainHash = Invoke-CheckedNativePipeline 'docker' $item.Args $age ($ageRecipientArgs + @('--output',$out,'-')) $out
        $artifacts += [ordered]@{ name=$item.Name; plaintext_sha256=$plainHash }
    }
    foreach($inline in @(
        @{Name='migration-history-schema.sql.age';Sql='create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations(version text primary key);'},
        @{Name='migration-history-data.sql.age';Sql="insert into supabase_migrations.schema_migrations(version) values ('synthetic') on conflict do nothing;"},
        @{Name='managed-schema-customizations.sql.age';Sql='select 1;'}
    )){
        $out=Join-Path $backup $inline.Name
        $plainHash=Invoke-CheckedNativePipeline $pwsh @('-NoProfile','-Command',"[Console]::Out.Write('$($inline.Sql.Replace("'","''"))')") $age ($ageRecipientArgs+@('--output',$out,'-')) $out
        $artifacts += [ordered]@{name=$inline.Name;plaintext_sha256=$plainHash}
    }
    foreach($artifact in $artifacts){$path=Join-Path $backup $artifact.name;$artifact['encrypted_bytes']=(Get-Item $path).Length;$artifact['ciphertext_sha256']=Get-FileSha256Lower $path;$artifact['coverage']='synthetic'}
    [ordered]@{ manifest_version=2;backup_id=$suffix;project_ref='synthetic-local-only';created_utc=[DateTime]::UtcNow.ToString('o');completed_utc=[DateTime]::UtcNow.ToString('o');database_version='17.11';application_commit='synthetic';status='complete';artifacts=$artifacts;storage=[ordered]@{inventory_verified=$true;bucket_count=0;object_count=0;buckets=@();objects=@()};required_recovery_dependencies=@('synthetic age identity','PostgreSQL 17') } |
        ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $backup 'manifest.json') -Encoding utf8NoBOM
    Write-EncryptedChecksums $backup
    Test-EncryptedChecksums $backup
    Test-BackupManifest $backup | Out-Null
    Write-AtomicCompletionMarker $backup

    foreach ($identity in $identities) {
        & "$PSScriptRoot\Test-EncryptedBackup.ps1" -BackupDirectory $backup -IdentityPath $identity -AgePath $age | Out-Null
    }
    & "$PSScriptRoot\Restore-IsolatedBackup.ps1" -BackupDirectory $backup -IdentityPath $identities[0] -ContainerName $target -AgePath $age -Confirm:$false | Out-Null
    $counts = (& docker exec $target psql -U postgres -At -F '|' -c "select (select count(*) from public.synthetic_users),(select count(*) from public.conversations),(select count(*) from public.messages),(select count(*) from public.billing_records),(select count(*) from public.subscription_records),(select count(*) from public.ai_credit_ledger),(select count(*) from public.storage_objects),(select count(*) from public.trigger_audit);").Trim()
    if ($LASTEXITCODE -ne 0 -or $counts -ne '2|2|1|1|1|1|1|2') { throw "Synthetic restore row reconciliation failed: $counts" }
    $objects = (& docker exec $target psql -U postgres -At -F '|' -c "select to_regprocedure('public.audit_conversation_insert()') is not null, exists(select 1 from pg_trigger where tgname='conversations_insert_audit' and not tgisinternal), exists(select 1 from pg_indexes where indexname='conversations_user_created_idx'), (select relrowsecurity from pg_class where oid='public.conversations'::regclass), exists(select 1 from pg_policies where schemaname='public' and tablename='conversations' and policyname='conversations_owner'), has_table_privilege('authenticated','public.conversations','select'), has_table_privilege('anon','public.conversations','select');").Trim()
    if ($LASTEXITCODE -ne 0 -or $objects -ne 't|t|t|t|t|t|f') { throw "Schema/security object reconciliation failed: $objects" }
    $triggerBefore = [int](& docker exec $target psql -U postgres -At -c 'select count(*) from public.trigger_audit;').Trim()
    & docker exec $target psql -U postgres -v ON_ERROR_STOP=1 -c "insert into public.conversations(user_id,title) values ('synthetic-user-a','Post-restore trigger check');" | Out-Null
    $triggerAfter = [int](& docker exec $target psql -U postgres -At -c 'select count(*) from public.trigger_audit;').Trim()
    if ($LASTEXITCODE -ne 0 -or $triggerAfter -ne ($triggerBefore + 1)) { throw 'Normal trigger behavior was not restored after data import.' }
    & docker exec $target psql -U postgres -v ON_ERROR_STOP=1 -c "insert into public.messages(conversation_id,body) values (999999,'must fail');" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { throw 'Post-restore foreign-key enforcement failed.' }
    $rls = @(& docker exec $target psql -U postgres -At -v ON_ERROR_STOP=1 -c "set role authenticated; select set_config('request.jwt.claim.sub','synthetic-user-a',false); select count(*) from public.conversations;")
    $rlsCount = @($rls | ForEach-Object { $_.Trim() } | Where-Object { $_ -match '^\d+$' })[-1]
    if ($LASTEXITCODE -ne 0 -or $rlsCount -ne '2') { throw 'RLS tenant-isolation verification failed.' }
    $readOnly = ((& docker exec $target psql -U postgres -At -v ON_ERROR_STOP=1 -c 'begin read only; select current_setting(''transaction_read_only''); rollback;') -join "`n").Trim()
    if ($LASTEXITCODE -ne 0 -or $readOnly -notmatch 'on') { throw 'Read-only validation transaction failed.' }

    $tampered = Join-Path $work 'tampered'
    Copy-Item -LiteralPath $backup -Destination $tampered -Recurse
    [IO.File]::AppendAllText((Join-Path $tampered 'data.sql.age'), 'tamper')
    $tamperRejected = $false
    try { Test-EncryptedChecksums $tampered } catch { $tamperRejected = $true }
    if (-not $tamperRejected) { throw 'Checksum verification did not reject tampering.' }

    $incomplete = Join-Path $work 'incomplete'
    Copy-Item -LiteralPath $backup -Destination $incomplete -Recurse
    'Synthetic incomplete set.' | Set-Content -LiteralPath (Join-Path $incomplete 'BACKUP_INCOMPLETE') -Encoding ascii
    $incompleteRejected = $false
    try { & "$PSScriptRoot\Test-EncryptedBackup.ps1" -BackupDirectory $incomplete -IdentityPath $identity -AgePath $age | Out-Null } catch { $incompleteRejected = $true }
    if (-not $incompleteRejected) { throw 'Incomplete backup set was not rejected.' }

    [pscustomobject]@{
        SourceContainer = $source
        TargetContainer = $target
        SourceVolume = $sourceVolume
        TargetVolume = $targetVolume
        AgeRoundTrip = 'PASS'
        TwoRecipientRecovery = 'PASS (both identities independently verified)'
        ChecksumVerification = 'PASS'
        TamperRejection = 'PASS'
        IncompleteSetRejection = 'PASS'
        SchemaObjects = 'PASS (FKs, index, function, trigger)'
        PostRestoreTrigger = 'PASS (normal firing restored)'
        ForeignKeyEnforcement = 'PASS (invalid reference rejected)'
        RlsTenantIsolation = 'PASS (only owning user rows visible)'
        EffectiveGrants = 'PASS (authenticated SELECT; anon denied)'
        RowReconciliation = "PASS ($counts)"
        PostgreSQLVersion = (& docker exec $target psql -U postgres -At -c 'show server_version;').Trim()
        NetworkIsolation = 'PASS (none)'
        SyntheticRestore = 'PASS'
        ReadOnlyValidation = 'PASS'
        ProductionConnections = 'NONE'
    } | Format-List
}
finally {
    foreach ($container in @($source, $target)) {
        & docker rm --force $container 2>$null | Out-Null
    }
    foreach ($volume in @($sourceVolume, $targetVolume)) {
        & docker volume rm $volume 2>$null | Out-Null
    }
    if (Test-Path -LiteralPath $work) {
        $resolved = [IO.Path]::GetFullPath($work)
        $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and $resolved -ne $tempRoot) {
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
}
