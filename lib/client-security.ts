// These checks improve form feedback. Database grants, RLS and constraints are
// the security boundary; a browser can always bypass client validation.
export function isPublishableSupabaseKey(value: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  const pieces = value.split(".");
  if (pieces.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(pieces[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role === "anon";
  } catch {
    return false;
  }
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isBoundedText(value: string, maxLength: number): boolean {
  return value.length <= maxLength && !value.includes("\0");
}

export function isHttpWebsite(value: string): boolean {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username && !url.password && value.length <= 2048;
  } catch {
    return false;
  }
}

export function isStrongPassword(value: string): boolean {
  return value.length >= 12 && value.length <= 1024 &&
    /[A-Za-z]/.test(value) && /\d/.test(value) &&
    !value.includes("\0");
}

export function safeAuthDestination(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  try {
    const url = new URL(value, "https://agentdesk.invalid");
    if (url.origin !== "https://agentdesk.invalid") return "/dashboard";
    if (/^\/(login|register|forgot-password|verify-reset-code|reset-password)(\/|$)/.test(url.pathname)) {
      return "/dashboard";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/dashboard";
  }
}
