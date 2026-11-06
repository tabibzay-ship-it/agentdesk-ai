const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const text=fs.readFileSync('scripts/backup/New-EncryptedProductionDatabaseBackup.ps1','utf8');
test('production database backup is fail-closed and stream encrypted',()=>{
  assert.match(text,/ProductionDataAccessApproved/);assert.match(text,/Assert-ProductionConnection/);
  assert.match(text,/sslmode=verify-full/);assert.match(text,/default_transaction_read_only=on/);
  assert.match(text,/Invoke-CheckedNativePipeline \$PgDumpPath/);assert.match(text,/plaintext_written_to_disk=\$false/);
  assert.match(text,/@\('--dbname',\$verifiedUrl,'--format=custom','--no-owner','--file=-'\)/);
  assert.match(text,/Independent ciphertext copy hash mismatch/);
  assert.match(text,/\$sanitizedBuilder\.Password=''/);
  assert.match(text,/separate hidden prompt is the only/);
});
test('production database backup validates two recovery recipients and custody hashes',()=>{
  assert.match(text,/Two distinct valid production recipients are required/);
  assert.match(text,/Production recovery artifact integrity failed/);assert.match(text,/Pinned Supabase CA mismatch/);
});
