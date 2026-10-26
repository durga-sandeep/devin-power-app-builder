"use client";

import Link from "next/link";
import { ActionForm } from "@/lib/platform/ui/ActionForm";
import { FormField } from "@/lib/platform/ui/FormField";
import { createFlagAction } from "../actions";

export function CreateFlagForm() {
  return (
    <ActionForm action={createFlagAction} className="space-y-4">
      <FormField label="Key" name="key" required placeholder="new-checkout-flow" hint="kebab-case, unique, cannot be changed later" />
      <FormField label="Description" name="description" type="textarea" required placeholder="What does this flag gate?" />
      <FormField label="Owner" name="owner" required placeholder="payments-team" />
      <p className="text-xs text-gray-500">Both environments start OFF at 0%.</p>
      <div className="flex items-center gap-3 pt-2">
        <button type="submit" className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700">
          Create flag
        </button>
        <Link href="/feature-flags" className="text-sm text-gray-600 hover:text-gray-900">
          Cancel
        </Link>
      </div>
    </ActionForm>
  );
}
