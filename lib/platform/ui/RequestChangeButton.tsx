"use client";

import { usePathname } from "next/navigation";

const REPO_URL =
  process.env.NEXT_PUBLIC_REPO_URL ?? "https://github.com/durga-sandeep/devin-power-app-builder";

/**
 * Opens a prefilled GitHub issue using .github/ISSUE_TEMPLATE/change-request.yml.
 * Query params match the template's field ids, so GitHub fills them in.
 */
export function RequestChangeButton({ app, role }: { app: string; role?: string }) {
  const pathname = usePathname();
  const params = new URLSearchParams({
    template: "change-request.yml",
    title: `[${app}] `,
    app,
    screen: pathname,
    role: role ?? "",
  });
  const href = `${REPO_URL}/issues/new?${params.toString()}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
    >
      Request change
    </a>
  );
}
