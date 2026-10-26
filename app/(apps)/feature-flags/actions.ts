"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { toActionResult } from "@/lib/platform/actions";
import type { ActionResult } from "@/lib/platform/ui/ActionForm";
import { parseStateChange } from "./format";
import { archiveFlag, changeStaging, createFlag, decideProductionChange, killSwitch, proposeProductionChange } from "./service";

function revalidate(key?: string) {
  revalidatePath("/feature-flags");
  if (key) revalidatePath(`/feature-flags/${key}`);
}

export async function createFlagAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let key: string | undefined;
  const result = await toActionResult(async () => {
    const flag = await createFlag({
      key: String(formData.get("key") ?? ""),
      description: String(formData.get("description") ?? ""),
      owner: String(formData.get("owner") ?? ""),
    });
    key = flag.key;
  });
  if (!result.ok) return result;
  revalidate();
  redirect(`/feature-flags/${key}`);
}

/** Staging applies immediately; production files a proposal for a checker/admin. */
export async function changeStateAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const key = String(formData.get("key") ?? "");
  const environment = String(formData.get("environment") ?? "");
  const result = await toActionResult(async () => {
    const change = parseStateChange(formData.get("enabled"), formData.get("rolloutPercent"));
    if (environment === "staging") {
      await changeStaging(key, change);
      return "Staging updated.";
    }
    if (environment === "production") {
      await proposeProductionChange(key, change);
      return "Production change proposed; a checker or admin must approve it.";
    }
    throw new Error("Unknown environment");
  });
  revalidate(key);
  return result;
}

export async function decideProductionChangeAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const key = String(formData.get("key") ?? "");
  const approvalId = String(formData.get("approvalId") ?? "");
  const decision = formData.get("decision") === "REJECTED" ? "REJECTED" : "APPROVED";
  const note = String(formData.get("note") ?? "");
  const result = await toActionResult(async () => {
    await decideProductionChange(approvalId, decision, note);
    return decision === "APPROVED" ? "Approved and applied to production." : "Rejected.";
  });
  revalidate(key);
  return result;
}

export async function killSwitchAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const key = String(formData.get("key") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const result = await toActionResult(async () => {
    const state = await killSwitch(key, reason);
    return state ? "Production disabled (EMERGENCY_DISABLE recorded)." : "Flag is archived; nothing to disable.";
  });
  revalidate(key);
  return result;
}

export async function archiveFlagAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const key = String(formData.get("key") ?? "");
  const result = await toActionResult(async () => {
    await archiveFlag(key);
    return "Flag archived.";
  });
  revalidate(key);
  return result;
}
