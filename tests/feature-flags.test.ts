import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/platform/auth";
import {
  archiveFlag,
  changeStaging,
  createFlag,
  decideProductionChange,
  getFlag,
  killSwitch,
  listFlags,
  proposeProductionChange,
  SUPERSEDED_BY_ARCHIVE,
  SUPERSEDED_BY_EMERGENCY,
} from "@/app/(apps)/feature-flags/service";
import { parseStateChange } from "@/app/(apps)/feature-flags/format";
import { actAs, USERS } from "./helpers";

let n = 0;
const uniqueKey = () => `test-flag-${Date.now()}-${++n}`;

async function newFlag(as: "maker" | "admin" = "maker") {
  actAs(as);
  return createFlag({ key: uniqueKey(), description: "test flag", owner: "test-team" });
}

const prodState = (flagId: string) => prisma.flagState.findUniqueOrThrow({ where: { flagId_environment: { flagId, environment: "production" } } });
const stagingState = (flagId: string) => prisma.flagState.findUniqueOrThrow({ where: { flagId_environment: { flagId, environment: "staging" } } });
const events = (entity: string, entityId: string) =>
  prisma.auditEvent.findMany({ where: { app: "feature-flags", entity, entityId }, orderBy: { at: "asc" } });

async function expect403(p: Promise<unknown>) {
  const err = (await p.catch((e: unknown) => e)) as ForbiddenError;
  expect(err).toBeInstanceOf(ForbiddenError);
  expect(err.status).toBe(403);
}

describe("list/view", () => {
  it("every role can list and view; logged-out gets 401", async () => {
    for (const role of ["viewer", "maker", "checker", "admin"] as const) {
      actAs(role);
      expect((await listFlags()).length).toBeGreaterThanOrEqual(10);
      await expect(getFlag("dark-mode")).resolves.toMatchObject({ flag: { key: "dark-mode" } });
    }
    actAs(null);
    await expect(listFlags()).rejects.toMatchObject({ status: 401 });
  });
});

describe("create", () => {
  it("maker creates a flag with both environments OFF/0 and a FLAG_CREATED audit row", async () => {
    const flag = await newFlag();
    expect(flag).toMatchObject({ createdBy: USERS.maker, archivedAt: null });
    expect(flag.states.map((s) => [s.environment, s.enabled, s.rolloutPercent]).sort()).toEqual([
      ["production", false, 0],
      ["staging", false, 0],
    ]);
    const t = await events("FeatureFlag", flag.id);
    expect(t.map((e) => e.action)).toEqual(["FLAG_CREATED"]);
    expect(t[0]).toMatchObject({ actor: USERS.maker, before: null, after: { id: flag.id, key: flag.key } });
  });

  it("admin may create; viewer and checker get 403 and nothing is written", async () => {
    await expect(newFlag("admin")).resolves.toMatchObject({ createdBy: USERS.admin });
    const before = await prisma.featureFlag.count();
    for (const role of ["viewer", "checker"] as const) {
      actAs(role);
      await expect403(createFlag({ key: uniqueKey(), description: "x", owner: "y" }));
    }
    expect(await prisma.featureFlag.count()).toBe(before);
  });

  it("rejects non-kebab-case, reserved and duplicate keys", async () => {
    actAs("maker");
    for (const key of ["Bad_Key", "trailing-", "double--dash", "has space", ""]) {
      await expect(createFlag({ key, description: "x", owner: "y" })).rejects.toThrow(/kebab-case/);
    }
    await expect(createFlag({ key: "new", description: "x", owner: "y" })).rejects.toThrow(/reserved/);
    await expect(createFlag({ key: "dark-mode", description: "x", owner: "y" })).rejects.toThrow(/already exists/);
  });
});

describe("staging", () => {
  it("maker changes staging immediately, audited with before/after", async () => {
    const flag = await newFlag();
    const after = await changeStaging(flag.key, { enabled: true, rolloutPercent: 40 });
    expect(after).toMatchObject({ enabled: true, rolloutPercent: 40, updatedBy: USERS.maker, pendingApprovalId: null });
    const t = await events("FlagState", after.id);
    expect(t.map((e) => e.action)).toEqual(["FLAG_STATE_CHANGED"]);
    expect(t[0]).toMatchObject({ actor: USERS.maker, before: { enabled: false, rolloutPercent: 0 }, after: { enabled: true, rolloutPercent: 40 } });
    expect(await prisma.approvalRequest.count({ where: { entityId: after.id } })).toBe(0);
  });

  it("viewer and checker get 403", async () => {
    const flag = await newFlag();
    for (const role of ["viewer", "checker"] as const) {
      actAs(role);
      await expect403(changeStaging(flag.key, { enabled: true, rolloutPercent: 10 }));
    }
    expect(await stagingState(flag.id)).toMatchObject({ enabled: false, rolloutPercent: 0 });
  });

  it("enabled with 0% is refused; disabled with a remembered percent is allowed; out of range and no-op are refused", async () => {
    const flag = await newFlag();
    await expect(changeStaging(flag.key, { enabled: true, rolloutPercent: 0 })).rejects.toThrow(/above 0/);
    await expect(changeStaging(flag.key, { enabled: true, rolloutPercent: 101 })).rejects.toThrow(/0 to 100/);
    await expect(changeStaging(flag.key, { enabled: true, rolloutPercent: 2.5 })).rejects.toThrow(/0 to 100/);
    await expect(changeStaging(flag.key, { enabled: false, rolloutPercent: 30 })).resolves.toMatchObject({ enabled: false, rolloutPercent: 30 });
    await expect(changeStaging(flag.key, { enabled: false, rolloutPercent: 30 })).rejects.toThrow(/Nothing to change/);
  });

  it("parses form input strictly", () => {
    expect(parseStateChange("true", "25")).toEqual({ enabled: true, rolloutPercent: 25 });
    expect(() => parseStateChange("yes", "25")).toThrow();
    expect(() => parseStateChange("true", "-1")).toThrow();
    expect(() => parseStateChange("true", "5.5")).toThrow();
  });
});

describe("production (maker-checker)", () => {
  async function proposed(to = { enabled: true, rolloutPercent: 10 }, as: "maker" | "admin" = "maker") {
    const flag = await newFlag(as);
    const approval = await proposeProductionChange(flag.key, to);
    return { flag, approval };
  }

  it("maker proposes: state unchanged, approval PENDING, claim set, APPROVAL_REQUESTED audited", async () => {
    const { flag, approval } = await proposed();
    expect(approval).toMatchObject({ status: "PENDING", requestedBy: USERS.maker, action: "CHANGE_PRODUCTION_STATE" });
    expect(await prodState(flag.id)).toMatchObject({ enabled: false, rolloutPercent: 0, pendingApprovalId: approval.id });
    const t = await events("ApprovalRequest", approval.id);
    expect(t.map((e) => e.action)).toEqual(["APPROVAL_REQUESTED"]);
    expect(t[0].after).toMatchObject({ payload: { from: { enabled: false, rolloutPercent: 0 }, to: { enabled: true, rolloutPercent: 10 } } });
  });

  it("viewer and checker cannot propose (403)", async () => {
    const flag = await newFlag();
    for (const role of ["viewer", "checker"] as const) {
      actAs(role);
      await expect403(proposeProductionChange(flag.key, { enabled: true, rolloutPercent: 10 }));
    }
    expect(await prisma.approvalRequest.count({ where: { entityId: (await prodState(flag.id)).id } })).toBe(0);
  });

  it("a second proposal is refused while one is pending, even concurrently", async () => {
    const { flag } = await proposed();
    await expect(proposeProductionChange(flag.key, { enabled: true, rolloutPercent: 20 })).rejects.toThrow(/already awaiting/);

    const other = await newFlag();
    const results = await Promise.allSettled([1, 2, 3].map((p) => proposeProductionChange(other.key, { enabled: true, rolloutPercent: p })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const state = await prodState(other.id);
    expect(await prisma.approvalRequest.count({ where: { entityId: state.id, status: "PENDING" } })).toBe(1);
  });

  it("staging changes never queue, even with a production change pending", async () => {
    const { flag } = await proposed();
    await expect(changeStaging(flag.key, { enabled: true, rolloutPercent: 100 })).resolves.toMatchObject({ enabled: true });
  });

  it("checker approves: production state applied, claim released, decision and change audited", async () => {
    const { flag, approval } = await proposed({ enabled: true, rolloutPercent: 25 });
    actAs("checker");
    await expect(decideProductionChange(approval.id, "APPROVED", "ship it")).resolves.toMatchObject({ status: "APPROVED", decidedBy: USERS.checker });
    const state = await prodState(flag.id);
    expect(state).toMatchObject({ enabled: true, rolloutPercent: 25, pendingApprovalId: null, updatedBy: USERS.checker });
    expect((await events("ApprovalRequest", approval.id)).map((e) => e.action)).toEqual(["APPROVAL_REQUESTED", "APPROVAL_APPROVED"]);
    const change = await events("FlagState", state.id);
    expect(change.map((e) => e.action)).toEqual(["FLAG_STATE_CHANGED"]);
    expect(change[0]).toMatchObject({ actor: USERS.checker, before: { enabled: false, rolloutPercent: 0 }, after: { enabled: true, rolloutPercent: 25 } });
  });

  it("checker rejects: production unchanged, claim released, a new proposal is allowed", async () => {
    const { flag, approval } = await proposed();
    actAs("checker");
    await decideProductionChange(approval.id, "REJECTED", "not this week");
    expect(await prodState(flag.id)).toMatchObject({ enabled: false, rolloutPercent: 0, pendingApprovalId: null });
    expect(await events("FlagState", (await prodState(flag.id)).id)).toHaveLength(0);
    actAs("maker");
    await expect(proposeProductionChange(flag.key, { enabled: true, rolloutPercent: 5 })).resolves.toMatchObject({ status: "PENDING" });
  });

  it("viewer and maker cannot decide (403)", async () => {
    const { flag, approval } = await proposed();
    for (const role of ["viewer", "maker"] as const) {
      actAs(role);
      await expect403(decideProductionChange(approval.id, "APPROVED"));
    }
    expect(await prodState(flag.id)).toMatchObject({ enabled: false, pendingApprovalId: approval.id });
  });

  it("the proposer can never approve their own change, even as admin; another admin-or-checker can", async () => {
    const { flag, approval } = await proposed({ enabled: true, rolloutPercent: 10 }, "admin");
    actAs("admin");
    const err = await decideProductionChange(approval.id, "APPROVED").catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toMatch(/own request/);
    expect(await prodState(flag.id)).toMatchObject({ enabled: false, pendingApprovalId: approval.id });
    actAs("checker");
    await expect(decideProductionChange(approval.id, "APPROVED")).resolves.toMatchObject({ status: "APPROVED" });
  });

  it("admin approves a change a maker proposed; it cannot be decided twice", async () => {
    const { approval } = await proposed();
    actAs("admin");
    await decideProductionChange(approval.id, "APPROVED");
    actAs("checker");
    await expect(decideProductionChange(approval.id, "REJECTED")).rejects.toThrow(/already APPROVED/);
  });

  it("concurrent approvals apply once", async () => {
    const { flag, approval } = await proposed({ enabled: true, rolloutPercent: 60 });
    actAs("checker");
    const results = await Promise.allSettled([decideProductionChange(approval.id, "APPROVED"), decideProductionChange(approval.id, "APPROVED")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await events("FlagState", (await prodState(flag.id)).id)).toHaveLength(1);
  });

  it("refuses non-feature-flag approval ids", async () => {
    const refundApproval = await prisma.approvalRequest.findFirstOrThrow({ where: { app: "refunds", status: "PENDING" } });
    actAs("checker");
    await expect(decideProductionChange(refundApproval.id, "APPROVED")).rejects.toThrow(/not found/);
  });
});

describe("kill switch", () => {
  async function liveInProd() {
    const flag = await newFlag();
    const approval = await proposeProductionChange(flag.key, { enabled: true, rolloutPercent: 80 });
    actAs("checker");
    await decideProductionChange(approval.id, "APPROVED");
    return flag;
  }

  it("admin disables production immediately without approval; EMERGENCY_DISABLE audited with reason", async () => {
    const flag = await liveInProd();
    actAs("admin");
    const after = await killSwitch(flag.key, "error rate spike");
    expect(after).toMatchObject({ enabled: false, rolloutPercent: 0, updatedBy: USERS.admin });
    const t = await events("FlagState", after!.id);
    expect(t.at(-1)).toMatchObject({
      action: "EMERGENCY_DISABLE",
      actor: USERS.admin,
      before: { enabled: true, rolloutPercent: 80 },
      after: { enabled: false, rolloutPercent: 0, reason: "error rate spike" },
    });
    expect(await stagingState(flag.id)).toMatchObject({ enabled: false, rolloutPercent: 0 });
  });

  it("maker, checker and viewer get 403; production stays on", async () => {
    const flag = await liveInProd();
    for (const role of ["viewer", "maker", "checker"] as const) {
      actAs(role);
      await expect403(killSwitch(flag.key, "x"));
    }
    expect(await prodState(flag.id)).toMatchObject({ enabled: true, rolloutPercent: 80 });
  });

  it("reason is required", async () => {
    const flag = await liveInProd();
    actAs("admin");
    await expect(killSwitch(flag.key, "   ")).rejects.toThrow(/reason/);
    expect(await prodState(flag.id)).toMatchObject({ enabled: true });
  });

  it("auto-rejects a pending production change with an audited 'superseded' rejection, even one the admin proposed", async () => {
    const flag = await liveInProd();
    actAs("admin");
    const approval = await proposeProductionChange(flag.key, { enabled: true, rolloutPercent: 100 });
    await killSwitch(flag.key, "incident 42");
    expect(await prisma.approvalRequest.findUnique({ where: { id: approval.id } })).toMatchObject({
      status: "REJECTED",
      decidedBy: USERS.admin,
      note: SUPERSEDED_BY_EMERGENCY,
    });
    const t = await events("ApprovalRequest", approval.id);
    expect(t.map((e) => e.action)).toEqual(["APPROVAL_REQUESTED", "APPROVAL_REJECTED"]);
    expect(t[1]).toMatchObject({ before: { status: "PENDING" }, after: { status: "REJECTED", note: SUPERSEDED_BY_EMERGENCY } });
    expect(await prodState(flag.id)).toMatchObject({ enabled: false, rolloutPercent: 0, pendingApprovalId: null });
    actAs("checker");
    await expect(decideProductionChange(approval.id, "APPROVED")).rejects.toThrow(/already REJECTED/);
  });

  it("is a no-op on an archived flag (no state change, no audit row)", async () => {
    actAs("admin");
    const state = await prisma.flagState.findFirstOrThrow({ where: { environment: "production", flag: { key: "referral-bonus-2025" } } });
    const before = await prisma.auditEvent.count({ where: { entityId: state.id } });
    await expect(killSwitch("referral-bonus-2025", "x")).resolves.toBeNull();
    expect(await prisma.flagState.findUniqueOrThrow({ where: { id: state.id } })).toMatchObject({ enabled: true, rolloutPercent: 100 });
    expect(await prisma.auditEvent.count({ where: { entityId: state.id } })).toBe(before);
  });
});

describe("archive", () => {
  it("admin archives: audited, read-only in both environments, pending change superseded", async () => {
    const flag = await newFlag();
    const approval = await proposeProductionChange(flag.key, { enabled: true, rolloutPercent: 10 });
    actAs("admin");
    const archived = await archiveFlag(flag.key);
    expect(archived).toMatchObject({ archivedBy: USERS.admin });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    const t = await events("FeatureFlag", flag.id);
    expect(t.at(-1)).toMatchObject({ action: "FLAG_ARCHIVED", before: { archivedAt: null }, after: { archivedBy: USERS.admin } });
    expect(await prisma.approvalRequest.findUnique({ where: { id: approval.id } })).toMatchObject({ status: "REJECTED", note: SUPERSEDED_BY_ARCHIVE });
    expect(await prodState(flag.id)).toMatchObject({ pendingApprovalId: null });

    actAs("maker");
    await expect(changeStaging(flag.key, { enabled: true, rolloutPercent: 10 })).rejects.toThrow(/archived/);
    await expect(proposeProductionChange(flag.key, { enabled: true, rolloutPercent: 10 })).rejects.toThrow(/archived/);
    actAs("admin");
    await expect(archiveFlag(flag.key)).rejects.toThrow(/already archived/);
  });

  it("maker, checker and viewer get 403", async () => {
    const flag = await newFlag();
    for (const role of ["viewer", "maker", "checker"] as const) {
      actAs(role);
      await expect403(archiveFlag(flag.key));
    }
    expect((await prisma.featureFlag.findUniqueOrThrow({ where: { id: flag.id } })).archivedAt).toBeNull();
  });
});

describe("seed data", () => {
  it("has 10 flags, two pending production changes whose claims match their approvals", async () => {
    const seeded = await prisma.featureFlag.findMany({ where: { key: { not: { startsWith: "test-flag-" } } }, include: { states: true } });
    expect(seeded).toHaveLength(10);
    const pending = seeded.flatMap((f) => f.states).filter((s) => s.pendingApprovalId);
    expect(pending).toHaveLength(2);
    for (const s of pending) {
      expect(await prisma.approvalRequest.findUnique({ where: { id: s.pendingApprovalId! } })).toMatchObject({ status: "PENDING", entityId: s.id });
    }
  });

  it("each seeded state's audit trail ends at its current value", async () => {
    const states = await prisma.flagState.findMany({ where: { flag: { key: { not: { startsWith: "test-flag-" } } } } });
    for (const s of states) {
      const last = (await events("FlagState", s.id)).at(-1);
      if (!last) {
        expect(s).toMatchObject({ enabled: false, rolloutPercent: 0 });
        continue;
      }
      expect(last.after).toMatchObject({ enabled: s.enabled, rolloutPercent: s.rolloutPercent });
    }
  });
});
