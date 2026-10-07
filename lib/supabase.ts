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
  supabasePublishableKey
);

// A full navigation discards private page state after logout in another tab or
// an expired/revoked session. It also avoids displaying stale account data.
if (typeof window !== "undefined") {
  let currentAccount: string | undefined;
  supabase.auth.onAuthStateChange((event, session) => {
    const protectedPage = /^\/(dashboard|business|agent|knowledge|conversations|settings|widget|install|chat)(\/|$)/.test(window.location.pathname);
    if (event === "SIGNED_OUT" && protectedPage) {
      window.location.replace("/login");
    }
    if (event === "SIGNED_IN" && protectedPage && currentAccount &&
        session?.user.id !== currentAccount) {
      window.location.reload();
    }
    currentAccount = session?.user.id;
  });
}
