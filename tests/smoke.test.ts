import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";

describe("scaffold", () => {
  it("seeds one user per role", async () => {
    const roles = (await prisma.user.findMany()).map((u) => u.role).sort();
    expect(roles).toEqual(["admin", "checker", "maker", "viewer"]);
  });
});
