# Feature flag admin panel (app #2)

Engineers and ops toggle product feature flags per environment, with history and an emergency off.

## Entities
- FeatureFlag: id, key (unique, kebab-case), description, owner, createdAt.
- FlagState: flagId, environment (staging | production), enabled (bool), rolloutPercent (0–100),
  updatedBy, updatedAt.

## Actions and roles
- List/view flags and history: viewer, maker, checker, admin.
- Create flag: maker, admin.
- Change staging state: maker, admin. Not sensitive (no approval).
- Change production state: maker proposes, checker/admin approves (maker-checker). Rollout changes
  in production go through the same approval.
- Kill switch: admin only, sets enabled=false and rolloutPercent=0 in production immediately,
  skips approval, writes an `EMERGENCY_DISABLE` audit event with the reason (required).
- Archive flag: admin only.

## Screens
- `/flags`: table of flags with staging/production state badges and pending-approval indicator.
- `/flags/[key]`: both environments side by side, change form, pending approvals, change history
  from the audit log, kill switch button (admin only) with a confirm + reason dialog.
- `/flags/new`: create form.

## Seed
- 10 flags with mixed states, two with pending production changes.

## Out of scope
- SDK/evaluation API, targeting rules, per-user overrides.
