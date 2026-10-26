"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toActionResult } from "@/lib/platform/actions";
import type { ActionResult } from "@/lib/platform/ui/ActionForm";
import { parseAmountToCents } from "./format";
import { createRefund, decideRefund, executeRefund } from "./service";

export async function createRefundAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let id: string | undefined;
  const result = await toActionResult(async () => {
    const refund = await createRefund({
      customerRef: String(formData.get("customerRef") ?? ""),
      orderRef: String(formData.get("orderRef") ?? ""),
      amountCents: parseAmountToCents(String(formData.get("amount") ?? "")),
      currency: String(formData.get("currency") ?? "USD"),
      reason: String(formData.get("reason") ?? ""),
    });
    id = refund.id;
  });
  if (!result.ok) return result;
  revalidatePath("/refunds");
  redirect(`/refunds/${id}`);
}

export async function decideRefundAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const decision = formData.get("decision") === "REJECTED" ? "REJECTED" : "APPROVED";
  const note = String(formData.get("note") ?? "");
  const result = await toActionResult(async () => {
    await decideRefund(id, decision, note);
    return `Refund ${decision.toLowerCase()}.`;
  });
  revalidatePath(`/refunds/${id}`);
  revalidatePath("/refunds");
  return result;
}

export async function executeRefundAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id") ?? "");
  const idempotencyKey = String(formData.get("idempotencyKey") ?? "");
  const result = await toActionResult(async () => {
    const refund = await executeRefund(id, idempotencyKey);
    return refund.status === "EXECUTED" ? `Executed. Provider ref ${refund.externalRef}.` : `Execution ${refund.status}.`;
  });
  revalidatePath(`/refunds/${id}`);
  revalidatePath("/refunds");
  return result;
}
