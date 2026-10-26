import type { Prisma } from "@prisma/client";
import { audit } from "./audit";
import { ForbiddenError } from "./auth";

export type Decision = "APPROVED" | "REJECTED";

type Actor = { id: string };

/**
 * Maker side of maker-checker: records that `requester` wants `action` done on an entity.
 * Audited in the same transaction. The app decides which actions are sensitive.
 */
export async function requestApproval(
  tx: Prisma.TransactionClient,
  input: {
    app: string;
    entity: string;
    entityId: string;
    action: string;
    requester: Actor;
    payload?: unknown;
    requestId: string;
  },
) {
  const approval = await tx.approvalRequest.create({
    data: {
      app: input.app,
      entity: input.entity,
      entityId: input.entityId,
      action: input.action,
      payload: input.payload === undefined ? undefined : (JSON.parse(JSON.stringify(input.payload)) as Prisma.InputJsonValue),
      requestedBy: input.requester.id,
    },
  });
  await audit(tx, {
    actor: input.requester.id,
    app: input.app,
    entity: "ApprovalRequest",
    entityId: approval.id,
    action: "APPROVAL_REQUESTED",
    after: approval,
    requestId: input.requestId,
  });
  return approval;
}

/**
 * Checker side. Enforces, server-side, that the decider is not the requester and that the
 * request is still PENDING. Role checks (who may decide at all) are the caller's job via
 * requireRole(); this function only knows the maker≠checker rule.
 */
export async function decide(
  tx: Prisma.TransactionClient,
  input: { approvalId: string; decider: Actor; decision: Decision; note?: string; requestId: string },
) {
  const before = await tx.approvalRequest.findUnique({ where: { id: input.approvalId } });
  if (!before) throw new Error("Approval request not found");
  if (before.status !== "PENDING") throw new Error(`Approval request is already ${before.status}`);
  if (before.requestedBy === input.decider.id) {
    throw new ForbiddenError("Maker-checker: you cannot decide on your own request");
  }
  const after = await tx.approvalRequest.update({
    where: { id: before.id },
    data: {
      status: input.decision,
      decidedBy: input.decider.id,
      decidedAt: new Date(),
      note: input.note?.trim() || null,
    },
  });
  await audit(tx, {
    actor: input.decider.id,
    app: before.app,
    entity: "ApprovalRequest",
    entityId: before.id,
    action: `APPROVAL_${input.decision}`,
    before,
    after,
    requestId: input.requestId,
  });
  return after;
}

/**
 * System-initiated cancellation: rejects a PENDING request because another action (an emergency
 * disable, an archive) made it moot. Not a maker-checker decision, so the actor may be the requester;
 * role checks are the caller's job. Records status REJECTED, the actor as decider, the note, and an
 * APPROVAL_REJECTED audit row in the caller's transaction. Returns null, writing nothing, if the
 * request is no longer PENDING.
 */
export async function supersede(
  tx: Prisma.TransactionClient,
  approvalId: string,
  note: string,
  by: { actor: Actor; requestId: string },
) {
  const reason = note.trim();
  if (!reason) throw new Error("A note is required to supersede an approval request");
  const before = await tx.approvalRequest.findUnique({ where: { id: approvalId } });
  if (!before) throw new Error("Approval request not found");
  const { count } = await tx.approvalRequest.updateMany({
    where: { id: approvalId, status: "PENDING" },
    data: { status: "REJECTED", decidedBy: by.actor.id, decidedAt: new Date(), note: reason },
  });
  if (count !== 1) return null;
  const after = await tx.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } });
  await audit(tx, {
    actor: by.actor.id,
    app: before.app,
    entity: "ApprovalRequest",
    entityId: approvalId,
    action: "APPROVAL_REJECTED",
    before,
    after,
    requestId: by.requestId,
  });
  return after;
}

export async function pendingApprovalFor(
  db: Prisma.TransactionClient,
  where: { app: string; entity: string; entityId: string },
) {
  return db.approvalRequest.findFirst({ where: { ...where, status: "PENDING" } });
}
