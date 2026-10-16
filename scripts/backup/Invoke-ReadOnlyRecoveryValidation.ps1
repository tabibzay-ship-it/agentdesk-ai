param(
    [Parameter(Mandatory)][string]$ContainerName,
    [string]$Database = 'postgres',
    [string]$SqlPath = "$PSScriptRoot\..\..\supabase\production-readonly-preflight.sql"
)
. "$PSScriptRoot\Backup.Common.ps1"
Assert-IsolatedContainer $ContainerName
Get-Content -Raw -LiteralPath $SqlPath | docker exec -i $ContainerName psql -U postgres -d $Database -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw 'Read-only recovery validation failed.' }
