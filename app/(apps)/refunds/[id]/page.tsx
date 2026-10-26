import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/platform/auth";
import { PageShell, StatusBadge } from "@/lib/platform/ui";
import { formatDate, formatMoney } from "../format";
import { ADMIN_APPROVAL_THRESHOLD_CENTS, getRefund, permissions } from "../service";
import { RefundActions } from "./RefundActions";

export default async function RefundDetailPage(props: PageProps<"/refunds/[id]">) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  const detail = user ? await getRefund(id) : null;
  if (user && !detail) notFound();

  return (
    <PageShell app="refunds" title={`Refund ${id.slice(-6)}`}>
      {detail && user && (
        <div className="grid gap-6 lg:grid-cols-3">
          <section className="space-y-6 lg:col-span-2">
            <div className="rounded-md border border-gray-200 bg-white p-6">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-3xl font-semibold tabular-nums">{formatMoney(detail.refund.amountCents, detail.refund.currency)}</div>
                  <div className="mt-1 text-sm text-gray-500">
                    {detail.refund.status !== "PENDING"
                      ? `${detail.refund.status.toLowerCase()} · decided by ${detail.names.get(detail.refund.decidedBy ?? "") ?? "—"}`
                      : detail.refund.amountCents > ADMIN_APPROVAL_THRESHOLD_CENTS
                        ? "Over $5,000: admin approval required"
                        : "Checker or admin may approve"}
                  </div>
                </div>
                <StatusBadge value={detail.refund.status} />
              </div>
              <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Field label="Customer" value={detail.refund.customerRef} />
                <Field label="Order" value={detail.refund.orderRef} />
                <Field label="Created by" value={`${detail.names.get(detail.refund.createdBy) ?? detail.refund.createdBy} · ${formatDate(detail.refund.createdAt)}`} />
                <Field label="Decided by" value={detail.refund.decidedBy ? `${detail.names.get(detail.refund.decidedBy) ?? detail.refund.decidedBy} · ${formatDate(detail.refund.decidedAt)}` : "—"} />
                <Field label="Reason" value={detail.refund.reason} wide />
                <Field label="Decision note" value={detail.refund.decisionNote ?? "—"} wide />
                <Field label="Idempotency key" value={detail.refund.idempotencyKey ?? "—"} mono />
                <Field label="Provider ref" value={detail.refund.externalRef ?? "—"} mono />
              </dl>
            </div>

            <RefundActions
              refundId={detail.refund.id}
              role={user.role}
              status={detail.refund.status}
              isCreator={detail.refund.createdBy === user.id}
              {...permissions(user, detail.refund)}
              idempotencyKey={detail.refund.idempotencyKey ?? crypto.randomUUID()}
            />
          </section>

          <aside className="rounded-md border border-gray-200 bg-white p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Timeline (audit log)</h2>
            <ol className="mt-4 space-y-4 border-l border-gray-200 pl-4 text-sm">
              {detail.trail.map((e) => (
                <li key={e.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-gray-400" />
                  <div className="font-medium">{e.action.replace("REFUND_", "").replaceAll("_", " ").toLowerCase()}</div>
                  <div className="text-xs text-gray-500">
                    {detail.names.get(e.actor) ?? e.actor} · {formatDate(e.at)}
                  </div>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      )}
    </PageShell>
  );
}

function Field({ label, value, wide, mono }: { label: string; value: string; wide?: boolean; mono?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className={`mt-0.5 whitespace-pre-line ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  );
}
