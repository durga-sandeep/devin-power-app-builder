import Link from "next/link";
import type { FlagState } from "@prisma/client";
import { getCurrentUser } from "@/lib/platform/auth";
import { DataTable, PageShell, StatusBadge } from "@/lib/platform/ui";
import { EDITORS, listFlags } from "./service";

export default async function FeatureFlagsPage() {
  const user = await getCurrentUser();
  const flags = user ? await listFlags() : [];
  const canCreate = !!user && EDITORS.includes(user.role);

  return (
    <PageShell
      app="feature-flags"
      title="Feature flags"
      actions={
        canCreate && (
          <Link href="/feature-flags/new" className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700">
            New flag
          </Link>
        )
      }
    >
      <DataTable
        rows={flags}
        rowKey={(f) => f.id}
        rowHref={(f) => `/feature-flags/${f.key}`}
        emptyText="No flags yet."
        columns={[
          {
            key: "key",
            header: "Key",
            render: (f) => (
              <span className="flex items-center gap-2">
                <span className={`font-mono ${f.archivedAt ? "text-gray-400 line-through" : ""}`}>{f.key}</span>
                {f.archivedAt && <StatusBadge value="ARCHIVED" />}
              </span>
            ),
          },
          { key: "description", header: "Description", className: "max-w-xs truncate", render: (f) => f.description },
          { key: "owner", header: "Owner", render: (f) => f.owner },
          { key: "staging", header: "Staging", render: (f) => <StateCell state={f.states.find((s) => s.environment === "staging")} /> },
          { key: "production", header: "Production", render: (f) => <StateCell state={f.states.find((s) => s.environment === "production")} /> },
          {
            key: "pending",
            header: "Approval",
            render: (f) => (f.states.some((s) => s.pendingApprovalId) ? <StatusBadge value="PENDING" /> : <span className="text-gray-400">—</span>),
          },
        ]}
      />
    </PageShell>
  );
}

function StateCell({ state }: { state?: FlagState }) {
  if (!state) return <span className="text-gray-400">—</span>;
  return (
    <span className="flex items-center gap-2 tabular-nums">
      <StatusBadge value={state.enabled ? "ON" : "OFF"} />
      <span className={state.enabled ? "text-gray-900" : "text-gray-400"}>{state.rolloutPercent}%</span>
    </span>
  );
}
