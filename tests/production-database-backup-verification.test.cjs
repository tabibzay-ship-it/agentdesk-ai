const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const text=fs.readFileSync('scripts/backup/Test-ProductionDatabaseBackup.ps1','utf8');
test('production backup verification requires both encrypted identities and streams to pg_restore',()=>{
  assert.match(text,/Label='A'/);assert.match(text,/Label='B'/);assert.match(text,/foreach\(\$pair in \$pairs\)/);
  assert.match(text,/--decrypt \$identity \| & \$AgePath --decrypt --identity - \$archive \| & \$PgRestorePath --list/);
  assert.match(text,/PlaintextWritten=\$false/);assert.match(text,/BACKUP_INVALID_EMPTY_STREAM/);
});
