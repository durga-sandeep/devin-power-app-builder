import { PrismaClient } from "@prisma/client";

export const SEED_USERS = [
  { id: "user_viewer", name: "Vera Viewer", email: "vera@example.com", role: "viewer" },
  { id: "user_maker", name: "Mark Maker", email: "mark@example.com", role: "maker" },
  { id: "user_checker", name: "Chloe Checker", email: "chloe@example.com", role: "checker" },
  { id: "user_admin", name: "Ada Admin", email: "ada@example.com", role: "admin" },
] as const;

type SeedRefund = {
  customerRef: string;
  orderRef: string;
  amountCents: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED" | "FAILED";
  decidedBy?: "user_checker" | "user_admin";
  decisionNote?: string;
};

// 12 refunds: all statuses, one > $5,000 (admin-only approval), one ending in .13 (fails on execute).
export const SEED_REFUNDS: SeedRefund[] = [
  { customerRef: "cus_1001", orderRef: "ord_7001", amountCents: 4999, reason: "Item arrived damaged", status: "PENDING" },
  { customerRef: "cus_1002", orderRef: "ord_7002", amountCents: 12_500, reason: "Duplicate charge", status: "PENDING" },
  { customerRef: "cus_1003", orderRef: "ord_7003", amountCents: 750_000, reason: "Cancelled enterprise order", status: "PENDING" },
  { customerRef: "cus_1004", orderRef: "ord_7004", amountCents: 8_913, reason: "Wrong size shipped", status: "APPROVED", decidedBy: "user_checker" },
  { customerRef: "cus_1005", orderRef: "ord_7005", amountCents: 2_000, reason: "Promo code not applied", status: "APPROVED", decidedBy: "user_checker", decisionNote: "Verified promo in CRM" },
  { customerRef: "cus_1006", orderRef: "ord_7006", amountCents: 30_000, reason: "Service outage credit", status: "APPROVED", decidedBy: "user_admin" },
  { customerRef: "cus_1007", orderRef: "ord_7007", amountCents: 15_999, reason: "Changed mind after delivery", status: "REJECTED", decidedBy: "user_checker", decisionNote: "Outside 30-day window" },
  { customerRef: "cus_1008", orderRef: "ord_7008", amountCents: 999, reason: "Late delivery", status: "REJECTED", decidedBy: "user_admin", decisionNote: "Delivered on time per carrier" },
  { customerRef: "cus_1009", orderRef: "ord_7009", amountCents: 6_450, reason: "Missing accessory", status: "EXECUTED", decidedBy: "user_checker" },
  { customerRef: "cus_1010", orderRef: "ord_7010", amountCents: 22_000, reason: "Subscription cancelled in trial", status: "EXECUTED", decidedBy: "user_admin" },
  { customerRef: "cus_1011", orderRef: "ord_7011", amountCents: 1_200, reason: "Overcharged shipping", status: "EXECUTED", decidedBy: "user_checker" },
  { customerRef: "cus_1012", orderRef: "ord_7012", amountCents: 4_713, reason: "Defective unit", status: "FAILED", decidedBy: "user_checker", decisionNote: "Execution failed: Provider declined: amount ends in .13 (simulated failure)" },
];

export async function seedUsers(prisma: PrismaClient) {
  for (const u of SEED_USERS) {
    await prisma.user.upsert({ where: { id: u.id }, update: u, create: u });
  }
}

/** Creates refunds with the approval rows and audit trail the real actions would have produced. */
export async function seedRefunds(prisma: PrismaClient) {
  if ((await prisma.refundRequest.count()) > 0) return;
  const app = "refunds";
  const entity = "RefundRequest";
  let t = Date.now() - SEED_REFUNDS.length * 36e5;
  for (const r of SEED_REFUNDS) {
    const createdAt = new Date((t += 36e5));
    const decided = r.status !== "PENDING";
    const decision = r.status === "REJECTED" ? "REJECTED" : "APPROVED";
    const requestId = crypto.randomUUID();
    await prisma.$transaction(async (tx) => {
      const refund = await tx.refundRequest.create({
        data: {
          customerRef: r.customerRef,
          orderRef: r.orderRef,
          amountCents: r.amountCents,
          currency: "USD",
          reason: r.reason,
          status: r.status,
          createdBy: "user_maker",
          createdAt,
          decidedBy: decided ? r.decidedBy : null,
          decidedAt: decided ? new Date(createdAt.getTime() + 6e5) : null,
          decisionNote: r.decisionNote ?? null,
          idempotencyKey: r.status === "EXECUTED" || r.status === "FAILED" ? crypto.randomUUID() : null,
          externalRef: r.status === "EXECUTED" ? `fake_seed_${r.orderRef}` : null,
          executionStartedAt: r.status === "EXECUTED" || r.status === "FAILED" ? new Date(createdAt.getTime() + 9e5) : null,
        },
      });
      const pending = { ...refund, status: "PENDING", decidedBy: null, decidedAt: null, decisionNote: null, idempotencyKey: null, externalRef: null, executionStartedAt: null };
      await tx.auditEvent.create({
        data: { at: createdAt, actor: "user_maker", app, entity, entityId: refund.id, action: "REFUND_CREATED", after: pending, requestId },
      });
      const approval = await tx.approvalRequest.create({
        data: {
          app,
          entity,
          entityId: refund.id,
          action: "APPROVE_REFUND",
          payload: { amountCents: r.amountCents, currency: "USD" },
          requestedBy: "user_maker",
          requestedAt: createdAt,
          status: decided ? decision : "PENDING",
          decidedBy: decided ? r.decidedBy : null,
          decidedAt: refund.decidedAt,
          note: r.status === "FAILED" ? null : r.decisionNote ?? null,
        },
      });
      const pendingApproval = { ...approval, status: "PENDING", decidedBy: null, decidedAt: null, note: null };
      await tx.auditEvent.create({
        data: { at: createdAt, actor: "user_maker", app, entity: "ApprovalRequest", entityId: approval.id, action: "APPROVAL_REQUESTED", after: pendingApproval, requestId },
      });
      if (decided && refund.decidedAt) {
        const decidedState = { ...pending, status: decision, decidedBy: refund.decidedBy, decidedAt: refund.decidedAt, decisionNote: r.status === "FAILED" ? null : refund.decisionNote };
        await tx.auditEvent.createMany({
          data: [
            { at: refund.decidedAt, actor: refund.decidedBy!, app, entity: "ApprovalRequest", entityId: approval.id, action: `APPROVAL_${decision}`, before: pendingApproval, after: approval, requestId: crypto.randomUUID() },
            { at: refund.decidedAt, actor: refund.decidedBy!, app, entity, entityId: refund.id, action: `REFUND_${decision}`, before: pending, after: decidedState, requestId: crypto.randomUUID() },
          ],
        });
        if (r.status === "EXECUTED" || r.status === "FAILED") {
          const execAt = new Date(refund.decidedAt.getTime() + 3e5);
          const execRequestId = crypto.randomUUID();
          await tx.auditEvent.createMany({
            data: [
              { at: execAt, actor: refund.decidedBy!, app, entity, entityId: refund.id, action: "REFUND_EXECUTION_STARTED", before: decidedState, after: { ...decidedState, status: "EXECUTING", idempotencyKey: refund.idempotencyKey, executionStartedAt: execAt }, requestId: execRequestId },
              { at: new Date(execAt.getTime() + 1000), actor: refund.decidedBy!, app, entity, entityId: refund.id, action: `REFUND_${r.status}`, before: { ...decidedState, status: "EXECUTING", idempotencyKey: refund.idempotencyKey, executionStartedAt: execAt }, after: refund, requestId: execRequestId },
            ],
          });
        }
      }
    });
  }
}

type Pair = [enabled: boolean, rolloutPercent: number];
type SeedFlag = {
  key: string;
  description: string;
  owner: string;
  staging: Pair;
  production: Pair;
  /** Proposed production change still awaiting a decision. */
  pending?: Pair;
  emergency?: string;
  archived?: boolean;
};

// 10 flags: mixed states, two pending production changes, one emergency-disabled, one archived.
export const SEED_FLAGS: SeedFlag[] = [
  { key: "new-checkout-flow", description: "Single-page checkout with saved cards", owner: "payments-team", staging: [true, 100], production: [true, 25], pending: [true, 50] },
  { key: "instant-payouts", description: "Same-day merchant payouts via RTP", owner: "payouts-team", staging: [true, 100], production: [false, 0], pending: [true, 10] },
  { key: "dark-mode", description: "Dark theme in the customer dashboard", owner: "web-team", staging: [true, 100], production: [true, 100] },
  { key: "card-freeze-v2", description: "Self-service card freeze with reason codes", owner: "cards-team", staging: [true, 50], production: [false, 0] },
  { key: "fx-rate-cache", description: "Cache FX quotes for 30s to cut provider calls", owner: "platform-team", staging: [true, 100], production: [true, 100] },
  { key: "kyc-doc-autoverify", description: "Auto-verify passport scans under the risk threshold", owner: "risk-team", staging: [true, 20], production: [false, 0] },
  { key: "sepa-instant", description: "SEPA Instant credit transfers", owner: "payments-team", staging: [true, 100], production: [true, 100], emergency: "Bank partner reporting duplicate credits" },
  { key: "referral-bonus-2025", description: "2025 referral bonus campaign banner", owner: "growth-team", staging: [false, 0], production: [true, 100], archived: true },
  { key: "smart-retry-ach", description: "Retry failed ACH debits on the predicted best day", owner: "payments-team", staging: [false, 30], production: [false, 0] },
  { key: "statement-pdf-redesign", description: "New monthly statement PDF layout", owner: "web-team", staging: [true, 100], production: [true, 5] },
];

/** Creates flags with the approval rows and audit trail the real actions would have produced. */
export async function seedFeatureFlags(prisma: PrismaClient) {
  if ((await prisma.featureFlag.count()) > 0) return;
  const app = "feature-flags";
  const maker = "user_maker";
  const checker = "user_checker";
  const admin = "user_admin";
  let t = Date.now() - SEED_FLAGS.length * 6 * 36e5;
  const at = (minutes = 10) => new Date((t += minutes * 6e4));
  const differs = (a: { enabled: boolean; rolloutPercent: number }, [enabled, rolloutPercent]: Pair) =>
    a.enabled !== enabled || a.rolloutPercent !== rolloutPercent;

  for (const f of SEED_FLAGS) {
    t += 4 * 36e5;
    await prisma.$transaction(async (tx) => {
      const createdAt = at(0);
      const flag = await tx.featureFlag.create({
        data: {
          key: f.key,
          description: f.description,
          owner: f.owner,
          createdBy: maker,
          createdAt,
          states: { create: ["staging", "production"].map((environment) => ({ environment, updatedBy: maker, updatedAt: createdAt })) },
        },
        include: { states: true },
      });
      await tx.auditEvent.create({ data: { at: createdAt, actor: maker, app, entity: "FeatureFlag", entityId: flag.id, action: "FLAG_CREATED", after: flag, requestId: crypto.randomUUID() } });
      let staging = flag.states.find((s) => s.environment === "staging")!;
      let prod = flag.states.find((s) => s.environment === "production")!;

      if (differs(staging, f.staging)) {
        const before = staging;
        staging = await tx.flagState.update({ where: { id: staging.id }, data: { enabled: f.staging[0], rolloutPercent: f.staging[1], updatedBy: maker, updatedAt: at() } });
        await tx.auditEvent.create({ data: { at: staging.updatedAt, actor: maker, app, entity: "FlagState", entityId: staging.id, action: "FLAG_STATE_CHANGED", before, after: staging, requestId: crypto.randomUUID() } });
      }

      const propose = async (to: Pair) => {
        const requestedAt = at();
        const approval = await tx.approvalRequest.create({
          data: {
            app, entity: "FlagState", entityId: prod.id, action: "CHANGE_PRODUCTION_STATE", requestedBy: maker, requestedAt,
            payload: { flagKey: f.key, environment: "production", from: { enabled: prod.enabled, rolloutPercent: prod.rolloutPercent }, to: { enabled: to[0], rolloutPercent: to[1] } },
          },
        });
        await tx.auditEvent.create({ data: { at: requestedAt, actor: maker, app, entity: "ApprovalRequest", entityId: approval.id, action: "APPROVAL_REQUESTED", after: approval, requestId: crypto.randomUUID() } });
        return approval;
      };

      if (differs(prod, f.production)) {
        const approval = await propose(f.production);
        const decidedAt = at();
        const decided = await tx.approvalRequest.update({ where: { id: approval.id }, data: { status: "APPROVED", decidedBy: checker, decidedAt } });
        const requestId = crypto.randomUUID();
        await tx.auditEvent.create({ data: { at: decidedAt, actor: checker, app, entity: "ApprovalRequest", entityId: approval.id, action: "APPROVAL_APPROVED", before: approval, after: decided, requestId } });
        const before = prod;
        prod = await tx.flagState.update({ where: { id: prod.id }, data: { enabled: f.production[0], rolloutPercent: f.production[1], updatedBy: checker, updatedAt: decidedAt } });
        await tx.auditEvent.create({ data: { at: decidedAt, actor: checker, app, entity: "FlagState", entityId: prod.id, action: "FLAG_STATE_CHANGED", before, after: prod, requestId } });
      }

      if (f.emergency) {
        const before = prod;
        prod = await tx.flagState.update({ where: { id: prod.id }, data: { enabled: false, rolloutPercent: 0, updatedBy: admin, updatedAt: at(60) } });
        await tx.auditEvent.create({ data: { at: prod.updatedAt, actor: admin, app, entity: "FlagState", entityId: prod.id, action: "EMERGENCY_DISABLE", before, after: { ...prod, reason: f.emergency }, requestId: crypto.randomUUID() } });
      }

      if (f.pending) {
        const approval = await propose(f.pending);
        prod = await tx.flagState.update({ where: { id: prod.id }, data: { pendingApprovalId: approval.id } });
      }

      if (f.archived) {
        const archivedAt = at(60 * 24);
        const { states: _states, ...before } = flag;
        void _states;
        const after = await tx.featureFlag.update({ where: { id: flag.id }, data: { archivedAt, archivedBy: admin } });
        await tx.auditEvent.create({ data: { at: archivedAt, actor: admin, app, entity: "FeatureFlag", entityId: flag.id, action: "FLAG_ARCHIVED", before, after, requestId: crypto.randomUUID() } });
      }
    });
  }
}

export async function seed(prisma: PrismaClient) {
  await seedUsers(prisma);
  await seedRefunds(prisma);
  await seedFeatureFlags(prisma);
}

if (process.argv[1]?.endsWith("seed.ts")) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then(() => console.log("Seeded."))
    .finally(() => prisma.$disconnect());
}
