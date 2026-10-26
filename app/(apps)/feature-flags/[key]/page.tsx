import { notFound } from "next/navigation";
import type { ApprovalRequest, AuditEvent, FlagState } from "@prisma/client";
import { getCurrentUser, type CurrentUser } from "@/lib/platform/auth";
import { DataTable, PageShell, StatusBadge } from "@/lib/platform/ui";
import { describeState, formatDate } from "../format";
import { getFlag, permissions, stateOf, type Environment, type FlagDetail, type ProdChangePayload } from "../service";
import { ArchiveButton, DecisionForm, KillSwitch, StateForm } from "./FlagControls";

export default async function FlagDetailPage(props: PageProps<"/feature-flags/[key]">) {
  const { key } = await props.params;
  const user = await getCurrentUser();
  const detail = user ? await getFlag(key) : null;
  if (user && !detail) notFound();
  const can = detail && user ? permissions(user, detail.flag) : null;

  return (
    <PageShell
      app="feature-flags"
      title={key}
      actions={
        can && (
          <>
            {can.canKill && <KillSwitch flagKey={key} />}
            {can.canArchive && <ArchiveButton flagKey={key} />}
          </>
        )
      }
    >
      {detail && user && can && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600">
            <span>{detail.flag.description}</span>
            <span>Owner: {detail.flag.owner}</span>
            <span>Created {formatDate(detail.flag.createdAt)} by {detail.names.get(detail.flag.createdBy) ?? detail.flag.createdBy}</span>
            {detail.flag.archivedAt && (
              <span className="flex items-center gap-2">
                <StatusBadge value="ARCHIVED" /> {formatDate(detail.flag.archivedAt)} by {detail.names.get(detail.flag.archivedBy ?? "") ?? "—"} · read-only
              </span>
            )}
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {(["staging", "production"] as Environment[]).map((env) => (
              <EnvCard
                key={env}
                env={env}
                state={stateOf(detail.flag, env)}
                detail={detail}
                user={user}
                canEdit={env === "staging" ? can.canChangeStaging : can.canProposeProduction}
              />
            ))}
          </div>

          <section className="rounded-md border border-gray-200 bg-white p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Pending approvals</h2>
            {detail.pending.length === 0 && <p className="mt-2 text-sm text-gray-500">None.</p>}
            {detail.pending.map((a) => (
              <PendingApproval key={a.id} approval={a} detail={detail} user={user} canDecide={can.canDecide} />
            ))}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Change history (audit log)</h2>
            <HistoryTable detail={detail} />
          </section>
        </div>
      )}
    </PageShell>
  );
}

function EnvCard({ env, state, detail, user, canEdit }: { env: Environment; state: FlagState; detail: FlagDetail; user: CurrentUser; canEdit: boolean }) {
  const archived = !!detail.flag.archivedAt;
  const why = archived
    ? "Archived flags are read-only."
    : env === "production" && state.pendingApprovalId
      ? "A production change is awaiting approval; new proposals are refused until it is decided."
      : `Your role (${user.role}) cannot change ${env}.`;
  return (
    <section className={`rounded-md border bg-white p-6 ${env === "production" ? "border-indigo-200" : "border-gray-200"}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{env}</h2>
        {env === "production" && state.pendingApprovalId && <StatusBadge value="PENDING" />}
      </div>
      <div className="mt-3 flex items-baseline gap-3">
        <StatusBadge value={state.enabled ? "ON" : "OFF"} />
        <span className="text-3xl font-semibold tabular-nums">{state.rolloutPercent}%</span>
        <span className="text-sm text-gray-500">rollout</span>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Updated {formatDate(state.updatedAt)} by {detail.names.get(state.updatedBy) ?? state.updatedBy}
      </p>
      {canEdit ? (
        <StateForm flagKey={detail.flag.key} environment={env} enabled={state.enabled} rolloutPercent={state.rolloutPercent} />
      ) : (
        <p className="mt-4 rounded-md border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600">{why}</p>
      )}
    </section>
  );
}

function PendingApproval({ approval, detail, user, canDecide }: { approval: ApprovalRequest; detail: FlagDetail; user: CurrentUser; canDecide: boolean }) {
  const payload = approval.payload as ProdChangePayload;
  const own = approval.requestedBy === user.id;
  return (
    <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-4">
      <div className="text-sm">
        <span className="font-medium">Production:</span> {describeState(payload.from)} → <span className="font-medium">{describeState(payload.to)}</span>
      </div>
      <div className="text-xs text-gray-600">
        Proposed by {detail.names.get(approval.requestedBy) ?? approval.requestedBy} · {formatDate(approval.requestedAt)}
      </div>
      {canDecide && !own ? (
        <DecisionForm flagKey={detail.flag.key} approvalId={approval.id} />
      ) : (
        <p className="mt-2 text-sm text-gray-600">
          {own ? "You proposed this change, so someone else must decide it (maker-checker)." : `Your role (${user.role}) cannot approve production changes.`}
        </p>
      )}
    </div>
  );
}

function HistoryTable({ detail }: { detail: FlagDetail }) {
  const envOf = new Map(detail.flag.states.map((s) => [s.id, s.environment]));
  const approvalEnv = new Map(detail.approvals.map((a) => [a.id, envOf.get(a.entityId) ?? ""]));
  const approvals = new Map(detail.approvals.map((a) => [a.id, a]));
  return (
    <DataTable
      rows={detail.history}
      rowKey={(e) => e.id}
      emptyText="No history."
      columns={[
        { key: "at", header: "When", className: "whitespace-nowrap", render: (e) => formatDate(e.at) },
        { key: "actor", header: "Who", render: (e) => detail.names.get(e.actor) ?? e.actor },
        {
          key: "action",
          header: "Action",
          render: (e) => <span className={`font-mono text-xs ${e.action.startsWith("EMERGENCY_") ? "font-semibold text-red-700" : ""}`}>{e.action}</span>,
        },
        { key: "env", header: "Env", render: (e) => (e.entity === "FlagState" ? envOf.get(e.entityId) : e.entity === "ApprovalRequest" ? approvalEnv.get(e.entityId) : "—") },
        { key: "change", header: "Change", render: (e) => summarize(e, approvals) },
      ]}
    />
  );
}

type Snapshot = Record<string, unknown> | null;

function summarize(e: AuditEvent, approvals: Map<string, ApprovalRequest>) {
  const before = e.before as Snapshot;
  const after = e.after as Snapshot;
  if (e.entity === "FlagState" && before && after) {
    const s = (x: Record<string, unknown>) => describeState({ enabled: Boolean(x.enabled), rolloutPercent: Number(x.rolloutPercent) });
    return (
      <span>
        {s(before)} → {s(after)}
        {typeof after.reason === "string" && <span className="block text-xs text-red-700">Reason: {after.reason}</span>}
      </span>
    );
  }
  if (e.entity === "ApprovalRequest") {
    const payload = (approvals.get(e.entityId)?.payload ?? null) as ProdChangePayload | null;
    const note = after && typeof after.note === "string" ? after.note : null;
    return (
      <span>
        {payload ? `${describeState(payload.from)} → ${describeState(payload.to)}` : ""}
        {note && <span className="block text-xs text-gray-500">Note: {note}</span>}
      </span>
    );
  }
  if (e.action === "FLAG_CREATED") return "Created (both environments OFF 0%)";
  if (e.action === "FLAG_ARCHIVED") return "Archived (read-only)";
  return "";
}
