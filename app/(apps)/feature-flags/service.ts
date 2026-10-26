import { Prisma, type FeatureFlag, type FlagState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireRole, type CurrentUser, type Role } from "@/lib/platform/auth";
import { audit, newRequestId } from "@/lib/platform/audit";
import { decide, requestApproval, type Decision } from "@/lib/platform/approvals";

export const APP = "feature-flags";
export const ENVIRONMENTS = ["staging", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
export const PROD_CHANGE_ACTION = "CHANGE_PRODUCTION_STATE";
export const SUPERSEDED_BY_EMERGENCY = "superseded by emergency disable";
export const SUPERSEDED_BY_ARCHIVE = "superseded by archive";

const VIEWERS: Role[] = ["viewer", "maker", "checker", "admin"];
/** Create flags, change staging, propose production changes. */
export const EDITORS: Role[] = ["maker", "admin"];
/** Approve or reject production changes (never their own: decide() enforces that). */
export const DECIDERS: Role[] = ["checker", "admin"];

const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Collide with static routes under /feature-flags. */
const RESERVED_KEYS = new Set(["new"]);

export type StateChange = { enabled: boolean; rolloutPercent: number };
export type ProdChangePayload = { flagKey: string; environment: "production"; from: StateChange; to: StateChange };
export type CreateFlagInput = { key: string; description: string; owner: string };
type Tx = Prisma.TransactionClient;
type FlagWithStates = FeatureFlag & { states: FlagState[] };

export function validateState(change: StateChange) {
  const { enabled, rolloutPercent } = change;
  if (typeof enabled !== "boolean") throw new Error("enabled must be true or false");
  if (!Number.isInteger(rolloutPercent) || rolloutPercent < 0 || rolloutPercent > 100) {
    throw new Error("rolloutPercent must be a whole number from 0 to 100");
  }
  if (enabled && rolloutPercent === 0) {
    throw new Error("An enabled flag needs rolloutPercent above 0 (to turn it off, set enabled to false)");
  }
}

export function stateOf(flag: FlagWithStates, env: Environment): FlagState {
  const state = flag.states.find((s) => s.environment === env);
  if (!state) throw new Error(`Flag ${flag.key} has no ${env} state`);
  return state;
}

/** Cosmetic helper for the UI. The real checks are in the mutations below. */
export function permissions(user: CurrentUser, flag: FlagWithStates) {
  const live = !flag.archivedAt;
  const editor = EDITORS.includes(user.role);
  return {
    canChangeStaging: live && editor,
    canProposeProduction: live && editor && !stateOf(flag, "production").pendingApprovalId,
    canDecide: DECIDERS.includes(user.role),
    canKill: live && user.role === "admin",
    canArchive: live && user.role === "admin",
  };
}

export async function listFlags() {
  await requireRole(...VIEWERS);
  return prisma.featureFlag.findMany({ include: { states: true }, orderBy: [{ archivedAt: "asc" }, { key: "asc" }] });
}

export async function getFlag(key: string) {
  await requireRole(...VIEWERS);
  const flag = await prisma.featureFlag.findUnique({ where: { key }, include: { states: true } });
  if (!flag) return null;
  const stateIds = flag.states.map((s) => s.id);
  const approvals = await prisma.approvalRequest.findMany({
    where: { app: APP, entity: "FlagState", entityId: { in: stateIds } },
    orderBy: { requestedAt: "desc" },
  });
  const [history, users] = await Promise.all([
    prisma.auditEvent.findMany({
      where: {
        app: APP,
        OR: [
          { entity: "FeatureFlag", entityId: flag.id },
          { entity: "FlagState", entityId: { in: stateIds } },
          { entity: "ApprovalRequest", entityId: { in: approvals.map((a) => a.id) } },
        ],
      },
      orderBy: { at: "desc" },
    }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  return { flag, approvals, pending: approvals.filter((a) => a.status === "PENDING"), history, names };
}

export async function createFlag(input: CreateFlagInput) {
  const user = await requireRole(...EDITORS);
  const key = input.key.trim();
  const description = input.description.trim();
  const owner = input.owner.trim();
  if (!KEY_PATTERN.test(key)) throw new Error("key must be kebab-case: lowercase letters, digits and single dashes");
  if (RESERVED_KEYS.has(key)) throw new Error(`"${key}" is reserved`);
  if (!description) throw new Error("description is required");
  if (!owner) throw new Error("owner is required");
  const requestId = newRequestId();
  try {
    return await prisma.$transaction(async (tx) => {
      const flag = await tx.featureFlag.create({
        data: {
          key,
          description,
          owner,
          createdBy: user.id,
          states: { create: ENVIRONMENTS.map((environment) => ({ environment, enabled: false, rolloutPercent: 0, updatedBy: user.id })) },
        },
        include: { states: true },
      });
      await audit(tx, { actor: user.id, app: APP, entity: "FeatureFlag", entityId: flag.id, action: "FLAG_CREATED", after: flag, requestId });
      return flag;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new Error(`A flag with key "${key}" already exists`);
    }
    throw e;
  }
}

/** Staging is not sensitive: applied immediately, audited. */
export async function changeStaging(key: string, change: StateChange) {
  const user = await requireRole(...EDITORS);
  validateState(change);
  const requestId = newRequestId();
  return prisma.$transaction(async (tx) => {
    const flag = await loadLiveFlag(tx, key);
    const before = stateOf(flag, "staging");
    assertChanged(before, change);
    // Optimistic: the row must still be what we read (and the flag still live), so the audit `before` is exact.
    const { count } = await tx.flagState.updateMany({
      where: { id: before.id, updatedAt: before.updatedAt, flag: { archivedAt: null } },
      data: { ...change, updatedBy: user.id, updatedAt: new Date() },
    });
    if (count !== 1) throw new Error("This flag changed while you were editing; reload and try again");
    const after = await tx.flagState.findUniqueOrThrow({ where: { id: before.id } });
    await audit(tx, { actor: user.id, app: APP, entity: "FlagState", entityId: after.id, action: "FLAG_STATE_CHANGED", before, after, requestId });
    return after;
  });
}

/** Production changes (enabled and/or rollout) are proposed and need a checker/admin decision. */
export async function proposeProductionChange(key: string, change: StateChange) {
  const user = await requireRole(...EDITORS);
  validateState(change);
  const requestId = newRequestId();
  return prisma.$transaction(async (tx) => {
    const flag = await loadLiveFlag(tx, key);
    const state = stateOf(flag, "production");
    if (state.pendingApprovalId) throw new Error("A production change for this flag is already awaiting approval");
    assertChanged(state, change);
    const payload: ProdChangePayload = {
      flagKey: flag.key,
      environment: "production",
      from: { enabled: state.enabled, rolloutPercent: state.rolloutPercent },
      to: { enabled: change.enabled, rolloutPercent: change.rolloutPercent },
    };
    const approval = await requestApproval(tx, {
      app: APP,
      entity: "FlagState",
      entityId: state.id,
      action: PROD_CHANGE_ACTION,
      requester: user,
      payload,
      requestId,
    });
    // Atomic claim: at most one pending production change per flag, even under concurrent proposals.
    const { count } = await tx.flagState.updateMany({
      where: { id: state.id, pendingApprovalId: null, flag: { archivedAt: null } },
      data: { pendingApprovalId: approval.id },
    });
    if (count !== 1) throw new Error("A production change for this flag is already awaiting approval");
    return approval;
  });
}

/** Checker side. Approving applies the proposed state in the same transaction as the decision. */
export async function decideProductionChange(approvalId: string, decision: Decision, note?: string) {
  const user = await requireRole(...DECIDERS);
  const requestId = newRequestId();
  return prisma.$transaction(async (tx) => {
    const approval = await tx.approvalRequest.findUnique({ where: { id: approvalId } });
    if (!approval || approval.app !== APP || approval.action !== PROD_CHANGE_ACTION) throw new Error("Approval request not found");
    const before = await tx.flagState.findUniqueOrThrow({ where: { id: approval.entityId } });
    const decided = await decide(tx, { approvalId, decider: user, decision, note, requestId });
    const to = (approval.payload as ProdChangePayload).to;
    if (decision === "APPROVED") validateState(to);
    const { count } = await tx.flagState.updateMany({
      where: { id: before.id, pendingApprovalId: approval.id },
      data:
        decision === "APPROVED"
          ? { enabled: to.enabled, rolloutPercent: to.rolloutPercent, updatedBy: user.id, updatedAt: new Date(), pendingApprovalId: null }
          : { pendingApprovalId: null },
    });
    if (count !== 1) throw new Error("This change is no longer pending");
    if (decision === "APPROVED") {
      const after = await tx.flagState.findUniqueOrThrow({ where: { id: before.id } });
      await audit(tx, { actor: user.id, app: APP, entity: "FlagState", entityId: after.id, action: "FLAG_STATE_CHANGED", before, after, requestId });
    }
    return decided;
  });
}

/**
 * Emergency off for production: admin only, no approval, reason required. Supersedes (auto-rejects)
 * a pending production change. On an archived flag it is a no-op and returns null.
 */
export async function killSwitch(key: string, reason: string) {
  const user = await requireRole("admin");
  const why = reason.trim();
  if (!why) throw new Error("A reason is required for an emergency disable");
  const requestId = newRequestId();
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await prisma.$transaction(async (tx) => {
      const flag = await tx.featureFlag.findUnique({ where: { key }, include: { states: true } });
      if (!flag) throw new Error("Flag not found");
      if (flag.archivedAt) return { done: true as const, state: null };
      const before = stateOf(flag, "production");
      const { count } = await tx.flagState.updateMany({
        where: { id: before.id, updatedAt: before.updatedAt, pendingApprovalId: before.pendingApprovalId },
        data: { enabled: false, rolloutPercent: 0, updatedBy: user.id, updatedAt: new Date(), pendingApprovalId: null },
      });
      if (count !== 1) return { done: false as const, state: null };
      if (before.pendingApprovalId) await supersede(tx, before.pendingApprovalId, user, SUPERSEDED_BY_EMERGENCY, requestId);
      const after = await tx.flagState.findUniqueOrThrow({ where: { id: before.id } });
      await audit(tx, {
        actor: user.id,
        app: APP,
        entity: "FlagState",
        entityId: after.id,
        action: "EMERGENCY_DISABLE",
        before,
        after: { ...after, reason: why },
        requestId,
      });
      return { done: true as const, state: after };
    });
    if (result.done) return result.state;
  }
  throw new Error("The production state kept changing underneath the kill switch; try again");
}

/** Admin only. Archived flags are read-only; a pending production change is superseded. */
export async function archiveFlag(key: string) {
  const user = await requireRole("admin");
  const requestId = newRequestId();
  return prisma.$transaction(async (tx) => {
    const before = await tx.featureFlag.findUnique({ where: { key } });
    if (!before) throw new Error("Flag not found");
    // Archive first so a concurrent proposal's claim (which requires archivedAt = null) cannot slip in after.
    const { count } = await tx.featureFlag.updateMany({
      where: { id: before.id, archivedAt: null },
      data: { archivedAt: new Date(), archivedBy: user.id },
    });
    if (count !== 1) throw new Error("Flag is already archived");
    const after = await tx.featureFlag.findUniqueOrThrow({ where: { id: before.id }, include: { states: true } });
    for (const state of after.states) {
      if (!state.pendingApprovalId) continue;
      await tx.flagState.update({ where: { id: state.id }, data: { pendingApprovalId: null } });
      await supersede(tx, state.pendingApprovalId, user, SUPERSEDED_BY_ARCHIVE, requestId);
    }
    await audit(tx, { actor: user.id, app: APP, entity: "FeatureFlag", entityId: after.id, action: "FLAG_ARCHIVED", before, after: { ...after, states: undefined }, requestId });
    return after;
  });
}

/**
 * Auto-rejects a pending approval because an admin action made it moot. Not a maker-checker decision,
 * so it does not go through decide() (which would refuse when the admin is also the proposer); it is
 * recorded the same way: status REJECTED, decider, note, and an APPROVAL_REJECTED audit row.
 */
async function supersede(tx: Tx, approvalId: string, actor: CurrentUser, note: string, requestId: string) {
  const before = await tx.approvalRequest.findUnique({ where: { id: approvalId } });
  if (!before || before.status !== "PENDING") return;
  const { count } = await tx.approvalRequest.updateMany({
    where: { id: approvalId, status: "PENDING" },
    data: { status: "REJECTED", decidedBy: actor.id, decidedAt: new Date(), note },
  });
  if (count !== 1) return;
  const after = await tx.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } });
  await audit(tx, { actor: actor.id, app: APP, entity: "ApprovalRequest", entityId: approvalId, action: "APPROVAL_REJECTED", before, after, requestId });
}

async function loadLiveFlag(tx: Tx, key: string) {
  const flag = await tx.featureFlag.findUnique({ where: { key }, include: { states: true } });
  if (!flag) throw new Error("Flag not found");
  if (flag.archivedAt) throw new Error("Flag is archived and read-only");
  return flag;
}

function assertChanged(current: FlagState, change: StateChange) {
  if (current.enabled === change.enabled && current.rolloutPercent === change.rolloutPercent) {
    throw new Error("Nothing to change: that is already the current state");
  }
}

export type FlagDetail = NonNullable<Awaited<ReturnType<typeof getFlag>>>;
