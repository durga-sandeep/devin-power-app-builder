# AGENTS.md — devin-power-app-builder

Internal tools for a fintech ops team (KYC, refunds, feature flags, and ~10 more to come).
This repo is a THIN shared platform plus one plain-code app per tool. It is deliberately not a
generic form/JSON-spec engine. Each app is ordinary code that reuses the platform primitives.

## Stack (do not change without asking)
- Current stable Next.js (App Router, whatever `create-next-app` installs today) + TypeScript, Tailwind.
- Prisma + SQLite (`prisma/dev.db`). Seed data via `prisma/seed.ts`.
- Tests: Vitest for unit/API-level tests. Playwright optional for one smoke test per app.
- Package manager: pnpm. Scripts: `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm db:reset` (migrate + seed).

## Layout
```
app/(platform)/login            dev login (SSO stand-in)
app/(apps)/<app-name>/          one folder per internal tool, plain pages + server actions
lib/platform/auth.ts            getCurrentUser(), requireRole()
lib/platform/audit.ts           audit(event) — append-only, same transaction as the mutation
lib/platform/approvals.ts       requestApproval(), decide() — maker-checker primitive
lib/platform/ui/                DataTable, FormField, StatusBadge, PageShell, RequestChangeButton
specs/<app-name>.md             short human-written spec per app
.agents/skills/new-internal-tool/SKILL.md   the procedure for adding a new app
```

## Platform rules (every app must follow)
1. **Auth**: `getCurrentUser()` reads a signed cookie set by the dev login page. Users and roles are
   seeded. This stands in for Entra ID / OIDC in production; keep the interface so SSO is a swap.
2. **Roles**: `viewer`, `maker`, `checker`, `admin`. Enforce with `requireRole()` in server actions
   and route handlers. UI hiding is cosmetic only and never the real check.
3. **Audit**: every state-changing action writes an `AuditEvent` {actor, app, entity, entityId,
   action, before, after, requestId} in the SAME Prisma transaction. The audit table is append-only:
   no update or delete code paths exist anywhere.
4. **Approvals (maker-checker)**: sensitive actions go through `requestApproval()` and `decide()`.
   The checker must not be the maker; enforce server-side. Decisions are audited.
5. **Idempotency**: any action with an external side effect (e.g. executing a refund) takes an
   idempotency key with a unique constraint and is safe to retry.
6. **Request change**: every app page renders `RequestChangeButton`, which opens a prefilled GitHub
   issue (app, screen, role, expected vs actual) using the `change-request` template. Ops feedback
   flows back as issues. Base URL comes from `NEXT_PUBLIC_REPO_URL`, default
   `https://github.com/durga-sandeep/devin-power-app-builder`.

## Testing rules
- For every mutation: (a) authorized happy path, (b) unauthorized role is rejected with 403,
  (c) an AuditEvent row exists with correct before/after.
- Maker-checker: test that the maker cannot approve their own request.
- Idempotent actions: test that a repeated key does not double-execute.
- `pnpm test` and `pnpm lint` must pass before opening a PR.

## Working style
- Small PRs, one app or one platform change per PR. Describe what you verified in the PR body.
- Before opening a PR, run the app, exercise the main flow in the browser, and attach screenshots.
- If a requirement is ambiguous, pick the simplest option, state the assumption in the PR, continue.
- Never add dependencies beyond the stack above without listing them in the PR description.
- Never put secrets in the repo. There are none needed for local dev.
