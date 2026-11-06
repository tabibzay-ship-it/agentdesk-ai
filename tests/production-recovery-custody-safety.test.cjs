/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const script = fs.readFileSync(
  path.resolve(__dirname, "../scripts/backup/Initialize-ProductionRecoveryCustody.ps1"),
  "utf8",
);

test("production recovery identities are encrypted, separated, and production-specific", () => {
  assert.match(script, /agentdesk-production-\$Label-\$Timestamp\.identity\.age/);
  assert.match(script, /--passphrase --output \$partial -/);
  assert.match(script, /Recovery identities must use separate storage roots/);
  assert.match(script, /USB recovery destination identity does not match the approved SanDisk device/);
  assert.match(script, /project_ref = 'cdynahtkwtcinjzmxjcs'/);
  assert.match(script, /Refusing to overwrite an existing/);
  assert.match(script, /\[switch\]\$PreflightOnly/);
  assert.match(script, /KeysGenerated = \$false/);
  assert.doesNotMatch(script, /Write-(?:Host|Output).*\$identity|Set-Content.*\$identity/im);
});
