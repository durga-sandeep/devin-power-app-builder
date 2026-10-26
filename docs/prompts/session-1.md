# Session 1 prompt — platform + refunds

Repo: durga-sandeep/devin-power-app-builder (connected). Read AGENTS.md and the skill in
.agents/skills/new-internal-tool/SKILL.md before anything else; they are the house rules.

Goal for this session: stand up the thin shared platform and build the first app, refunds, from
specs/refunds.md. This app is the reference other apps will copy, so correctness of the controls
(roles, audit, maker-checker, idempotency) matters more than visual polish.

Work in three checkpoints and report back after each one with what you verified. Don't wait for me
to continue unless something is blocked.

Checkpoint 1 — Scaffold (target ~15 min)
- Next.js 15 App Router + TypeScript + Tailwind + Prisma/SQLite + Vitest, pnpm. Scripts from
  AGENTS.md (`dev`, `test`, `lint`, `db:reset`).
- Dev login page: pick one of 4 seeded users (viewer, maker, checker, admin), sets a signed cookie.
- Home page with nav and a PageShell that shows current user + role and a Request change button
  linking to a prefilled GitHub issue (use the issue template in .github/ISSUE_TEMPLATE).
- Report: `pnpm db:reset && pnpm test && pnpm lint` green on an empty test.

Checkpoint 2 — Platform primitives in lib/platform (target ~15 min)
- auth.ts: getCurrentUser(), requireRole(...roles) throwing a 403-style error.
- audit.ts: audit(tx, event) writing AuditEvent inside a caller-supplied Prisma transaction.
  Append-only: no update/delete helpers exist.
- approvals.ts: requestApproval(), decide(); server-side rule that decider != requester.
- ui/: DataTable, FormField, StatusBadge, PageShell, RequestChangeButton. Plain and consistent.
- Unit tests for requireRole, decide() maker≠checker rule, and audit append in a transaction.
- Report: file list + test output.

Checkpoint 3 — Refunds app per specs/refunds.md (target ~25 min)
- Follow the SKILL.md procedure as if you had been invoked with
  `@skills:new-internal-tool refunds specs/refunds.md`. Fake payment provider in lib/payments/fake.ts.
- Tests per AGENTS.md: happy path, 403 for wrong role, audit row asserted, maker cannot approve own
  request, > $5,000 needs admin, repeated idempotency key does not double-execute, .13 amounts FAIL.
- Run the app, log in as maker → create; as checker → approve + execute; as viewer → confirm actions
  are rejected server-side (try calling the action, not just hiding the button). Screenshots.
- Open ONE PR with everything, body per SKILL.md step 9. Record start/finish times in the PR.

Then: tell me what in AGENTS.md or SKILL.md was unclear or slowed you down, with proposed edits.

Assumptions you may make without asking: UI aesthetics (keep it clean, Tailwind defaults), exact
column layouts, seed data content. Ask only if something would change the data model or a control.
