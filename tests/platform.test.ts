import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { assertDevLoginAllowed, DEV_SESSION_SECRET, ForbiddenError, getCurrentUser, requireRole, signSession } from "@/lib/platform/auth";
import { audit, newRequestId } from "@/lib/platform/audit";
import { decide, requestApproval, supersede } from "@/lib/platform/approvals";
import { actAs, tamperedCookie, USERS } from "./helpers";

describe("auth", () => {
  it("getCurrentUser returns null with no cookie and the user with a signed cookie", async () => {
    actAs(null);
    expect(await getCurrentUser()).toBeNull();
    actAs("checker");
    expect(await getCurrentUser()).toMatchObject({ id: USERS.checker, role: "checker" });
  });

  it("rejects a cookie whose signature does not match", async () => {
    tamperedCookie("admin");
    expect(await getCurrentUser()).toBeNull();
  });

  it("requireRole returns the user for an allowed role", async () => {
    actAs("maker");
    await expect(requireRole("maker", "admin")).resolves.toMatchObject({ role: "maker" });
  });

  it("requireRole throws 403 for a disallowed role", async () => {
    actAs("viewer");
    const err = await requireRole("maker", "admin").catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.status).toBe(403);
  });

  it("requireRole throws 401 when nobody is logged in", async () => {
    actAs(null);
    const err = await requireRole("viewer").catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.status).toBe(401);
  });
});

describe("audit", () => {
  it("appends a row inside the caller's transaction and rolls back with it", async () => {
    const requestId = newRequestId();
    await prisma.$transaction(async (tx) => {
      await audit(tx, {
        actor: USERS.maker,
        app: "test",
        entity: "Thing",
        entityId: "t1",
        action: "CREATE",
        before: null,
        after: { x: 1 },
        requestId,
      });
    });
    const rows = await prisma.auditEvent.findMany({ where: { requestId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: USERS.maker, action: "CREATE", after: { x: 1 }, before: null });

    const rolledBack = newRequestId();
    await prisma
      .$transaction(async (tx) => {
        await audit(tx, { actor: USERS.maker, app: "test", entity: "Thing", entityId: "t2", action: "CREATE", requestId: rolledBack });
        throw new Error("boom");
      })
      .catch(() => undefined);
    expect(await prisma.auditEvent.count({ where: { requestId: rolledBack } })).toBe(0);
  });

  it("exposes no update or delete helper", async () => {
    const mod = await import("@/lib/platform/audit");
    expect(Object.keys(mod).sort()).toEqual(["audit", "auditTrail", "newRequestId"]);
  });
});

describe("approvals", () => {
  async function newApproval(requester: string) {
    return prisma.$transaction((tx) =>
      requestApproval(tx, {
        app: "test",
        entity: "Thing",
        entityId: crypto.randomUUID(),
        action: "DO_THING",
        requester: { id: requester },
        requestId: newRequestId(),
      }),
    );
  }

  it("requestApproval creates a PENDING request and an audit row", async () => {
    const approval = await newApproval(USERS.maker);
    expect(approval.status).toBe("PENDING");
    const trail = await prisma.auditEvent.findMany({ where: { entity: "ApprovalRequest", entityId: approval.id } });
    expect(trail.map((e) => e.action)).toEqual(["APPROVAL_REQUESTED"]);
  });

  it("decide rejects the requester deciding on their own request (maker != checker)", async () => {
    const approval = await newApproval(USERS.maker);
    const err = await prisma
      .$transaction((tx) =>
        decide(tx, { approvalId: approval.id, decider: { id: USERS.maker }, decision: "APPROVED", requestId: newRequestId() }),
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    const still = await prisma.approvalRequest.findUnique({ where: { id: approval.id } });
    expect(still?.status).toBe("PENDING");
  });

  it("decide by a different user records the decision and audits it", async () => {
    const approval = await newApproval(USERS.maker);
    const decided = await prisma.$transaction((tx) =>
      decide(tx, { approvalId: approval.id, decider: { id: USERS.checker }, decision: "REJECTED", note: "no", requestId: newRequestId() }),
    );
    expect(decided).toMatchObject({ status: "REJECTED", decidedBy: USERS.checker, note: "no" });
    const trail = await prisma.auditEvent.findMany({ where: { entity: "ApprovalRequest", entityId: approval.id }, orderBy: { at: "asc" } });
    expect(trail.map((e) => e.action)).toEqual(["APPROVAL_REQUESTED", "APPROVAL_REJECTED"]);
    expect(trail[1].before).toMatchObject({ status: "PENDING" });
    expect(trail[1].after).toMatchObject({ status: "REJECTED" });
  });

  it("decide refuses a second decision", async () => {
    const approval = await newApproval(USERS.maker);
    const run = (decider: string) =>
      prisma.$transaction((tx) =>
        decide(tx, { approvalId: approval.id, decider: { id: decider }, decision: "APPROVED", requestId: newRequestId() }),
      );
    await run(USERS.checker);
    await expect(run(USERS.admin)).rejects.toThrow(/already APPROVED/);
  });

  const supersedeAs = (approvalId: string, actor: string, note: string) =>
    prisma.$transaction((tx) => supersede(tx, approvalId, note, { actor: { id: actor }, requestId: newRequestId() }));
  const trailOf = (approvalId: string) =>
    prisma.auditEvent.findMany({ where: { entity: "ApprovalRequest", entityId: approvalId }, orderBy: { at: "asc" } });

  it("supersede rejects a PENDING request, even by its requester, and audits it", async () => {
    const approval = await newApproval(USERS.admin);
    const after = await supersedeAs(approval.id, USERS.admin, "  superseded by test  ");
    expect(after).toMatchObject({ status: "REJECTED", decidedBy: USERS.admin, note: "superseded by test" });
    const trail = await trailOf(approval.id);
    expect(trail.map((e) => e.action)).toEqual(["APPROVAL_REQUESTED", "APPROVAL_REJECTED"]);
    expect(trail[1]).toMatchObject({ actor: USERS.admin, app: "test", before: { status: "PENDING" }, after: { status: "REJECTED" } });
  });

  it("supersede is a no-op on a decided request: no change, no audit row", async () => {
    const approval = await newApproval(USERS.maker);
    await prisma.$transaction((tx) =>
      decide(tx, { approvalId: approval.id, decider: { id: USERS.checker }, decision: "APPROVED", requestId: newRequestId() }),
    );
    expect(await supersedeAs(approval.id, USERS.admin, "too late")).toBeNull();
    expect(await prisma.approvalRequest.findUnique({ where: { id: approval.id } })).toMatchObject({ status: "APPROVED", decidedBy: USERS.checker });
    expect((await trailOf(approval.id)).map((e) => e.action)).toEqual(["APPROVAL_REQUESTED", "APPROVAL_APPROVED"]);
  });

  it("supersede requires a note and an existing request", async () => {
    const approval = await newApproval(USERS.maker);
    await expect(supersedeAs(approval.id, USERS.admin, "   ")).rejects.toThrow(/note is required/);
    await expect(supersedeAs("does-not-exist", USERS.admin, "x")).rejects.toThrow(/not found/);
    expect((await prisma.approvalRequest.findUnique({ where: { id: approval.id } }))?.status).toBe("PENDING");
  });

  it("a superseded request can no longer be decided", async () => {
    const approval = await newApproval(USERS.maker);
    await supersedeAs(approval.id, USERS.admin, "superseded");
    await expect(
      prisma.$transaction((tx) =>
        decide(tx, { approvalId: approval.id, decider: { id: USERS.checker }, decision: "APPROVED", requestId: newRequestId() }),
      ),
    ).rejects.toThrow(/already REJECTED/);
  });
});

describe("dev login", () => {
  it("is refused in production unless ALLOW_DEV_LOGIN=1", () => {
    const env = process.env as Record<string, string | undefined>;
    const prev = { NODE_ENV: env.NODE_ENV, ALLOW_DEV_LOGIN: env.ALLOW_DEV_LOGIN };
    try {
      env.NODE_ENV = "production";
      delete env.ALLOW_DEV_LOGIN;
      expect(() => assertDevLoginAllowed()).toThrow(ForbiddenError);
      env.ALLOW_DEV_LOGIN = "1";
      expect(() => assertDevLoginAllowed()).not.toThrow();
      env.NODE_ENV = "test";
      delete env.ALLOW_DEV_LOGIN;
      expect(() => assertDevLoginAllowed()).not.toThrow();
    } finally {
      env.NODE_ENV = prev.NODE_ENV;
      if (prev.ALLOW_DEV_LOGIN === undefined) delete env.ALLOW_DEV_LOGIN; else env.ALLOW_DEV_LOGIN = prev.ALLOW_DEV_LOGIN;
    }
  });
});

describe("session secret", () => {
  it("refuses the committed dev secret in production", () => {
    const env = process.env as Record<string, string | undefined>;
    const prev = { NODE_ENV: env.NODE_ENV, SESSION_SECRET: env.SESSION_SECRET };
    env.NODE_ENV = "production";
    env.SESSION_SECRET = DEV_SESSION_SECRET;
    try {
      expect(() => signSession(USERS.viewer)).toThrow(/SESSION_SECRET/);
      env.SESSION_SECRET = "a-real-secret";
      expect(signSession(USERS.viewer)).toContain(".");
    } finally {
      env.NODE_ENV = prev.NODE_ENV;
      env.SESSION_SECRET = prev.SESSION_SECRET;
    }
  });
});
