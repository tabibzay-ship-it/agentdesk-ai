[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)][string]$BackupDirectory,
    [Parameter(Mandatory)][string]$IdentityPath,
    [Parameter(Mandatory)][string]$ContainerName,
    [string]$Database = 'postgres',
    [string]$AgePath = "$PSScriptRoot\..\..\.tools\age\v1.3.2\age\age.exe"
)
. "$PSScriptRoot\Backup.Common.ps1"
Assert-ExternalCommand $AgePath; Assert-IsolatedContainer $ContainerName
Test-EncryptedChecksums $BackupDirectory
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

foreach ($name in @('schema.sql.age','data.sql.age')) {
    $encrypted = Join-Path $BackupDirectory $name
    Invoke-CheckedNativePipeline $AgePath @('--decrypt','--identity',$IdentityPath,$encrypted) 'docker' @('exec','-i',$ContainerName,'psql','-U','postgres','-d',$Database,'-v','ON_ERROR_STOP=1') | Out-Null
}
'Restore completed inside a network-isolated local PostgreSQL container.'
