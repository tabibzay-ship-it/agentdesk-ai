
interface PremiumSkeletonProps {
  lines?: number;
  className?: string;
}

export default function PremiumSkeleton({
  lines = 3,
  className = "",
}: PremiumSkeletonProps) {
  const safeLines = Math.max(
    1,
    Math.min(10, Math.floor(lines))
  );

  return (
    <div
      role="status"
      aria-label="Loading content"
      className={`animate-pulse space-y-3 ${className}`}
    >
      {Array.from({ length: safeLines }).map((_, index) => (
        <div
          key={index}
          className="h-4 rounded-lg bg-[var(--premium-surface-muted)]"
          style={{
            width:
              index === safeLines - 1
                ? "65%"
                : "100%",
          }}
        />
      ))}
      <span className="sr-only">Loading...</span>
    </div>
  );
}
