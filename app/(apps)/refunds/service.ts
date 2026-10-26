import type { Prisma, RefundRequest } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole, type CurrentUser, type Role } from "@/lib/platform/auth";
import { audit, auditTrail, newRequestId } from "@/lib/platform/audit";
import { decide, pendingApprovalFor, requestApproval } from "@/lib/platform/approvals";
import { fakePayments } from "@/lib/payments/fake";

export const APP = "refunds";
const ENTITY = "RefundRequest";
/** Over this amount only an admin may approve or reject. */
export const ADMIN_APPROVAL_THRESHOLD_CENTS = 500_000;
export const STATUSES = ["PENDING", "APPROVED", "REJECTED", "EXECUTED", "FAILED"] as const;
export type RefundStatus = (typeof STATUSES)[number];

export type CreateRefundInput = {
  customerRef: string;
  orderRef: string;
  amountCents: number;
  currency: string;
  reason: string;
};

/** Which roles may decide on this refund (the >$5,000 rule). */
export function deciderRoles(refund: Pick<RefundRequest, "amountCents">): Role[] {
  return refund.amountCents > ADMIN_APPROVAL_THRESHOLD_CENTS ? ["admin"] : ["checker", "admin"];
}

/** Cosmetic helper for the UI. The real checks are in the mutations below. */
export function permissions(user: CurrentUser, refund: RefundRequest) {
  const canDecide =
    refund.status === "PENDING" && deciderRoles(refund).includes(user.role) && refund.createdBy !== user.id;
  const canExecute = refund.status === "APPROVED" && (["checker", "admin"] as Role[]).includes(user.role);
  return { canDecide, canExecute };
}

export async function listRefunds(status?: string) {
  await requireRole("viewer", "maker", "checker", "admin");
  const where = status && (STATUSES as readonly string[]).includes(status) ? { status } : {};
  return prisma.refundRequest.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 });
}

export async function getRefund(id: string) {
  await requireRole("viewer", "maker", "checker", "admin");
  const refund = await prisma.refundRequest.findUnique({ where: { id } });
  if (!refund) return null;
  const [trail, approval, users] = await Promise.all([
    auditTrail(prisma, { app: APP, entity: ENTITY, entityId: id }),
    prisma.approvalRequest.findFirst({ where: { app: APP, entity: ENTITY, entityId: id }, orderBy: { requestedAt: "desc" } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  return { refund, trail, approval, names };
}

export async function createRefund(input: CreateRefundInput) {
  const user = await requireRole("maker", "admin");
  validateCreate(input);
  const requestId = newRequestId();
  return prisma.$transaction(async (tx) => {
    const refund = await tx.refundRequest.create({
      data: { ...input, currency: input.currency.toUpperCase(), createdBy: user.id },
    });
    await audit(tx, { actor: user.id, app: APP, entity: ENTITY, entityId: refund.id, action: "REFUND_CREATED", after: refund, requestId });
    await requestApproval(tx, {
      app: APP,
      entity: ENTITY,
      entityId: refund.id,
      action: "APPROVE_REFUND",
      requester: user,
      payload: { amountCents: refund.amountCents, currency: refund.currency },
      requestId,
    });
    return refund;
  });
}

export async function decideRefund(id: string, decision: "APPROVED" | "REJECTED", note?: string) {
  const refund = await prisma.refundRequest.findUnique({ where: { id } });
  if (!refund) throw new Error("Refund not found");
  const user = await requireRole(...deciderRoles(refund));
  if (refund.status !== "PENDING") throw new Error(`Refund is already ${refund.status}`);
  const requestId = newRequestId();
  return prisma.$transaction(async (tx) => {
    const approval = await pendingApprovalFor(tx, { app: APP, entity: ENTITY, entityId: id });
    if (!approval) throw new Error("No pending approval request for this refund");
    // Enforces decider != requester server-side and audits the decision.
    await decide(tx, { approvalId: approval.id, decider: user, decision, note, requestId });
    const after = await tx.refundRequest.update({
      where: { id, status: "PENDING" },
      data: { status: decision, decidedBy: user.id, decidedAt: new Date(), decisionNote: note?.trim() || null },
    });
    await audit(tx, { actor: user.id, app: APP, entity: ENTITY, entityId: id, action: `REFUND_${decision}`, before: refund, after, requestId });
    return after;
  });
}

/**
 * Executes an APPROVED refund against the payment provider. Idempotent on `idempotencyKey`:
 * the key is claimed on the row (unique column) before the provider is called, so a retry with the
 * same key returns the stored outcome instead of paying twice.
 */
export async function executeRefund(id: string, idempotencyKey: string) {
  const user = await requireRole("checker", "admin");
  if (!idempotencyKey) throw new Error("idempotencyKey is required");
  const requestId = newRequestId();

  const claim = await prisma.$transaction(async (tx) => {
    const refund = await tx.refundRequest.findUnique({ where: { id } });
    if (!refund) throw new Error("Refund not found");
    if (refund.idempotencyKey === idempotencyKey) return { refund, replay: true as const };
    if (refund.status !== "APPROVED") throw new Error(`Refund is ${refund.status}, not APPROVED`);
    if (refund.idempotencyKey) throw new Error("Execution already in progress with a different key");
    // Optimistic claim: only one caller can move idempotencyKey from null to a value.
    const { count } = await tx.refundRequest.updateMany({
      where: { id, status: "APPROVED", idempotencyKey: null },
      data: { idempotencyKey },
    });
    if (count !== 1) throw new Error("Execution already claimed by a concurrent request");
    const claimed = { ...refund, idempotencyKey };
    await audit(tx, { actor: user.id, app: APP, entity: ENTITY, entityId: id, action: "REFUND_EXECUTION_STARTED", before: refund, after: claimed, requestId });
    return { refund: claimed, replay: false as const };
  });
  if (claim.replay) return claim.refund;

  const refund = claim.refund;
  let outcome: { status: "EXECUTED"; externalRef: string } | { status: "FAILED"; error: string };
  try {
    const res = await fakePayments.refund({ amountCents: refund.amountCents, currency: refund.currency, idempotencyKey });
    outcome = { status: "EXECUTED", externalRef: res.externalRef };
  } catch (e) {
    outcome = { status: "FAILED", error: e instanceof Error ? e.message : String(e) };
  }

  return prisma.$transaction(async (tx) => {
    const after = await tx.refundRequest.update({
      where: { id },
      data:
        outcome.status === "EXECUTED"
          ? { status: "EXECUTED", externalRef: outcome.externalRef }
          : { status: "FAILED", decisionNote: appendNote(refund.decisionNote, `Execution failed: ${outcome.error}`) },
    });
    await audit(tx, { actor: user.id, app: APP, entity: ENTITY, entityId: id, action: `REFUND_${outcome.status}`, before: refund, after, requestId });
    return after;
  });
}

function appendNote(existing: string | null, line: string) {
  return existing ? `${existing}\n${line}` : line;
}

function validateCreate(input: CreateRefundInput) {
  if (!input.customerRef.trim()) throw new Error("customerRef is required");
  if (!input.orderRef.trim()) throw new Error("orderRef is required");
  if (!input.reason.trim()) throw new Error("reason is required");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error("amountCents must be a positive integer");
  if (!/^[A-Za-z]{3}$/.test(input.currency)) throw new Error("currency must be a 3-letter code");
}

export type RefundDetail = NonNullable<Awaited<ReturnType<typeof getRefund>>>;
export type Db = Prisma.TransactionClient;
