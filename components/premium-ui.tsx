
import type {
  HTMLAttributes,
  ReactNode,
} from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
};

export function PremiumCard({
  children,
  className = "",
  ...props
}: CardProps) {
  return (
    <div
      className={`premium-card p-5 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

type HeadingProps = {
  title: string;
  description?: string;
  action?: ReactNode;
};

export function PremiumHeading({
  title,
  description,
  action,
}: HeadingProps) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--premium-text)]">
          {title}
        </h1>

        {description && (
          <p className="premium-muted mt-2 text-sm">
            {description}
          </p>
        )}
      </div>

      {action && <div>{action}</div>}
    </div>
  );
}

type StatProps = {
  title: string;
  value: string | number;
  description?: string;
  icon?: ReactNode;
};

export function PremiumStat({
  title,
  value,
  description,
  icon,
}: StatProps) {
  return (
    <PremiumCard>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="premium-muted text-sm font-medium">
            {title}
          </p>

          <p className="mt-3 text-3xl font-bold tracking-tight">
            {value}
          </p>

          {description && (
            <p className="premium-muted mt-2 text-xs">
              {description}
            </p>
          )}
        </div>

        {icon && (
          <div className="rounded-xl bg-[var(--premium-surface-muted)] p-3">
            {icon}
          </div>
        )}
      </div>
    </PremiumCard>
  );
}

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export function PremiumEmptyState({
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="premium-card flex flex-col items-center justify-center px-6 py-12 text-center">
      <h3 className="text-lg font-semibold">
        {title}
      </h3>

      <p className="premium-muted mt-2 max-w-md text-sm">
        {description}
      </p>

      {action && (
        <div className="mt-5">
          {action}
        </div>
      )}
    </div>
  );
}

export function PremiumLoading({
  label = "Loading...",
}: {
  label?: string;
}) {
  return (
    <div
      role="status"
      className="flex min-h-40 items-center justify-center gap-3 text-[var(--premium-text-muted)]"
    >
      <span
        aria-hidden="true"
        className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
      />
      <span>{label}</span>
    </div>
  );
}
