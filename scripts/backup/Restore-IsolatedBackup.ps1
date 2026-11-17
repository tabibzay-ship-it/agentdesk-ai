[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][string]$BackupDirectory,
    [Parameter(Mandatory)][string]$IdentityPath,
    [Parameter(Mandatory)][string]$ContainerName,
    [ValidateSet('GenericPostgres','SupabaseCompatible')][string]$TargetProfile = 'GenericPostgres',
    [string]$Database = 'postgres',
    [string]$AgePath = "$PSScriptRoot\..\..\.tools\age\v1.3.2\age\age.exe"
)
. "$PSScriptRoot\Backup.Common.ps1"
Assert-ExternalCommand $AgePath; Assert-IsolatedContainer $ContainerName
Test-EncryptedChecksums $BackupDirectory
$manifest = Test-BackupManifest $BackupDirectory -RequireCompleteMarker
if (-not $PSCmdlet.ShouldProcess("isolated container $ContainerName", 'Restore encrypted logical backup')) { return }

$roles = Join-Path $BackupDirectory 'roles.sql.age'
Invoke-CheckedNativePipeline $AgePath @('--decrypt','--identity',$IdentityPath,$roles) 'docker' @('exec','-i',$ContainerName,'psql','-U','postgres','-d',$Database,'-v','ON_ERROR_STOP=1') | Out-Null

$defaultPrivilegeSql = @'
alter default privileges in schema public revoke all on tables from public;
do $block$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'alter default privileges in schema public revoke all on tables from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'alter default privileges in schema public revoke all on tables from authenticated';
  end if;
end
$block$;
'@
& docker exec $ContainerName psql -U postgres -d $Database -v ON_ERROR_STOP=1 -c $defaultPrivilegeSql | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Default-privilege precaution failed.' }

$restoreArtifacts = @('schema.sql.age','migration-history-schema.sql.age','migration-history-data.sql.age','data.sql.age')
if ($TargetProfile -eq 'SupabaseCompatible') {
    $restoreArtifacts = @('schema.sql.age','managed-schema-customizations.sql.age','migration-history-schema.sql.age','migration-history-data.sql.age','data.sql.age')
}
foreach ($name in $restoreArtifacts) {
    $encrypted = Join-Path $BackupDirectory $name
    $dockerArgs = @('exec','-i')
    if ($name -eq 'data.sql.age') {
        $dockerArgs += @('--env','PGOPTIONS=-c session_replication_role=replica')
    }
    $dockerArgs += @($ContainerName,'psql','-U','postgres','-d',$Database,'-v','ON_ERROR_STOP=1')
    Invoke-CheckedNativePipeline $AgePath @('--decrypt','--identity',$IdentityPath,$encrypted) 'docker' $dockerArgs | Out-Null
}
$integrity = (& docker exec $ContainerName psql -U postgres -d $Database -At -F '|' -v ON_ERROR_STOP=1 -c "select current_setting('session_replication_role') = 'origin', not exists(select 1 from pg_constraint where contype = 'f' and not convalidated);").Trim()
if ($LASTEXITCODE -ne 0 -or $integrity -ne 't|t') {
    throw 'Post-restore integrity validation failed: trigger mode is not origin or a foreign key is unvalidated.'
}
if ($TargetProfile -eq 'GenericPostgres') {
    'Generic PostgreSQL restore completed in a network-isolated container. Managed Auth/Storage customizations and Storage objects were intentionally not restored; this is not proof of full Supabase recovery.'
} else {
    'Database portion restored to a declared Supabase-compatible network-isolated target. Storage restoration and reconciliation must pass separately before disaster recovery is complete.'
}
