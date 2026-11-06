/* eslint-disable @typescript-eslint/no-require-imports -- Node test harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const script = fs.readFileSync(
  path.resolve(__dirname, "../scripts/backup/Initialize-ProductionRecoveryCustody.ps1"),
  "utf8",
);
const verifier = fs.readFileSync(
  path.resolve(__dirname, "../scripts/backup/Test-ProductionRecoveryCustody.ps1"),
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

test("production recovery verification keeps plaintext identities off disk", () => {
  assert.match(verifier, /project_ref -cne 'cdynahtkwtcinjzmxjcs'/);
  assert.match(verifier, /Get-FileHash -LiteralPath \$artifact -Algorithm SHA256/);
  assert.match(verifier, /--decrypt \$aPath \| & \$AgePath --decrypt --identity - \$cipher/);
  assert.match(verifier, /--decrypt \$bPath \| & \$AgePath --decrypt --identity - \$cipher/);
  assert.match(verifier, /Remove-Item -LiteralPath \$cipher -Force/);
  assert.doesNotMatch(verifier, /Set-Content.*(?:identity|plain)|WriteAllText.*(?:identity|plain)/im);
});
