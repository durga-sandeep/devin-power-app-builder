import type { Prisma } from "@prisma/client";

/**
 * Append-only audit log. The only exported operation is `audit()` (an insert). There is
 * deliberately no update or delete helper, and no app may mutate AuditEvent rows directly.
 */
export type AuditInput = {
  actor: string;
  app: string;
  entity: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  requestId: string;
};

/** Writes one AuditEvent inside the caller's transaction so the audit row and the mutation commit together. */
export async function audit(tx: Prisma.TransactionClient, event: AuditInput) {
  return tx.auditEvent.create({
    data: {
      actor: event.actor,
      app: event.app,
      entity: event.entity,
      entityId: event.entityId,
      action: event.action,
      before: toJson(event.before),
      after: toJson(event.after),
      requestId: event.requestId,
    },
  });
}

/** Read side, for status timelines. Oldest first. */
export async function auditTrail(
  db: Prisma.TransactionClient,
  where: { app: string; entity: string; entityId: string },
) {
  return db.auditEvent.findMany({ where, orderBy: { at: "asc" } });
}

export function newRequestId() {
  return crypto.randomUUID();
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull | undefined {
  if (value === undefined || value === null) return undefined;
  // Round-trip through JSON so Dates/Decimals/undefined become plain JSON values.
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
