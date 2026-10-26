---
name: new-internal-tool
description: Add a new internal tool app to this repo from a short spec in specs/<app>.md, reusing the platform primitives (auth, roles, audit, approvals, UI) and the required test pattern. Use whenever asked to build a new internal tool or admin panel.
argument-hint: <app-name> <path-to-spec>
triggers: ["user", "model"]
---

You are adding a new internal tool to this repo. Arguments: `$1` = app name
(kebab-case), `$2` = path to the spec (default `specs/$1.md`). Read `AGENTS.md` first and follow it.

## Procedure
1. Read `$2` and `AGENTS.md`. Read the spec's "Edge cases" section first: it records the decisions
   (terminal states, who may execute, threshold boundaries) you would otherwise have to assume. If the
   spec has no such section, list the edge cases you had to decide and add them to the spec in your PR.
   Then list the entities, the actions, which roles may perform each action,
   and which actions are "sensitive" (need maker-checker) or have external side effects (need an
   idempotency key). Post this list as your first checkpoint before writing code.
2. Look at an existing app under `app/(apps)/` (e.g. `refunds`) and copy its structure. Reuse
   `lib/platform/*`. Do not create new auth, audit, approval, or table components. Pages live at
   `/$1/...` (the folder name); if the spec's screen paths differ, use `/$1` and list it under
   Assumptions in the PR.
3. Add Prisma models for the new entities. Run a migration. Extend `prisma/seed.ts` with realistic
   sample rows (the number the spec asks for; default 8) and make sure seeded users cover every role
   used by this app.
4. Build pages under `app/(apps)/$1/`: a list view using `DataTable`, a detail/edit view using
   `FormField`, and server actions for each mutation. Every page uses `PageShell` and renders
   `RequestChangeButton`. In `"use client"` files import `FormField` / `ActionForm` by file
   (`@/lib/platform/ui/FormField`), not from the `@/lib/platform/ui` barrel: it re-exports
   `PageShell`, which pulls `next/headers` into the client bundle and 500s the page.
5. Wire every mutation through `requireRole()`, write `AuditEvent` in the same transaction, route
   sensitive actions through `requestApproval()` / `decide()`, and add idempotency keys where the spec
   says an action has an external effect.
6. Write tests per the Testing rules in `AGENTS.md`. Run `pnpm test`, `pnpm lint` and `pnpm typecheck` until green.
7. Run `pnpm dev`, log in as each relevant role, exercise the main flow in the browser, and take
   screenshots of: the list view, the role-restricted view an unauthorized role sees, and the audit
   trail. The UI hides forbidden actions and the page re-renders after a denied action, so the 403
   text never appears on screen. Prove a denial from the server side instead: submit the real server
   action with a lower role's cookie, check the response carries `status: 403`, and confirm in the DB
   that nothing changed and no audit row was written.
8. Add the app to the home page nav. Add a short section to `README.md` under "Apps".
9. Open a PR titled `feat($1): <one line>`. In the body: assumptions you made, what you verified,
   screenshots, and the time you started and finished.
10. Post a final checkpoint: anything in this skill or in `AGENTS.md` that was wrong, missing, or
    slowed you down, with a concrete proposed edit. If you can, propose the skill edit directly.

## Specifications (must be true when you finish)
- `pnpm db:reset && pnpm test && pnpm lint && pnpm typecheck` pass from a clean clone.
- No mutation is reachable without a server-side role check.
- Every mutation produces an audit row; no code path updates or deletes audit rows.
- Maker cannot approve their own request. Repeating an idempotency key does not double-execute.
- The app is reachable from the home nav and has the Request change button on every page.

## Advice and pointers
- Prefer plain server actions over API routes unless the spec needs an external caller.
- Keep each app self-contained in its folder; shared code goes in `lib/platform/` only if a second
  app needs it, and then say so in the PR.
- Spec says "kill switch" or "emergency": that action is admin-only, skips approval, and writes an
  audit row with `action: "EMERGENCY_*"` so it stands out.
- If the spec conflicts with `AGENTS.md`, `AGENTS.md` wins; note the conflict in the PR.

## Forbidden actions
- Do not introduce a new UI framework, ORM, auth library, or database.
- Do not implement permissions only in the client.
- Do not delete, truncate, or rewrite audit rows, even in tests (use a fresh DB instead).
- Do not merge your own PR.

## What's needed from the user
- The spec file. If `$2` does not exist, stop and ask for it rather than inventing requirements.
