import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const productionSupabaseOrigin = "https://cdynahtkwtcinjzmxjcs.supabase.co";
const approvedStagingProjectRef = "koqlnjctqeaykhbqkyuj";

function isRedacted(value) {
  return !value || /\*|redact|sensitive.{0,12}hidden/i.test(value);
}

async function verifyStagingKey(url, key, kind) {
  const endpoint = kind === "publishable"
    ? new URL("/auth/v1/settings", url)
    : new URL("/auth/v1/admin/users?page=1&per_page=1", url);
  const headers = { apikey: key };
  if (kind === "service") headers.Authorization = `Bearer ${key}`;
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

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
if (process.env.NOWPAYMENTS_ENABLED === "true") {
  for (const name of ["NOWPAYMENTS_API_KEY", "NOWPAYMENTS_IPN_SECRET"]) {
    if (!process.env[name]?.trim()) missing.push(name);
  }
}
if (missing.length) {
  console.error(`Missing required deployment variables: ${missing.join(", ")}`);
  process.exit(1);
}

for (const name of required) {
  if (isRedacted(process.env[name])) {
    console.error(`${name} is missing or redacted in the trusted build environment.`);
    process.exit(1);
  }
}

const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (/service_role|sb_secret_/i.test(publicKey)) {
  console.error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must never contain a secret or service-role key.");
  process.exit(1);
}

if (process.env.NOWPAYMENTS_ENABLED && !["true", "false"].includes(process.env.NOWPAYMENTS_ENABLED)) {
  console.error("NOWPAYMENTS_ENABLED must be exactly true or false.");
  process.exit(1);
}

if (process.env.NOWPAYMENTS_API_ORIGIN) {
  const allowedNowPaymentsOrigins = ["https://api.nowpayments.io", "https://api.sandbox.nowpayments.io"];
  if (!allowedNowPaymentsOrigins.includes(process.env.NOWPAYMENTS_API_ORIGIN)) {
    console.error("NOWPAYMENTS_API_ORIGIN must use an approved NOWPayments production or sandbox API origin.");
    process.exit(1);
  }
  if (process.env.CONTEXT === "production" && process.env.NOWPAYMENTS_API_ORIGIN !== "https://api.nowpayments.io") {
    console.error("Production NOWPAYMENTS_API_ORIGIN must use the production NOWPayments API.");
    process.exit(1);
  }
  if (process.env.CONTEXT === "deploy-preview" && process.env.NOWPAYMENTS_API_ORIGIN !== "https://api.sandbox.nowpayments.io") {
    console.error("Deploy Preview NOWPAYMENTS_API_ORIGIN must use the NOWPayments sandbox API.");
    process.exit(1);
  }
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

if (
  process.env.CONTEXT === "deploy-preview" &&
  new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin === productionSupabaseOrigin
) {
  console.error("Deploy Preview must never use the production AgentDesk AI Supabase project.");
  process.exit(1);
}

if (process.env.CONTEXT === "deploy-preview") {
  const expectedRef = process.env.AGENTDESK_EXPECTED_SUPABASE_PROJECT_REF?.trim();
  const expectedOrigin = `https://${approvedStagingProjectRef}.supabase.co`;
  if (expectedRef !== approvedStagingProjectRef) {
    console.error("Deploy Preview staging project identity is missing or unapproved.");
    process.exit(1);
  }
  if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin !== expectedOrigin) {
    console.error("Deploy Preview must use the exact approved staging Supabase project.");
    process.exit(1);
  }
  if (process.env.AGENTDESK_VERIFY_STAGING_KEYS !== "true") {
    console.error("Deploy Preview staging key verification must be enabled.");
    process.exit(1);
  }
  if (process.env.AGENTDESK_EXTERNAL_AI_DISABLED !== "true") {
    console.error("Deploy Preview external AI providers must remain disabled.");
    process.exit(1);
  }
  if (process.env.SUPABASE_SERVICE_ROLE_KEY === publicKey) {
    console.error("Deploy Preview Supabase browser and service keys must be distinct.");
    process.exit(1);
  }

  // Secret values are unavailable to local Netlify CLI builds. The hosted
  // Netlify build is the trusted boundary that must prove both keys are
  // accepted by the exact staging project without printing either value.
  if (process.env.NETLIFY === "true") {
    const [publishableKeyValid, serviceKeyValid] = await Promise.all([
      verifyStagingKey(expectedOrigin, publicKey, "publishable"),
      verifyStagingKey(expectedOrigin, process.env.SUPABASE_SERVICE_ROLE_KEY, "service"),
    ]);
    if (!publishableKeyValid || !serviceKeyValid) {
      console.error("Deploy Preview Supabase keys do not match the approved staging project.");
      process.exit(1);
    }
  }
}

console.log(`Deployment environment is valid (${required.length + 1} required variable names present; values hidden).`);
