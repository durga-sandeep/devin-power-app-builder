import { PageShell } from "@/lib/platform/ui";
import { CreateRefundForm } from "./CreateRefundForm";

export default function NewRefundPage() {
  return (
    <PageShell app="refunds" title="New refund request">
      <div className="max-w-lg rounded-md border border-gray-200 bg-white p-6">
        <CreateRefundForm />
      </div>
    </PageShell>
  );
}
