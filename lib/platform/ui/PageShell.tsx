import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/platform/auth";
import { logout } from "@/app/(platform)/login/actions";
import { RequestChangeButton } from "./RequestChangeButton";
import { StatusBadge } from "./StatusBadge";

export const NAV = [
  { href: "/", label: "Home" },
  { href: "/refunds", label: "Refunds" },
  { href: "/feature-flags", label: "Feature flags" },
];

/** Common frame for every page: nav, current user + role, Request change button. Redirects to login. */
export async function PageShell({
  app,
  title,
  actions,
  children,
}: {
  app: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <nav className="flex items-center gap-5 text-sm">
            <span className="font-semibold">Ops tools</span>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-gray-600 hover:text-gray-900">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-700">{user.name}</span>
            <StatusBadge value={user.role} />
            <form action={logout}>
              <button type="submit" className="text-gray-500 hover:text-gray-900">
                Log out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <div className="flex items-center gap-2">
            {actions}
            <RequestChangeButton app={app} role={user.role} />
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
