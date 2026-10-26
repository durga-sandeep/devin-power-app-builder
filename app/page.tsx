import Link from "next/link";
import { PageShell } from "@/lib/platform/ui/PageShell";

export const APPS: { href: string; name: string; description: string }[] = [
  { href: "/refunds", name: "Refunds", description: "Review, approve and execute customer refund requests." },
];

export default function Home() {
  return (
    <PageShell app="home" title="Internal tools">
      <p className="text-sm text-gray-600">Pick a tool from the list.</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {APPS.map((a) => (
          <li key={a.href}>
            <Link
              href={a.href}
              className="block rounded-md border border-gray-200 bg-white p-4 hover:border-gray-400"
            >
              <div className="font-medium">{a.name}</div>
              <div className="text-sm text-gray-600">{a.description}</div>
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
