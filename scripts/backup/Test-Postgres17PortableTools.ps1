[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ToolRoot,
    [string]$ArchivePath,
    [string]$ExpectedArchiveSha256 = '80379B2C04D51C30225532E0AE04509899141E9957ED096FE749D7FD9DF8F82F'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($ArchivePath) {
    $actualHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash
    if ($actualHash -ne $ExpectedArchiveSha256) {
        throw 'PostgreSQL portable archive SHA-256 does not match the approved value.'
    }
}

$bin = Join-Path -Path $ToolRoot -ChildPath 'bin'
$requiredTools = @('pg_dump.exe', 'pg_restore.exe', 'psql.exe')
$results = foreach ($tool in $requiredTools) {
    $path = Join-Path -Path $bin -ChildPath $tool
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Required PostgreSQL client is missing: $tool"
    }

    $version = (& $path --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '\b17(?:\.\d+)?\b') {
        throw "$tool is not a PostgreSQL 17-compatible client."
    }

    [pscustomobject]@{
        Tool = $tool
        Version = $version
        Path = $path
    }
}

[pscustomobject]@{
    Validation = 'PASS (local files only; no database connection made)'
    ArchiveHashChecked = [bool]$ArchivePath
    PathChanged = $false
}
$results
