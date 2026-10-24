
"use client";

import { type ThemePreference, useTheme } from "@/components/theme-provider";

const options: {
  value: ThemePreference;
  label: string;
}[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export default function ThemeSwitcher({ labels, compact = false }: { labels?: Partial<Record<ThemePreference, string>>; compact?: boolean } = {}) {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = theme === option.value;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setTheme(option.value)}
            aria-pressed={selected}
            aria-label={`Use ${labels?.[option.value] ?? option.label} theme`}
            className={[
              `min-h-11 rounded-xl border ${compact ? "px-3 py-2 text-xs" : "px-4 py-2 text-sm"} font-medium transition`,
              selected
                ? "border-blue-500 bg-blue-600 text-white"
                : "border-[var(--premium-border)] bg-[var(--premium-surface)] text-[var(--premium-text)] hover:opacity-80",
            ].join(" ")}
          >
            {labels?.[option.value] ?? option.label}
          </button>
        );
      })}
    </div>
  );
}
