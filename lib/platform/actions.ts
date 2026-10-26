import type { ActionResult } from "./ui/ActionForm";
import { ForbiddenError } from "./auth";

/** Turns thrown errors into an ActionResult so forms can show them. ForbiddenError keeps its status. */
export async function toActionResult(fn: () => Promise<string | void>): Promise<ActionResult> {
  try {
    const message = await fn();
    return { ok: true, message: message ?? undefined };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: e.message, status: e.status };
    if (e instanceof Error) return { ok: false, error: e.message };
    return { ok: false, error: String(e) };
  }
}
