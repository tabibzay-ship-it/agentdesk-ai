
"use client";

import { useId } from "react";

type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
};

export default function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  label = "Search",
  disabled = false,
}: SearchInputProps) {
  const id = useId();

  return (
    <div className="relative w-full">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>

      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--premium-text-muted)]"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </svg>

      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="min-h-11 w-full rounded-xl border border-[var(--premium-border)] bg-[var(--premium-surface)] py-2 pe-4 ps-10 text-sm text-[var(--premium-text)] outline-none placeholder:text-[var(--premium-text-muted)] focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:opacity-50"
      />
    </div>
  );
}
