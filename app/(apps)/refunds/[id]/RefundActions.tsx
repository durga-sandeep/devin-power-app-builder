"use client";

import { ActionForm } from "@/lib/platform/ui/ActionForm";
import { FormField } from "@/lib/platform/ui/FormField";
import { decideRefundAction, executeRefundAction } from "../actions";

const btn = "rounded-md px-4 py-1.5 text-sm font-medium";

/**
 * Action buttons for the current role. Visibility here is cosmetic; every action re-checks the
 * role server-side and the error, if any, is shown inline.
 */
export function RefundActions({
  refundId,
  role,
  status,
  isCreator,
  canDecide,
  canExecute,
  idempotencyKey,
}: {
  refundId: string;
  role: string;
  status: string;
  isCreator: boolean;
  canDecide: boolean;
  canExecute: boolean;
  idempotencyKey: string;
}) {
  if (status === "PENDING" && canDecide) {
    return (
      <div className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Decision</h2>
        <ActionForm action={decideRefundAction} className="mt-4 space-y-3">
          <input type="hidden" name="id" value={refundId} />
          <FormField label="Decision note" name="note" type="textarea" rows={2} placeholder="Optional for approve, recommended for reject" />
          <div className="flex gap-3">
            <button type="submit" name="decision" value="APPROVED" className={`${btn} bg-green-700 text-white hover:bg-green-600`}>
              Approve
            </button>
            <button type="submit" name="decision" value="REJECTED" className={`${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>
              Reject
            </button>
          </div>
        </ActionForm>
      </div>
    );
  }
  if (status === "APPROVED" && canExecute) {
    return (
      <div className="rounded-md border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Execute</h2>
        <p className="mt-1 text-sm text-gray-600">Sends the refund to the payment provider. Safe to retry: this form reuses one idempotency key.</p>
        <ActionForm action={executeRefundAction} className="mt-4">
          <input type="hidden" name="id" value={refundId} />
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
          <button type="submit" className={`${btn} bg-gray-900 text-white hover:bg-gray-700`}>
            Execute refund
          </button>
        </ActionForm>
      </div>
    );
  }
  const why =
    status === "PENDING" && isCreator
      ? "You created this request, so someone else must approve it (maker-checker)."
      : status === "PENDING"
        ? `Awaiting a decision. Your role (${role}) cannot approve this refund.`
        : status === "APPROVED"
          ? `Approved. Your role (${role}) cannot execute refunds.`
          : `This refund is ${status.toLowerCase()}; no further actions.`;
  return <p className="rounded-md border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600">{why}</p>;
}
