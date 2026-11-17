export const RECOVERY_EMAIL_KEY = "agentdesk-recovery-email";
export const RECOVERY_COOLDOWN_KEY = "agentdesk-password-recovery-cooldown";
export const RECOVERY_SESSION_KEY = "agentdesk-password-recovery-session";

export function recoveryCooldownSeconds(now = Date.now()): number {
  if (typeof window === "undefined") return 0;
  try {
    return Math.max(0, Math.ceil((Number(localStorage.getItem(RECOVERY_COOLDOWN_KEY) || 0) - now) / 1000));
  } catch {
    return 0;
  }
}

export function startRecoveryCooldown(durationMs = 60_000): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(RECOVERY_COOLDOWN_KEY, String(Date.now() + durationMs));
  } catch {
    // Supabase Auth still enforces its server-side email and verification limits.
  }
}

export function hasRecoveryAuthorization(claims: unknown): boolean {
  if (!claims || typeof claims !== "object") return false;
  const record = claims as { amr?: unknown; email?: unknown };
  if (typeof record.email !== "string" || !record.email.trim()) return false;
  return Array.isArray(record.amr) && record.amr.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const method = (entry as { method?: unknown }).method;
    return method === "recovery" || method === "otp";
  });
}
