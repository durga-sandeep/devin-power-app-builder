# Automation: GitHub issue labeled `devin` → session

Trigger: GitHub → Issues → label added → `devin` (repo: durga-sandeep/devin-power-app-builder).
Action: new session with this prompt (the issue payload is appended automatically):

You are handling a change request filed by an ops user from inside an internal tool. Read AGENTS.md.
Identify the app and screen from the issue. Make the smallest change that satisfies "What you
expected" while keeping every platform rule (roles, audit, approvals). Add or update tests. Run
`pnpm test && pnpm lint`. Open a PR that links the issue with "Closes #<n>", explains the change in
two sentences an ops user can read, and includes a screenshot. Do not merge. If the request would
weaken a control (e.g. remove an approval step), do not implement it; comment on the issue explaining
why and tag it `needs-engineer`.

Controls to call out in the Loom: human approval before merge, ACU/credit budget on the automation,
and the automation can be paused by an admin (kill switch for the loop itself).
