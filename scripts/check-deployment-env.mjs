import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "AGENTDESK_APP_ORIGIN",
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(`Missing required deployment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (/service_role|sb_secret_/i.test(publicKey)) {
  console.error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must never contain a secret or service-role key.");
  process.exit(1);
}

for (const [name, value] of [
  ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
  ["AGENTDESK_APP_ORIGIN", process.env.AGENTDESK_APP_ORIGIN],
]) {
  let url;
  try { url = new URL(value); } catch { /* handled below */ }
  if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    console.error(`${name} must be an HTTPS origin without credentials, path, query, or fragment.`);
    process.exit(1);
  }
}

if (process.env.CONTEXT === "production" && new URL(process.env.AGENTDESK_APP_ORIGIN).hostname !== "getagentdeskai.com") {
  console.error("Production AGENTDESK_APP_ORIGIN must remain https://getagentdeskai.com.");
  process.exit(1);
}

console.log(`Deployment environment is valid (${required.length} required variable names present; values hidden).`);
