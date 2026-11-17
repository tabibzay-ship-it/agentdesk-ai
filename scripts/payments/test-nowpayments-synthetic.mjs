import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const env = {
  ...process.env,
  AGENTDESK_PGLITE_ROOT: root,
  NOWPAYMENTS_ENABLED: "false",
  NOWPAYMENTS_API_KEY: "",
  NOWPAYMENTS_IPN_SECRET: "",
};

// This runner must remain entirely synthetic. It deliberately removes every
// remote database credential before Node starts the test harness.
for (const name of [
  "DATABASE_URL", "DIRECT_URL", "PGHOST", "PGPASSWORD", "PGSERVICE",
  "SUPABASE_DB_URL", "SUPABASE_SERVICE_ROLE_KEY",
]) delete env[name];

const result = spawnSync(process.execPath, [
  "--test", "--test-concurrency=1",
  "tests/nowpayments-security.test.cjs",
  "tests/nowpayments-database.test.cjs",
], { cwd: root, env, stdio: "inherit" });

if (result.error) {
  console.error("Could not start the synthetic NOWPayments test runner.");
  process.exit(1);
}
process.exit(result.status ?? 1);
