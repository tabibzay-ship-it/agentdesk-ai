
import type { ReactNode } from "react";

type MetricCardProps = {
  title: string;
  value: string | number;
  description?: string;
  icon?: ReactNode;
};

export default function MetricCard({
  title,
  value,
  description,
  icon,
}: MetricCardProps) {
  return (
    <section className="rounded-2xl border border-[var(--premium-border)] bg-[var(--premium-surface)] p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm font-medium text-[var(--premium-text-muted)]">
          {title}
        </p>

        {icon && (
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-500/10 text-blue-500">
            {icon}
          </span>
        )}
      </div>

      <p className="mt-5 text-3xl font-bold tracking-tight text-[var(--premium-text)]">
        {value}
      </p>

      {description && (
        <p className="mt-2 text-xs text-[var(--premium-text-muted)]">
          {description}
        </p>
      )}
    </section>
  );
}
