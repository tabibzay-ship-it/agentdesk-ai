/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const sql = fs.readFileSync(path.join(root, "supabase/production-readonly-preflight.sql"), "utf8");
const launcher = fs.readFileSync(path.join(root, "scripts/backup/Invoke-ProductionReadOnlyPreflight.ps1"), "utf8");

test("production database preflight is bounded and contains no mutating SQL statements", () => {
  assert.match(sql, /begin transaction read only/i);
  assert.match(sql, /set local statement_timeout = '30s'/i);
  assert.match(sql, /set local lock_timeout = '3s'/i);
  assert.match(sql, /set local idle_in_transaction_session_timeout = '45s'/i);
  assert.match(sql, /rollback\s*;/i);
  assert.doesNotMatch(sql, /^\s*(insert|update|delete|merge|alter|drop|create|truncate|grant|revoke|copy|call|do|vacuum|refresh|reindex|cluster|comment|security\s+label)\b/im);
});

test("production preflight launcher fails closed around project identity, TLS and credentials", () => {
  assert.match(launcher, /Assert-ProductionConnection \$databaseUrl/);
  assert.match(launcher, /\$uri\.Port -ne 5432/);
  assert.match(launcher, /sslmode=verify-full/);
  assert.match(launcher, /SslRootCertPath/);
  assert.match(launcher, /807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA/);
  assert.match(launcher, /sslrootcert=' \+ \[Uri\]::EscapeDataString\(\$resolvedSslRootCertPath\)/);
  assert.match(launcher, /Read-Host 'Paste the copied PRODUCTION Session Pooler URI \(hidden; any embedded password is discarded\)' -AsSecureString/);
  assert.match(launcher, /Read-Host 'Enter the existing PRODUCTION database password \(hidden\)' -AsSecureString/);
  assert.match(launcher, /\$sanitizedBuilder\.Password = ''/);
  assert.match(launcher, /Assert-ProductionConnection \$databaseUrl/);
  assert.match(launcher, /default_transaction_read_only=on/);
  assert.match(launcher, /--no-psqlrc/);
  assert.match(launcher, /ON_ERROR_STOP=1/);
  assert.doesNotMatch(launcher, /SetEnvironmentVariable|(?:^|[\\/])\.env(?:\.local)?(?:[\s'\"]|$)|Write-Host\s+\$password/im);
});
