export const SIGNUP_EMAIL_KEY = "agentdesk-signup-email";
export const SIGNUP_COOLDOWN_KEY = "agentdesk-signup-cooldown";
export const SIGNUP_ATTEMPTS_KEY = "agentdesk-signup-verification-attempts";
export const SIGNUP_MAX_ATTEMPTS = 5;

export function signupCooldownSeconds(now = Date.now()): number {
  if (typeof window === "undefined") return 0;
  try {
    return Math.max(0, Math.ceil((Number(localStorage.getItem(SIGNUP_COOLDOWN_KEY) || 0) - now) / 1000));
  } catch {
    return 0;
  }
}
export function startSignupCooldown(durationMs = 60_000): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SIGNUP_COOLDOWN_KEY, String(Date.now() + Math.max(1000, durationMs)));
  } catch {
    // Supabase still enforces its server-side signup and verification limits.
  }
}

export function rememberSignupEmail(email: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SIGNUP_EMAIL_KEY, email);
    sessionStorage.setItem(SIGNUP_ATTEMPTS_KEY, "0");
  } catch {
    // The verification page will safely return to registration if storage is unavailable.
  }
}

export function signupVerificationAttempts(): number {
  if (typeof window === "undefined") return 0;
  try {
    return Math.max(0, Number(sessionStorage.getItem(SIGNUP_ATTEMPTS_KEY) || 0));
  } catch {
    return 0;
  }
}

export function recordSignupVerificationFailure(): number {
  const attempts = Math.min(SIGNUP_MAX_ATTEMPTS, signupVerificationAttempts() + 1);
  try {
    sessionStorage.setItem(SIGNUP_ATTEMPTS_KEY, String(attempts));
  } catch {
    // Supabase also applies a server-side verification limit.
  }
  return attempts;
}

export function resetSignupVerificationAttempts(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SIGNUP_ATTEMPTS_KEY, "0");
  } catch {
    // Supabase still applies a server-side verification limit.
  }
}

export function clearSignupVerification(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SIGNUP_EMAIL_KEY);
    sessionStorage.removeItem(SIGNUP_ATTEMPTS_KEY);
  } catch {
    // The authenticated session is authoritative even if cleanup is unavailable.
  }
}

// Verification state is intentionally scoped to the current browser session.
