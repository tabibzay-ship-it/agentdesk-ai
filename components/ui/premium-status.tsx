
type Status =
  | "active"
  | "inactive"
  | "pending"
  | "success"
  | "error";

interface PremiumStatusProps {
  status: Status;
  label?: string;
}

const styles: Record<Status, string> = {
  active:
    "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  inactive:
    "bg-slate-500/10 text-slate-500",
  pending:
    "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  success:
    "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  error:
    "bg-red-500/10 text-red-600 dark:text-red-400",
};

export default function PremiumStatus({
  status,
  label,
}: PremiumStatusProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold",
        styles[status],
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-current"
      />
      {label || status}
    </span>
  );
}
