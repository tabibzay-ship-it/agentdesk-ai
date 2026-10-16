
type ProgressBarProps = {
  value: number;
  max?: number;
  label: string;
  showPercentage?: boolean;
};

export default function ProgressBar({
  value,
  max = 100,
  label,
  showPercentage = true,
}: ProgressBarProps) {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const safeValue = Number.isFinite(value)
    ? Math.max(0, Math.min(value, safeMax))
    : 0;

  const percentage = Math.round((safeValue / safeMax) * 100);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-[var(--premium-text)]">
          {label}
        </span>

        {showPercentage && (
          <span className="text-xs font-semibold text-[var(--premium-text-muted)]">
            {percentage}%
          </span>
        )}
      </div>

      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-valuenow={safeValue}
        className="h-2.5 overflow-hidden rounded-full bg-[var(--premium-surface-muted)]"
      >
        <div
          className="h-full rounded-full bg-blue-600 transition-[width] duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
