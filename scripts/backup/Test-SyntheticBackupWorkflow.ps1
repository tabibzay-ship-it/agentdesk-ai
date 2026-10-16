Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\Backup.Common.ps1"

$age = "$PSScriptRoot\..\..\.tools\age\v1.3.2\age\age.exe"
$keygen = "$PSScriptRoot\..\..\.tools\age\v1.3.2\age\age-keygen.exe"
Assert-ExternalCommand $age; Assert-ExternalCommand $keygen

$suffix = ([Guid]::NewGuid().ToString('N')).Substring(0, 10)
$source = "agentdesk-recovery-source-$suffix"
$target = "agentdesk-recovery-target-$suffix"
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

    foreach ($container in @($source, $target)) {
        & docker run --detach --name $container --network none --env "POSTGRES_PASSWORD=$password" --label agentdesk.synthetic-backup-test=true postgres:17.11-alpine | Out-Null
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

    $seed = "create table public.synthetic_backup_test(id integer primary key, value text not null); insert into public.synthetic_backup_test values (1, 'local-only-sentinel');"
    & docker exec $source psql -U postgres -v ON_ERROR_STOP=1 -c $seed | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic seed failed.' }

    $artifacts = @()
    $rolesOut = Join-Path $backup 'roles.sql.age'
    $rolesSql = "create role anon nologin; create role authenticated nologin; alter default privileges in schema public grant all on tables to anon, authenticated;`n"
    $rolesHash = Invoke-CheckedNativePipeline $pwsh @('-NoProfile','-Command',"[Console]::Out.Write('$rolesSql')") $age ($ageRecipientArgs + @('--output',$rolesOut,'-')) $rolesOut
    $artifacts += [ordered]@{ name='roles.sql.age'; plaintext_sha256=$rolesHash }
    foreach ($item in @(
        @{ Name='schema.sql.age'; Args=@('exec',$source,'pg_dump','-U','postgres','--schema-only','--no-owner','--no-privileges','postgres') },
        @{ Name='data.sql.age'; Args=@('exec',$source,'pg_dump','-U','postgres','--data-only','--no-owner','--no-privileges','postgres') }
    )) {
        $out = Join-Path $backup $item.Name
        $plainHash = Invoke-CheckedNativePipeline 'docker' $item.Args $age ($ageRecipientArgs + @('--output',$out,'-')) $out
        $artifacts += [ordered]@{ name=$item.Name; plaintext_sha256=$plainHash }
    }
    [ordered]@{ project_ref='synthetic-local-only'; created_utc=[DateTime]::UtcNow.ToString('o'); completed_utc=[DateTime]::UtcNow.ToString('o'); status='complete'; artifacts=$artifacts } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $backup 'metadata.json') -Encoding utf8NoBOM
    Write-EncryptedChecksums $backup
    'Verified complete synthetic backup set.' | Set-Content -LiteralPath (Join-Path $backup 'BACKUP_COMPLETE') -Encoding ascii
    Test-EncryptedChecksums $backup

    foreach ($identity in $identities) {
        & "$PSScriptRoot\Test-EncryptedBackup.ps1" -BackupDirectory $backup -IdentityPath $identity -AgePath $age | Out-Null
    }
    & "$PSScriptRoot\Restore-IsolatedBackup.ps1" -BackupDirectory $backup -IdentityPath $identities[0] -ContainerName $target -AgePath $age -Confirm:$false | Out-Null
    $value = (& docker exec $target psql -U postgres -At -c 'select value from public.synthetic_backup_test where id=1;').Trim()
    if ($LASTEXITCODE -ne 0 -or $value -ne 'local-only-sentinel') { throw 'Synthetic restore content verification failed.' }
    $browserPrivileges = (& docker exec $target psql -U postgres -At -c "select has_table_privilege('anon','public.synthetic_backup_test','select,insert,update,delete') or has_table_privilege('authenticated','public.synthetic_backup_test','select,insert,update,delete');").Trim()
    if ($LASTEXITCODE -ne 0 -or $browserPrivileges -ne 'f') { throw 'Default browser table privileges were not revoked.' }
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
        AgeRoundTrip = 'PASS'
        TwoRecipientRecovery = 'PASS (both identities independently verified)'
        ChecksumVerification = 'PASS'
        TamperRejection = 'PASS'
        IncompleteSetRejection = 'PASS'
        BrowserDefaultPrivileges = 'PASS (revoked)'
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
    if (Test-Path -LiteralPath $work) {
        $resolved = [IO.Path]::GetFullPath($work)
        $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
        if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and $resolved -ne $tempRoot) {
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
}
