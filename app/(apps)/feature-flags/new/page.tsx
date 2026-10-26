import { PageShell } from "@/lib/platform/ui";
import { CreateFlagForm } from "./CreateFlagForm";

export default function NewFlagPage() {
  return (
    <PageShell app="feature-flags" title="New feature flag">
      <div className="max-w-lg rounded-md border border-gray-200 bg-white p-6">
        <CreateFlagForm />
      </div>
    </PageShell>
  );
}
