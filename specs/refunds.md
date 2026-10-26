# Refunds dashboard (app #1)

Ops staff review and approve customer refund requests. This is the app that establishes the
platform primitives, so the controls matter more than the UI.

## Entities
- RefundRequest: id, customerRef, orderRef, amountCents, currency, reason, status
  (PENDING | APPROVED | REJECTED | EXECUTED | FAILED), createdBy, createdAt, decidedBy, decidedAt,
  decisionNote, idempotencyKey (unique, set on execution), externalRef (from "payment provider").

## Actions and roles
- List/view refunds: viewer, maker, checker, admin.
- Create refund request: maker, admin. (Sensitive: creates an approval request.)
- Approve / reject: checker, admin. Checker must not be the creator (maker-checker).
- Execute approved refund: checker, admin. Calls a FAKE payment provider module
  (`lib/payments/fake.ts`) that sleeps 200ms and returns an externalRef; it throws on amounts that
  end in 13 cents so the FAILED path is testable. Takes an idempotency key; retry is safe.
- Amounts over $5,000 require `admin` to approve, not `checker`.

## Screens
- `/refunds`: table with filters by status; row click → detail.
- `/refunds/[id]`: details, status timeline built from the audit log, action buttons appropriate to
  the current user's role, a decision note field.
- `/refunds/new`: create form.

## Seed
- 12 refund requests across statuses, 4 users (one per role), amounts including one > $5,000 and
  one ending in .13.

## Edge cases
- `FAILED` is terminal in v1: there is no re-execute path; a failed refund needs a new request.
- The checker who approved a request may also execute it. Only maker and checker must differ.
- Exactly $5,000.00 may be approved by a checker; strictly more than $5,000.00 needs `admin`.

## Out of scope
- Real payment integration, email notifications, pagination beyond 50 rows.
