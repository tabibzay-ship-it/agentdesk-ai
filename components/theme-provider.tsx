"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "agentdesk-theme";

type ThemeContextValue = {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function savedTheme(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" || value === "system" ? value : "system";
  } catch {
    return "system";
  }
}

function resolveTheme(theme: ThemePreference, prefersDark: boolean): ResolvedTheme {
  return theme === "system" ? (prefersDark ? "dark" : "light") : theme;
}

function applyTheme(theme: ThemePreference, prefersDark: boolean) {
  const resolved = resolveTheme(theme, prefersDark);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  return resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  const syncTheme = useCallback((preference = savedTheme()) => {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setThemeState(preference);
    setResolvedTheme(applyTheme(preference, prefersDark));
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      const preference = savedTheme();
      if (preference === "system") syncTheme(preference);
    };
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === THEME_STORAGE_KEY) syncTheme();
    };

    const initialSync = window.setTimeout(syncTheme, 0);
    media.addEventListener("change", onSystemChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearTimeout(initialSync);
      media.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [syncTheme]);

  const setTheme = useCallback((preference: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // The selected theme still applies for the current page.
    }
    setThemeState(preference);
    setResolvedTheme(applyTheme(preference, window.matchMedia("(prefers-color-scheme: dark)").matches));
  }, []);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
