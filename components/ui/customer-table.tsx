
import type { DemoCustomer } from "@/app/premium-demo/demo-data";

type CustomerTableProps = {
  customers: DemoCustomer[];
  onDelete: (customer: DemoCustomer) => void;
};

export default function CustomerTable({
  customers,
  onDelete,
}: CustomerTableProps) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--premium-border)] bg-[var(--premium-surface)]">
      <table className="w-full min-w-[580px] text-start text-sm">
        <thead className="bg-[var(--premium-surface-muted)]">
          <tr>
            <th className="px-5 py-4 text-start font-semibold">Customer</th>
            <th className="px-5 py-4 text-start font-semibold">Email</th>
            <th className="px-5 py-4 text-start font-semibold">Status</th>
            <th className="px-5 py-4 text-end font-semibold">Action</th>
          </tr>
        </thead>

        <tbody>
          {customers.map((customer) => (
            <tr
              key={customer.id}
              className="border-t border-[var(--premium-border)]"
            >
              <td className="px-5 py-4 font-semibold">
                {customer.name}
              </td>

              <td className="px-5 py-4 text-[var(--premium-text-muted)]">
                {customer.email}
              </td>

              <td className="px-5 py-4">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    customer.status === "Active"
                      ? "bg-emerald-500/10 text-emerald-500"
                      : customer.status === "Pending"
                        ? "bg-amber-500/10 text-amber-500"
                        : "bg-slate-500/10 text-slate-400"
                  }`}
                >
                  {customer.status}
                </span>
              </td>

              <td className="px-5 py-4 text-end">
                <button
                  type="button"
                  onClick={() => onDelete(customer)}
                  className="rounded-lg px-3 py-2 font-semibold text-red-500 hover:bg-red-500/10"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}

          {customers.length === 0 && (
            <tr>
              <td
                colSpan={4}
                className="px-5 py-12 text-center text-[var(--premium-text-muted)]"
              >
                No customers found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
