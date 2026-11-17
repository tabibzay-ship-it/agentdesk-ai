Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
. "$PSScriptRoot\Backup.Common.ps1"
Assert-SyntheticTestEnvironment
$passed=0;$failed=0
function Invoke-Rejection([string]$Name,[scriptblock]$Body){try{& $Body;"FAIL $Name";$script:failed++}catch{"PASS $Name (rejected)";$script:passed++}}
Invoke-Rejection 'wrong project endpoint' {Assert-ProductionConnection 'postgresql://postgres.wrong@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres'}
Invoke-Rejection 'embedded database password' {Assert-ProductionConnection 'postgresql://postgres.cdynahtkwtcinjzmxjcs:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres'}
Invoke-Rejection 'non-Supabase endpoint' {Assert-ProductionConnection 'postgresql://postgres.cdynahtkwtcinjzmxjcs@example.com:5432/postgres'}
Invoke-Rejection 'wrong database name' {Assert-ProductionConnection 'postgresql://postgres.cdynahtkwtcinjzmxjcs@aws-0-ap-northeast-1.pooler.supabase.com:5432/template1'}
Invoke-Rejection 'unapproved recovery container name' {Assert-IsolatedContainer 'postgres'}
if($failed){throw "$failed backup safety tests failed."}
"RESULT PASS=$passed FAIL=$failed"
