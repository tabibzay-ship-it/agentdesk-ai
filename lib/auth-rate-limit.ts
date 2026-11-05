const AUTH_RETRY_UNTIL_KEY = "agentdesk-auth-retry-until";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(3600, Math.max(1, Math.ceil(seconds)));
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= now) return null;
  return Math.min(3600, Math.max(1, Math.ceil((timestamp - now) / 1000)));
}

export function rememberAuthRetryAfter(seconds: number, now = Date.now()): void {
  const safeSeconds = Math.min(3600, Math.max(1, Math.ceil(seconds)));
  try {
    storage()?.setItem(AUTH_RETRY_UNTIL_KEY, String(now + safeSeconds * 1000));
  } catch {
    // Supabase remains the security boundary when browser storage is unavailable.
  }
}

export function authRetrySeconds(fallback = 60, now = Date.now()): number {
  try {
    const remaining = Math.ceil((Number(storage()?.getItem(AUTH_RETRY_UNTIL_KEY) || 0) - now) / 1000);
    return remaining > 0 ? Math.min(3600, remaining) : fallback;
  } catch {
    return fallback;
  }
}

export async function supabaseFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (response.status === 429 && url.includes("/auth/v1/")) {
    const seconds = parseRetryAfter(response.headers.get("retry-after"));
    if (seconds) rememberAuthRetryAfter(seconds);
  }
  return response;
}

// All browser Supabase Auth requests use this wrapper through lib/supabase.ts.
