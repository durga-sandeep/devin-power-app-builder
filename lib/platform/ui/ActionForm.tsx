"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string; status?: number };

type FormAction = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

/**
 * <form> around a server action that returns ActionResult, showing the returned error (e.g. a 403
 * from requireRole) inline instead of crashing the page. Children are the fields + submit button.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state && !state.ok && (
        <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.status ? `${state.status}: ` : ""}
          {state.error}
        </p>
      )}
      {state && state.ok && state.message && (
        <p role="status" className="mt-2 text-sm text-green-700">
          {state.message}
        </p>
      )}
    </form>
  );
}
