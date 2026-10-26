# AGENTS.md — devin-power-app-builder

Internal tools for a fintech ops team (KYC, refunds, feature flags, and ~10 more to come).
This repo is a THIN shared platform plus one plain-code app per tool. It is deliberately not a
generic form/JSON-spec engine. Each app is ordinary code that reuses the platform primitives.

## Stack (do not change without asking)
- Current stable Next.js (App Router, whatever `create-next-app` installs today) + TypeScript, Tailwind.
  `next.config.ts` sets `cacheComponents: false` (every page reads the session cookie, so the
  create-next-app default only produces Suspense/`instant` errors). `cookies()` is async: `await cookies()`.
- Prisma + SQLite (`prisma/dev.db`). Seed data via `prisma/seed.ts`.
- Tests: Vitest for unit/API-level tests. Playwright optional for one smoke test per app.
- Package manager: pnpm. Scripts: `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm typecheck`
  (`next typegen && tsc --noEmit`; plain `tsc` fails on a fresh clone without the generated route
  types), `pnpm db:reset` (migrate + seed).

## Layout
```
app/(platform)/login            dev login (SSO stand-in)
app/(apps)/<app-name>/          one folder per internal tool, plain pages + server actions
lib/platform/auth.ts            getCurrentUser(), requireRole()
lib/platform/audit.ts           audit(tx, event) — append-only; caller passes its Prisma tx
lib/platform/approvals.ts       requestApproval(), decide() — maker-checker primitive
lib/platform/ui/                DataTable, FormField, StatusBadge, PageShell, RequestChangeButton
specs/<app-name>.md             short human-written spec per app
.agents/skills/new-internal-tool/SKILL.md   the procedure for adding a new app
```
An app's URL is `/<app-name>`, the same as its folder name. Specs refer to screens by that path.

## Platform rules (every app must follow)
1. **Auth**: `getCurrentUser()` reads a signed cookie set by the dev login page. Users and roles are
   seeded. This stands in for Entra ID / OIDC in production; keep the interface so SSO is a swap.
2. **Roles**: `viewer`, `maker`, `checker`, `admin`. Enforce with `requireRole()` in server actions
   and route handlers. UI hiding is cosmetic only and never the real check.
3. **Audit**: every state-changing action writes an `AuditEvent` {actor, app, entity, entityId,
   action, before, after, requestId} in the SAME Prisma transaction. The audit table is append-only:
   no update or delete code paths exist anywhere.
4. **Approvals (maker-checker)**: sensitive actions go through `requestApproval()` and `decide()`.
   `decide()` enforces decider ≠ requester and PENDING-only, server-side, and audits the decision.
   Which roles may decide at all (and any amount thresholds, e.g. "> $5,000 needs admin") is the
   app's job: call `requireRole()` before `decide()`.
5. **Idempotency**: any action with an external side effect (e.g. executing a refund) takes an
   idempotency key with a unique constraint and is safe to retry. The key is minted server-side when
   the action form renders and stored on the row before the provider is called; a repeated key
   returns the stored result without calling the provider again.
6. **Request change**: every app page renders `RequestChangeButton`, which opens a prefilled GitHub
   issue (app, screen, role, expected vs actual) using the `change-request` template. Ops feedback
   flows back as issues. Base URL comes from `NEXT_PUBLIC_REPO_URL`, default
   `https://github.com/durga-sandeep/devin-power-app-builder`.

## Testing rules
- For every mutation: (a) authorized happy path, (b) unauthorized role is rejected with a
  `ForbiddenError` carrying `status: 403` (server actions return it to the form as
  `{ ok: false, status: 403 }` rather than as an HTTP status; 401 when not logged in),
  (c) an AuditEvent row exists with correct before/after.
- Maker-checker: test that the maker cannot approve their own request.
- Idempotent actions: test that a repeated key does not double-execute.
- `pnpm test`, `pnpm lint` and `pnpm typecheck` must pass before opening a PR.

## Working style
- Small PRs, one app or one platform change per PR (exception: the first app may ship together
  with the platform it establishes). Describe what you verified in the PR body.
- Before opening a PR, run the app, exercise the main flow in the browser, and attach screenshots.
- If a requirement is ambiguous, pick the simplest option, state the assumption in the PR, continue.
- Never add dependencies beyond the stack above without listing them in the PR description.
- Never put secrets in the repo. There are none needed for local dev: `.env` (SQLite `DATABASE_URL`,
  `NEXT_PUBLIC_REPO_URL`, and a `SESSION_SECRET` that only signs the dev-login cookie) is committed so
  `pnpm db:reset` works from a clean clone. That committed value is public by definition: the dev login
  is the SSO stand-in and must never run outside local dev. `auth.ts` refuses to start with the
  committed value when `NODE_ENV=production`; deployments set `SESSION_SECRET` from the environment.
  `.env*.local` is ignored and real secrets never land in git.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
