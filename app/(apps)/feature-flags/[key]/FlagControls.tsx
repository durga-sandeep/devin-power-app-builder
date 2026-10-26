"use client";

import { useRef } from "react";
import { ActionForm } from "@/lib/platform/ui/ActionForm";
import { FormField } from "@/lib/platform/ui/FormField";
import { archiveFlagAction, changeStateAction, decideProductionChangeAction, killSwitchAction } from "../actions";

const btn = "rounded-md px-4 py-1.5 text-sm font-medium";

/** Visibility here is cosmetic; every action re-checks the role server-side and shows any error inline. */
export function StateForm({
  flagKey,
  environment,
  enabled,
  rolloutPercent,
}: {
  flagKey: string;
  environment: "staging" | "production";
  enabled: boolean;
  rolloutPercent: number;
}) {
  const prod = environment === "production";
  return (
    <ActionForm action={changeStateAction} className="mt-4 space-y-3 border-t border-gray-100 pt-4">
      <input type="hidden" name="key" value={flagKey} />
      <input type="hidden" name="environment" value={environment} />
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label="Enabled"
          name="enabled"
          type="select"
          defaultValue={String(enabled)}
          options={[
            { value: "true", label: "On" },
            { value: "false", label: "Off" },
          ]}
        />
        <FormField label="Rollout %" name="rolloutPercent" type="number" min="0" step="1" defaultValue={rolloutPercent} />
      </div>
      <button type="submit" className={`${btn} ${prod ? "bg-indigo-700 hover:bg-indigo-600" : "bg-gray-900 hover:bg-gray-700"} text-white`}>
        {prod ? "Propose change" : "Apply to staging"}
      </button>
      {prod && <p className="text-xs text-gray-500">Production changes need approval from a checker or admin other than you.</p>}
    </ActionForm>
  );
}

export function DecisionForm({ flagKey, approvalId }: { flagKey: string; approvalId: string }) {
  return (
    <ActionForm action={decideProductionChangeAction} className="mt-3 space-y-3">
      <input type="hidden" name="key" value={flagKey} />
      <input type="hidden" name="approvalId" value={approvalId} />
      <FormField label="Decision note" name="note" type="textarea" rows={2} placeholder="Optional" />
      <div className="flex gap-3">
        <button type="submit" name="decision" value="APPROVED" className={`${btn} bg-green-700 text-white hover:bg-green-600`}>
          Approve
        </button>
        <button type="submit" name="decision" value="REJECTED" className={`${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>
          Reject
        </button>
      </div>
    </ActionForm>
  );
}

/** Kill switch: confirm dialog with a required reason. */
export function KillSwitch({ flagKey }: { flagKey: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} className={`${btn} bg-red-700 text-white hover:bg-red-600`}>
        Kill switch
      </button>
      <dialog ref={dialog} className="m-auto w-full max-w-md rounded-md p-6 shadow-xl backdrop:bg-black/40">
        <h2 className="text-lg font-semibold text-red-800">Emergency disable in production</h2>
        <p className="mt-1 text-sm text-gray-700">
          Sets <span className="font-mono">{flagKey}</span> to OFF and 0% in production immediately, without approval. Any pending
          production change is rejected. This is recorded as <span className="font-mono">EMERGENCY_DISABLE</span>.
        </p>
        <ActionForm action={killSwitchAction} className="mt-4 space-y-3">
          <input type="hidden" name="key" value={flagKey} />
          <FormField label="Reason" name="reason" type="textarea" required rows={3} placeholder="What is going wrong?" />
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => dialog.current?.close()} className={`${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>
              Cancel
            </button>
            <button type="submit" className={`${btn} bg-red-700 text-white hover:bg-red-600`}>
              Disable in production
            </button>
          </div>
        </ActionForm>
      </dialog>
    </>
  );
}

export function ArchiveButton({ flagKey }: { flagKey: string }) {
  return (
    <ActionForm action={archiveFlagAction}>
      <input type="hidden" name="key" value={flagKey} />
      <button
        type="submit"
        onClick={(e) => {
          if (!confirm(`Archive ${flagKey}? It becomes read-only in both environments.`)) e.preventDefault();
        }}
        className={`${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}
      >
        Archive flag
      </button>
    </ActionForm>
  );
}
