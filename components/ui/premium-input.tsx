
import type {
  InputHTMLAttributes,
} from "react";

interface PremiumInputProps
  extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export default function PremiumInput({
  label,
  error,
  hint,
  id,
  className = "",
  ...props
}: PremiumInputProps) {
  const inputId =
    id || label.toLowerCase().replace(/\s+/g, "-");

  return (
    <div className="w-full space-y-2">
      <label
        htmlFor={inputId}
        className="block text-sm font-medium text-[var(--premium-text)]"
      >
        {label}
      </label>

      <input
        {...props}
        id={inputId}
        aria-invalid={Boolean(error)}
        className={[
          "w-full rounded-xl border px-4 py-3 text-sm outline-none transition",
          "bg-[var(--premium-surface)] text-[var(--premium-text)]",
          "placeholder:text-[var(--premium-text-muted)]",
          "focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20",
          error
            ? "border-red-500"
            : "border-[var(--premium-border)]",
          className,
        ].join(" ")}
      />

      {error ? (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-[var(--premium-text-muted)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
