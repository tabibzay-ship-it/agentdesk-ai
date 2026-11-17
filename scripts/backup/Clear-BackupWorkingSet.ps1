[CmdletBinding(SupportsShouldProcess, ConfirmImpact='High')]
param([Parameter(Mandatory)][string]$Path)
$resolved = [IO.Path]::GetFullPath($Path)
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if (-not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup is restricted to the operating-system temporary directory.' }
if ($resolved -eq $tempRoot -or -not (Test-Path -LiteralPath $resolved -PathType Container)) { throw 'Refusing unsafe cleanup target.' }
if ($PSCmdlet.ShouldProcess($resolved, 'Remove the validated temporary working directory')) {
    Remove-Item -LiteralPath $resolved -Recurse -Force
}
Write-Warning 'Deletion is not guaranteed to sanitize SSD blocks. Production plaintext must never be written to disk.'
