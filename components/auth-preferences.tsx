"use client";

import ThemeSwitcher from "@/components/theme-switcher";
import { AuthLocale, authCopy } from "@/lib/auth-i18n";

export function useAuthLocale() {
  const locale: AuthLocale = "en";
  return { locale, setLocale: () => {}, t: authCopy.en, rtl: false };
}

export function AuthPreferences(props: { locale: AuthLocale; onLocaleChange: (value: AuthLocale) => void }) {
  void props;
  const t = authCopy.en;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2" aria-label="Theme">
      <ThemeSwitcher labels={{ light: t.light, dark: t.dark, system: t.system }} compact />
    </div>
  );
}
