import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { seed } from "../prisma/seed";

// Fresh SQLite database for every test run. We never truncate audit rows; we start from zero instead.
export default async function setup() {
  const env = { ...process.env, DATABASE_URL: "file:./test.db" };
  execSync("pnpm exec prisma db push --force-reset --skip-generate", { env, stdio: "pipe" });
  const prisma = new PrismaClient({ datasourceUrl: "file:./test.db" });
  await seed(prisma);
  await prisma.$disconnect();
}
