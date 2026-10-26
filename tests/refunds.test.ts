import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/platform/auth";
import { fakePayments } from "@/lib/payments/fake";
import { createRefund, decideRefund, executeRefund, listRefunds } from "@/app/(apps)/refunds/service";
import { parseAmountToCents } from "@/app/(apps)/refunds/format";
import { actAs, USERS } from "./helpers";

const base = { customerRef: "cus_t", orderRef: "ord_t", currency: "USD", reason: "test" };

async function makerCreates(amountCents = 1000) {
  actAs("maker");
  return createRefund({ ...base, amountCents });
}

async function approved(amountCents = 1000) {
  const r = await makerCreates(amountCents);
  actAs(amountCents > 500_000 ? "admin" : "checker");
  return decideRefund(r.id, "APPROVED");
}

const trail = (id: string) =>
  prisma.auditEvent.findMany({ where: { app: "refunds", entity: "RefundRequest", entityId: id }, orderBy: { at: "asc" } });

beforeEach(() => {
  fakePayments.calls.length = 0;
});

describe("list/view", () => {
  it("viewer can list", async () => {
    actAs("viewer");
    await expect(listRefunds()).resolves.toBeInstanceOf(Array);
  });
  it("logged-out is rejected with 401", async () => {
    actAs(null);
    await expect(listRefunds()).rejects.toMatchObject({ status: 401 });
  });
});

describe("create", () => {
  it("maker creates a PENDING refund with an approval request and an audit row", async () => {
    const r = await makerCreates(1234);
    expect(r).toMatchObject({ status: "PENDING", createdBy: USERS.maker, amountCents: 1234 });
    const approval = await prisma.approvalRequest.findFirst({ where: { entityId: r.id } });
    expect(approval).toMatchObject({ status: "PENDING", requestedBy: USERS.maker, action: "APPROVE_REFUND" });
    const t = await trail(r.id);
    expect(t.map((e) => e.action)).toEqual(["REFUND_CREATED"]);
    expect(t[0].before).toBeNull();
    expect(t[0].after).toMatchObject({ id: r.id, status: "PENDING" });
  });

  it("admin may create too; viewer and checker get 403", async () => {
    actAs("admin");
    await expect(createRefund({ ...base, amountCents: 1 })).resolves.toMatchObject({ createdBy: USERS.admin });
    for (const role of ["viewer", "checker"] as const) {
      actAs(role);
      const err = await createRefund({ ...base, amountCents: 1 }).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenError);
      expect(err.status).toBe(403);
    }
  });

  it("rejects bad input and writes nothing", async () => {
    actAs("maker");
    const before = await prisma.refundRequest.count();
    await expect(createRefund({ ...base, amountCents: -5 })).rejects.toThrow(/positive/);
    await expect(createRefund({ ...base, amountCents: 5, currency: "DOLLARS" })).rejects.toThrow(/currency/);
    expect(await prisma.refundRequest.count()).toBe(before);
  });

  it("parses dollar amounts to cents", () => {
    expect(parseAmountToCents("125")).toBe(12500);
    expect(parseAmountToCents("0.13")).toBe(13);
    expect(() => parseAmountToCents("5,000")).toThrow();
    expect(() => parseAmountToCents("1.234")).toThrow();
    expect(() => parseAmountToCents("0")).toThrow();
  });
});

describe("approve / reject", () => {
  it("checker approves: status, decidedBy, approval row and audit before/after", async () => {
    const r = await makerCreates();
    actAs("checker");
    const after = await decideRefund(r.id, "APPROVED", "looks fine");
    expect(after).toMatchObject({ status: "APPROVED", decidedBy: USERS.checker, decisionNote: "looks fine" });
    const approval = await prisma.approvalRequest.findFirst({ where: { entityId: r.id } });
    expect(approval).toMatchObject({ status: "APPROVED", decidedBy: USERS.checker });
    const t = await trail(r.id);
    expect(t.map((e) => e.action)).toEqual(["REFUND_CREATED", "REFUND_APPROVED"]);
    expect(t[1]).toMatchObject({ actor: USERS.checker, before: { status: "PENDING" }, after: { status: "APPROVED" } });
  });

  it("checker rejects with a note", async () => {
    const r = await makerCreates();
    actAs("checker");
    await expect(decideRefund(r.id, "REJECTED", "no receipt")).resolves.toMatchObject({ status: "REJECTED", decisionNote: "no receipt" });
    expect((await trail(r.id)).map((e) => e.action)).toEqual(["REFUND_CREATED", "REFUND_REJECTED"]);
  });

  it("viewer and maker get 403", async () => {
    const r = await makerCreates();
    for (const role of ["viewer", "maker"] as const) {
      actAs(role);
      await expect(decideRefund(r.id, "APPROVED")).rejects.toMatchObject({ status: 403 });
    }
    expect((await prisma.refundRequest.findUnique({ where: { id: r.id } }))?.status).toBe("PENDING");
  });

  it("maker cannot approve their own request even when they hold an approving role (admin)", async () => {
    actAs("admin");
    const r = await createRefund({ ...base, amountCents: 500 });
    const err = await decideRefund(r.id, "APPROVED").catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toMatch(/own request/);
    expect((await prisma.refundRequest.findUnique({ where: { id: r.id } }))?.status).toBe("PENDING");
    expect((await trail(r.id)).map((e) => e.action)).toEqual(["REFUND_CREATED"]);
  });

  it("over $5,000 needs admin: checker gets 403, admin succeeds", async () => {
    const r = await makerCreates(500_001);
    actAs("checker");
    const err = await decideRefund(r.id, "APPROVED").catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.status).toBe(403);
    actAs("admin");
    await expect(decideRefund(r.id, "APPROVED")).resolves.toMatchObject({ status: "APPROVED", decidedBy: USERS.admin });
  });

  it("exactly $5,000 is still checker territory", async () => {
    const r = await makerCreates(500_000);
    actAs("checker");
    await expect(decideRefund(r.id, "APPROVED")).resolves.toMatchObject({ status: "APPROVED" });
  });

  it("cannot decide twice", async () => {
    const r = await makerCreates();
    actAs("checker");
    await decideRefund(r.id, "REJECTED");
    actAs("admin");
    await expect(decideRefund(r.id, "APPROVED")).rejects.toThrow(/already REJECTED/);
  });
});

describe("execute", () => {
  it("checker executes an approved refund: EXECUTED, externalRef, provider called once, audited", async () => {
    const r = await approved(2500);
    actAs("checker");
    const key = crypto.randomUUID();
    const done = await executeRefund(r.id, key);
    expect(done).toMatchObject({ status: "EXECUTED", idempotencyKey: key });
    expect(done.externalRef).toMatch(/^fake_/);
    expect(fakePayments.calls).toHaveLength(1);
    const t = await trail(r.id);
    expect(t.map((e) => e.action)).toEqual(["REFUND_CREATED", "REFUND_APPROVED", "REFUND_EXECUTION_STARTED", "REFUND_EXECUTED"]);
    expect(t[3]).toMatchObject({ actor: USERS.checker, before: { status: "APPROVED" }, after: { status: "EXECUTED", externalRef: done.externalRef } });
  });

  it("viewer and maker get 403 and the provider is never called", async () => {
    const r = await approved();
    for (const role of ["viewer", "maker"] as const) {
      actAs(role);
      await expect(executeRefund(r.id, crypto.randomUUID())).rejects.toMatchObject({ status: 403 });
    }
    expect(fakePayments.calls).toHaveLength(0);
    expect((await prisma.refundRequest.findUnique({ where: { id: r.id } }))?.status).toBe("APPROVED");
  });

  it("repeating the idempotency key does not double-execute", async () => {
    const r = await approved();
    actAs("admin");
    const key = crypto.randomUUID();
    const first = await executeRefund(r.id, key);
    const second = await executeRefund(r.id, key);
    expect(second).toEqual(first);
    expect(fakePayments.calls).toHaveLength(1);
    expect((await trail(r.id)).filter((e) => e.action === "REFUND_EXECUTED")).toHaveLength(1);
  });

  it("concurrent calls with the same key execute once", async () => {
    const r = await approved();
    actAs("checker");
    const key = crypto.randomUUID();
    const results = await Promise.allSettled([executeRefund(r.id, key), executeRefund(r.id, key), executeRefund(r.id, key)]);
    expect(fakePayments.calls).toHaveLength(1);
    expect(results.some((x) => x.status === "fulfilled")).toBe(true);
    expect((await prisma.refundRequest.findUnique({ where: { id: r.id } }))?.status).toBe("EXECUTED");
  });

  it("a different key after execution is refused", async () => {
    const r = await approved();
    actAs("checker");
    await executeRefund(r.id, crypto.randomUUID());
    await expect(executeRefund(r.id, crypto.randomUUID())).rejects.toThrow(/not APPROVED/);
    expect(fakePayments.calls).toHaveLength(1);
  });

  it("cannot execute a PENDING refund", async () => {
    const r = await makerCreates();
    actAs("checker");
    await expect(executeRefund(r.id, crypto.randomUUID())).rejects.toThrow(/PENDING, not APPROVED/);
  });

  it("amounts ending in .13 FAIL and are audited as REFUND_FAILED", async () => {
    const r = await approved(4713);
    actAs("checker");
    const done = await executeRefund(r.id, crypto.randomUUID());
    expect(done.status).toBe("FAILED");
    expect(done.externalRef).toBeNull();
    expect(done.decisionNote).toMatch(/\.13/);
    const t = await trail(r.id);
    expect(t.at(-1)).toMatchObject({ action: "REFUND_FAILED", before: { status: "APPROVED" }, after: { status: "FAILED" } });
  });
});

describe("audit log is append-only", () => {
  it("no source file outside tests touches auditEvent.update/delete", async () => {
    const { execSync } = await import("node:child_process");
    const out = execSync(
      "grep -rnE 'auditEvent\\.(update|delete|upsert|updateMany|deleteMany)\\(' app lib prisma || true",
      { encoding: "utf8" },
    );
    expect(out.trim()).toBe("");
  });
});
