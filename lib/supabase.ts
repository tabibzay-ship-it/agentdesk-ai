"use client";

import { createClient } from "@supabase/supabase-js";
import { isPublishableSupabaseKey } from "./client-security";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

// Fail the build before an accidentally configured service-role/secret key can
// become a working browser credential. Never include a key in this error.
if (!supabasePublishableKey || !isPublishableSupabaseKey(supabasePublishableKey)) {
  throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a publishable or anon key.");
}

export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey,
  {
    auth: {
      // The OAuth callback exchanges a one-time authorization code. PKCE keeps
      // the verifier in this browser instead of exposing a reusable secret.
      flowType: "pkce",
      // The dedicated callback page processes credentials exactly once and
      // before considering any existing session. Automatic URL detection would
      // race that explicit exchange and can consume the one-time code first.
      detectSessionInUrl: false,
    },
  }
);

// A full navigation discards private page state after logout in another tab or
// an expired/revoked session. It also avoids displaying stale account data.
if (typeof window !== "undefined") {
  let currentAccount: string | undefined;
  supabase.auth.onAuthStateChange((event, session) => {
    const protectedPage = /^\/(dashboard|business|agent|knowledge|conversations|leads|appointments|reports|settings|billing|widget|install|chat)(\/|$)/.test(window.location.pathname);
    const adminPage = /^\/admin(\/|$)/.test(window.location.pathname) && window.location.pathname !== "/admin/login";
    if (event === "SIGNED_OUT" && (protectedPage || adminPage)) {
      window.location.replace(adminPage ? "/admin/login" : "/login");
    }
    if (event === "SIGNED_IN" && (protectedPage || adminPage) && currentAccount &&
        session?.user.id !== currentAccount) {
      window.location.reload();
    }
    currentAccount = session?.user.id;
  });
}
