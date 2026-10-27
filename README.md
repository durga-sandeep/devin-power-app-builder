# devin-power-app-builder

Prototype built with Devin for a Cognition take-home: can a ~60-engineer fintech replace a
$250K/yr Power Apps estate with Devin-built internal tools?

**What this is:** a thin shared platform (dev-login auth stand-in, roles, append-only audit log,
maker-checker approvals, idempotency, table/form UI) plus plain-code apps that reuse it. App #1
(refunds) was built by driving Devin by hand with a 40-line prompt. App #2 (feature flags) was
generated from the [`new-internal-tool` skill](.agents/skills/new-internal-tool/SKILL.md) with one
line and no help. Then one real turn of a change-request loop: an ops user clicks a button in the
app, and 14 minutes later there is a PR for an engineer to approve.

**Who wrote what:** the instructions in this repo (AGENTS.md, the skill, specs, prompts) were drafted
with Claude and edited by me. Every line of application code, every test, and every PR was written by
Devin in the sessions logged below. I never edited code by hand.

**What this is not:** a Power Apps clone, a form/spec engine (that is how a team ends up maintaining a
worse Power Apps), or a KYC tool. KYC was deliberately not built: PII and field-level access is exactly
where Dataverse earns its fee, and a weekend prototype should not pretend otherwise.

## Run it
Requires Node 20+ and pnpm 12 (the repo pins `pnpm@12.15.0`; `npx -y pnpm@12.15.0 <cmd>` works if
your local pnpm is older).
```bash
pnpm install
pnpm db:reset      # migrate + seed: 4 users (one per role), 12 refunds, 10 flags
pnpm dev           # http://localhost:3000 → pick a user on the dev login page
pnpm test && pnpm lint && pnpm typecheck   # 76 tests
```
Dev login is a stand-in for SSO. It refuses to start in production unless `ALLOW_DEV_LOGIN=1`, and the
app refuses the committed `SESSION_SECRET` when `NODE_ENV=production`.

## Build the next app with Devin
1. Write a short spec in `specs/<app-name>.md` (copy `specs/feature-flags.md`; keep the **Edge cases** section).
2. Start a Devin session on this repo and send one line:
   `Follow .agents/skills/new-internal-tool/SKILL.md with arguments: <app-name> specs/<app-name>.md`
   (`@skills:new-internal-tool <app-name> specs/<app-name>.md` once the skill is indexed for your org;
   on this org the autocomplete had not indexed it, so I invoked it by path.)
3. Devin posts a plan (entities, actions, roles, which actions are sensitive) as its first checkpoint,
   builds the app on the platform primitives, tests it, exercises it in a browser, and opens a PR.
   Devin Review runs automatically; auto-fix is on, so Devin fixes its own findings before they post.
4. You review and merge. Then ask: *"What in AGENTS.md or SKILL.md was unclear or slowed you down?
   Propose edits."* Merge the good ones. The next app inherits them.

## Apps
### Refunds (`/refunds`)
Spec: [`specs/refunds.md`](specs/refunds.md). Code: `app/(apps)/refunds/`, fake provider in `lib/payments/fake.ts`.

| Action | Roles | Control |
|---|---|---|
| List / view | all | login required |
| Create | maker, admin | writes `RefundRequest` + `ApprovalRequest` + audit row in one transaction |
| Approve / reject | checker, admin; **> $5,000 admin only** | `decide()` refuses the requester (maker-checker) |
| Execute | checker, admin, only from `APPROVED` | idempotency key claimed on the row before the provider call; repeat key returns the stored result |

The fake provider sleeps 200 ms and fails any amount ending in `.13` (refund becomes `FAILED`, audited as `REFUND_FAILED`).

### Feature flags (`/feature-flags`)
Spec: [`specs/feature-flags.md`](specs/feature-flags.md). Code: `app/(apps)/feature-flags/`. Lives at `/feature-flags` (not the spec's `/flags`) because AGENTS.md puts each app at its app name.

| Action | Roles | Control |
|---|---|---|
| List / view / history | all | login required |
| Create flag (both environments start OFF 0%) | maker, admin | audit `FLAG_CREATED` |
| Change staging | maker, admin | applies immediately, audit `FLAG_STATE_CHANGED` with before/after |
| Propose production change | maker, admin | `requestApproval()`; at most one pending per flag (claimed via unique `FlagState.pendingApprovalId`) |
| Approve / reject production change | checker, admin | `decide()` refuses the proposer (maker-checker); approval applies the state in the same transaction |
| Kill switch | admin only | reason required, production → OFF 0% immediately, audit `EMERGENCY_DISABLE`; pending production change auto-rejected ("superseded by emergency disable"); no-op on archived flags |
| Archive | admin only | read-only afterwards; pending production change auto-rejected |

`enabled=true` with `rolloutPercent=0` is rejected; `enabled=false` keeps the percentage. Seed: 10 flags, 2 pending production changes.

## Time and cost log (real numbers, PST, 2026-10-26)
| # | Session | What | Prompt → PR | My messages after start | Tests added | Devin Review | PR |
|---|---------|------|-------------|-------------------------|-------------|--------------|----|
| 1 | Session 1 (Ultra) | Scaffold + platform + refunds | **30 min** (3:25 → 3:55) | 1 (how to fix the Review findings) | 33 | 3 security + 3 bugs → fixed in-PR | [#1](https://github.com/durga-sandeep/devin-power-app-builder/pull/1) |
| 1b | same session | Devin proposed 10 edits to AGENTS.md/SKILL.md, unprompted | 5 min | 1 (yes) | – | 1 finding → fixed | [#2](https://github.com/durga-sandeep/devin-power-app-builder/pull/2) |
| 2 | Session 2 (Ultra) | Feature flags from the skill, hands-off | **~6 min** (4:18 plan → 4:24 PR) | **0** | 27 | **0 findings** | [#3](https://github.com/durga-sandeep/devin-power-app-builder/pull/3) |
| 2b | same session | 5 rule edits + a new platform primitive `supersede()` (Devin asked before touching a control) | 4 min | 1 (yes) | 4 | 0 / 0 | [#4](https://github.com/durga-sandeep/devin-power-app-builder/pull/4), [#5](https://github.com/durga-sandeep/devin-power-app-builder/pull/5) |
| 3 | Session 3 (Normal, started by automation) | Change request from the app → PR | **14 min** (4:48 → 5:02) | **0** | 2 | 0 findings | [#7](https://github.com/durga-sandeep/devin-power-app-builder/pull/7) |

- **Wall clock, first prompt to last merge:** 3:25 PM → 5:04 PM, about **1 h 40 min**, including the
  Review fix round, two rule-edit PRs, and a trigger misconfiguration (below). Budget was 2 h.
- **Cost:** everything above ran on a Devin **Pro plan ($20/month)**. It consumed one day's included
  quota (half the weekly quota) plus **$1.92** of on-demand usage. Enterprise is billed in ACUs at a
  negotiated rate, so treat this as an order of magnitude, not a price.
- **Merged to main:** 7 PRs. App 1 was on main 50 min after the first prompt; app 2 was on main 8 min
  after its session started.

## What went wrong, and what I did about it
- **Devin Review caught a real bug the 33 tests missed.** If the process died between claiming the
  idempotency key and the provider call, the refund stayed `APPROVED` with a key forever. I told Devin
  how I wanted it fixed (an `EXECUTING` state with a stale-resume path); it did, with tests, in the same
  PR. [Findings](https://github.com/durga-sandeep/devin-power-app-builder/pull/1) · fix commit `bffba59`.
- **Review flagged the dev login as a security hole.** Correct, and by design. I had Devin make it
  fail-safe (refuses to start in production) rather than remove it. Commits `dc71c5f`, `cb594d5`.
- **The automation did not fire on the first issue.** My trigger was "issue opened" + "label =
  change-request". The label filter only matches "labeled" events. One-minute fix (change the action to
  "labeled", re-add the label). Worth knowing before promising ops a hands-free loop.
- **The repo's issue label did not exist.** GitHub silently drops a template label that is not defined.
  Created it before filing the issue. Same lesson.
- **Environment snapshot built from a stale `main`.** Devin suggested a reusable environment after
  session 1, but it built before PR #1 merged, so sessions 2 and 3 saw a setup warning and pulled fresh
  code themselves. No effect on output; rebuild the snapshot after the first merge.
- **Skill autocomplete did not index for this org.** Invoked the skill by file path instead. Same
  behaviour, one extra sentence in the prompt.
- **Things Devin decided well without asking:** Prisma 6 over the Prisma 8 RC; `cacheComponents: false`
  because every page reads the session cookie; a fresh SQLite test DB per run so audit rows are never
  truncated; proved the viewer block by replaying the real server action with four different cookies.

## Prompts used
- Session 1: [`docs/prompts/session-1.md`](docs/prompts/session-1.md)
- Session 2: one line, `Follow .agents/skills/new-internal-tool/SKILL.md with arguments: feature-flags specs/feature-flags.md`,
  then `Step 10 of the skill: what in AGENTS.md or SKILL.md was unclear, wrong, or slowed you down? Propose edits.`
- Automation (session 3): [`docs/prompts/automation-prompt.md`](docs/prompts/automation-prompt.md)
- "Share prompts in PRs" is on, so each PR description carries the prompt that produced it.

## The loop, one real turn
1. Logged in as the checker on `/refunds/<id>`, clicked **Request change**. GitHub opened the
   `change-request` template pre-filled with app, screen and role.
2. Filed [issue #6](https://github.com/durga-sandeep/devin-power-app-builder/issues/6): *"Rejecting a refund should require a decision note."* 4:41 PM.
3. Devin Automation (trigger: issue labeled `change-request`) started a session at
   4:48 PM with no human involved.
4. [PR #7](https://github.com/durga-sandeep/devin-power-app-builder/pull/7) opened 5:02 PM: 4 files, 2 tests, browser-verified, with a summary written once
   for ops and once for engineers, and the line *"this tightens a control and weakens none."*
5. Devin Review: 0 findings. I merged. The issue closed itself.

Controls around the loop: a human merges every PR; the automation has a per-message spend cap and can
be paused by an admin; the automation prompt tells Devin to refuse and tag `needs-engineer` if a request
would weaken a control. In production I would gate on a triage label added by an engineer.

## Rule edits Devin proposed (the compounding part)
- After app 1, unprompted: **10 edits** ([PR #2](https://github.com/durga-sandeep/devin-power-app-builder/pull/2)): audit signature, who may `decide()`,
  idempotency key origin, 403 semantics for server actions, Next 16 defaults, a client-import trap, a
  spec "Edge cases" section.
- After app 2, when asked: **5 edits** ([PR #4](https://github.com/durga-sandeep/devin-power-app-builder/pull/4)) plus one gap in the platform itself, a
  system-initiated approval cancellation, which Devin asked permission to fix before touching a control
  ([PR #5](https://github.com/durga-sandeep/devin-power-app-builder/pull/5), `supersede()`, 4 tests). Every future app gets it.
- Trend: 30 min → 6 min, 10 edits → 5, 6 Review findings → 0. Hypothesis: by app ~5 the rules stop
  changing. That is a hypothesis with n=2, not a result.

## What I deliberately did not build
- KYC queue (PII, field-level access, Dataverse's home turf).
- A generic spec-to-UI engine. Thin platform + plain code per app is only defensible because Devin
  makes plain code cheap.
- Real SSO, deployment, monitoring. All real cost lines in the recommendation, none of them a weekend task.
- Devin Oncall and scheduled security scans. They exist and belong in month 2; I describe them, I do not claim them.

## Caveats, stated plainly
- Dev login is a stand-in for Entra ID / OIDC. Real SSO is a cost line, not a checkbox.
- Part of the app #2 speedup may be Devin's cross-session memory, not only the skill.
- n=2. The trend above is a hypothesis with a measurement plan, not proof.
- The change-request loop lowers the cost of a change; it does not give ops self-service back. An
  engineer still clicks merge. In a fintech that is the right trade, and it should be named as one.
- Compounding runs both ways: a bad rule reaches every app for free. Rule files get code review too.
