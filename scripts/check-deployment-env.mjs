import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const productionSupabaseOrigin = "https://cdynahtkwtcinjzmxjcs.supabase.co";

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
];

const applicationOrigin =
  process.env.AGENTDESK_APP_ORIGIN?.trim() ||
  (process.env.CONTEXT === "deploy-preview"
    ? process.env.DEPLOY_PRIME_URL?.trim()
    : "");

const missing = required.filter((name) => !process.env[name]?.trim());
if (!applicationOrigin) missing.push("AGENTDESK_APP_ORIGIN");
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
  ["AGENTDESK_APP_ORIGIN", applicationOrigin],
]) {
  let url;
  try { url = new URL(value); } catch { /* handled below */ }
  if (!url || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    console.error(`${name} must be an HTTPS origin without credentials, path, query, or fragment.`);
    process.exit(1);
  }
}

if (process.env.CONTEXT === "production" && new URL(applicationOrigin).hostname !== "getagentdeskai.com") {
  console.error("Production AGENTDESK_APP_ORIGIN must remain https://getagentdeskai.com.");
  process.exit(1);
}

if (
  process.env.CONTEXT === "production" &&
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin !== productionSupabaseOrigin
) {
  console.error("Production NEXT_PUBLIC_SUPABASE_URL must use the approved AgentDesk AI Supabase project.");
  process.exit(1);
}

console.log(`Deployment environment is valid (${required.length + 1} required variable names present; values hidden).`);
