"use client";

import Link from "next/link";
import { ActionForm } from "@/lib/platform/ui/ActionForm";
import { FormField } from "@/lib/platform/ui/FormField";
import { createRefundAction } from "../actions";

export function CreateRefundForm() {
  return (
    <ActionForm action={createRefundAction} className="space-y-4">
      <FormField label="Customer ref" name="customerRef" required placeholder="cus_1234" />
      <FormField label="Order ref" name="orderRef" required placeholder="ord_5678" />
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <FormField label="Amount" name="amount" required placeholder="125.00" hint="Over $5,000 needs an admin to approve." />
        </div>
        <FormField label="Currency" name="currency" type="select" defaultValue="USD" options={[{ value: "USD", label: "USD" }, { value: "EUR", label: "EUR" }, { value: "GBP", label: "GBP" }]} />
      </div>
      <FormField label="Reason" name="reason" type="textarea" required placeholder="Why is the customer owed this refund?" />
      <div className="flex items-center gap-3 pt-2">
        <button type="submit" className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-gray-700">
          Submit for approval
        </button>
        <Link href="/refunds" className="text-sm text-gray-600 hover:text-gray-900">
          Cancel
        </Link>
      </div>
    </ActionForm>
  );
}
