import { prisma } from "@/lib/db";
import { StatusBadge } from "@/lib/platform/ui/StatusBadge";
import { loginAs } from "./actions";

export default async function LoginPage() {
  const users = await prisma.user.findMany({ orderBy: { role: "asc" } });
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">Dev login</h1>
      <p className="mt-1 text-sm text-gray-600">
        Stand-in for SSO. Pick a seeded user; a signed cookie is set.
      </p>
      <ul className="mt-6 divide-y divide-gray-200 rounded-md border border-gray-200">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between px-4 py-3">
            <div>
              <div className="font-medium">{u.name}</div>
              <div className="text-xs text-gray-500">{u.email}</div>
            </div>
            <form action={loginAs} className="flex items-center gap-3">
              <StatusBadge value={u.role} />
              <input type="hidden" name="userId" value={u.id} />
              <button
                type="submit"
                className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
              >
                Log in
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
