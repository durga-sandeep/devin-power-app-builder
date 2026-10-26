import Link from "next/link";
import { getCurrentUser } from "@/lib/platform/auth";
import { DataTable, PageShell, StatusBadge } from "@/lib/platform/ui";
import { formatDate, formatMoney } from "./format";
import { listRefunds, STATUSES } from "./service";

export default async function RefundsPage(props: PageProps<"/refunds">) {
  const { status } = await props.searchParams;
  const current = typeof status === "string" ? status : undefined;
  const user = await getCurrentUser();
  const refunds = user ? await listRefunds(current) : [];
  const canCreate = user?.role === "maker" || user?.role === "admin";

  return (
    <PageShell
      app="refunds"
      title="Refunds"
      actions={
        canCreate && (
          <Link href="/refunds/new" className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700">
            New refund
          </Link>
        )
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-500">Status:</span>
        <FilterChip href="/refunds" active={!current} label="All" />
        {STATUSES.map((s) => (
          <FilterChip key={s} href={`/refunds?status=${s}`} active={current === s} label={s} />
        ))}
      </div>
      <DataTable
        rows={refunds}
        rowKey={(r) => r.id}
        rowHref={(r) => `/refunds/${r.id}`}
        emptyText="No refunds match this filter."
        columns={[
          { key: "created", header: "Created", render: (r) => formatDate(r.createdAt) },
          { key: "customer", header: "Customer", render: (r) => r.customerRef },
          { key: "order", header: "Order", render: (r) => r.orderRef },
          { key: "amount", header: "Amount", className: "text-right tabular-nums", render: (r) => formatMoney(r.amountCents, r.currency) },
          { key: "reason", header: "Reason", className: "max-w-xs truncate", render: (r) => r.reason },
          { key: "status", header: "Status", render: (r) => <StatusBadge value={r.status} /> },
        ]}
      />
    </PageShell>
  );
}

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-0.5 ${active ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"}`}
    >
      {label}
    </Link>
  );
}
