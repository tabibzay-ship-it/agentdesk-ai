
import type { ReactNode } from "react";

type AlertVariant = "info" | "success" | "warning" | "error";

type PremiumAlertProps = {
  title: string;
  children?: ReactNode;
  variant?: AlertVariant;
};

const variants: Record<AlertVariant, string> = {
  info: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  error: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300",
};

export default function PremiumAlert({
  title,
  children,
  variant = "info",
}: PremiumAlertProps) {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`rounded-xl border p-4 ${variants[variant]}`}
    >
      <p className="text-sm font-semibold">{title}</p>

      {children && (
        <div className="mt-1 text-sm leading-6">
          {children}
        </div>
      )}
    </div>
  );
}
