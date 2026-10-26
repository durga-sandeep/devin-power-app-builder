# devin-power-app-builder

Prototype built with Devin for a Cognition take-home: can a ~60-engineer fintech replace a
$250K/yr Power Apps estate with Devin-built internal tools?

**What this is:** a thin shared platform (dev-login auth stand-in, roles, append-only audit log,
maker-checker approvals, table/form UI) plus plain-code apps that reuse it. App #1 (refunds) is
built by driving Devin by hand. App #2 (feature flags) is generated from the
[`new-internal-tool` skill](.agents/skills/new-internal-tool/SKILL.md) in one timed session.
<!-- switch to past tense once each has actually happened -->

**Who wrote what:** the instructions in this repo (AGENTS.md, the skill, specs, prompts) were drafted
with Claude and edited by me. All application code was written by Devin in the sessions linked below.

**What this is not:** a Power Apps clone, a form/spec engine, or a KYC tool (deliberately not
built: PII and field-level access is where Dataverse earns its fee).

## Run it
```bash
pnpm install
pnpm db:reset      # migrate + seed (4 users, one per role)
pnpm dev           # http://localhost:3000 → pick a user on the login page
pnpm test && pnpm lint
```

## Apps
<!-- Devin appends a section per app -->

## Time and cost log (honest numbers)
| # | Session | What | Wall time | ACUs / credits | Devin Review findings | Human edits before merge | Link |
|---|---------|------|-----------|----------------|-----------------------|--------------------------|------|
| 1 | | Scaffold + platform + refunds | | | | | |
| 2 | | Feature flags via skill (timed) | | | | | |
| 3 | | Change request → PR (loop) | | | | | |
| | | **Total prototype time** | | | | | |

Time budget was 2h. Actual: _fill in, including overrun if any_.

## What Devin got wrong, and what I corrected
<!-- bullet list with links to the exact commits/comments -->

## Prompts used
- Session 1: [`docs/prompts/session-1.md`](docs/prompts/session-1.md)
- Session 2: `@skills:new-internal-tool feature-flags specs/feature-flags.md`
- Automation prompt: [`docs/prompts/automation-prompt.md`](docs/prompts/automation-prompt.md)

## The loop (one real turn)
<!-- issue link → session link → PR link, with timestamps; note whether the automation fired or
you started the session manually -->

## Skill edits Devin proposed after app #2
<!-- link to the PR with the diff -->

## Caveats, stated plainly
- Dev login is a stand-in for Entra ID / OIDC. Real SSO is a cost line, not a checkbox.
- Part of the app #2 speedup may be Devin's cross-session memory, not only the skill.
- n=2. Metrics above are a hypothesis with a measurement plan, not proof.
- The change-request loop lowers the cost of a change; it does not give ops self-service back.
