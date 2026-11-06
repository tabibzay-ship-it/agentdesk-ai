const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const text=fs.readFileSync('scripts/backup/Restore-ProductionDatabaseRamOnly.ps1','utf8');
test('production restore is isolated and RAM-only',()=>{
 for(const token of ["'--network','none'","'--log-driver','none'","'--memory-swap','2g'","'--read-only'","'--tmpfs','/backup","'--tmpfs','/var/lib/postgresql/data"]){assert.ok(text.includes(token),token)}
 assert.match(text,/\$persistentMounts\.Count-ne 0/);assert.match(text,/\$hostBinds\.Count-ne 0/);
 assert.match(text,/docker rm -f \$container/);assert.match(text,/plaintext_host_artifacts=\$false/);
});
test('production restore validates approved backup and emits aggregates only',()=>{
 assert.match(text,/function New-Proc\(\[string\]\$Path,\[string\[\]\]\$Arguments\)/);
 assert.doesNotMatch(text,/function New-Proc\([^\n]*\$Args\)/);
 assert.match(text,/cdynahtkwtcinjzmxjcs/);assert.match(text,/ciphertext hash mismatch/i);assert.match(text,/plaintext_sha256/);
 assert.match(text,/total_rows/);assert.match(text,/rls_tables/);assert.match(text,/acl_entries/);
 assert.match(text,/sum\(cardinality\(c\.relacl\)\)/);assert.doesNotMatch(text,/aclexplode/);
 assert.match(text,/IsNullOrWhiteSpace\(\$inventoryRaw\)/);
 assert.match(text,/\$roles=@\('postgres','anon'/);
 assert.doesNotMatch(text,/select \* from/i);
});
