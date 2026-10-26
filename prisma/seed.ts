import { PrismaClient } from "@prisma/client";

export const SEED_USERS = [
  { id: "user_viewer", name: "Vera Viewer", email: "vera@example.com", role: "viewer" },
  { id: "user_maker", name: "Mark Maker", email: "mark@example.com", role: "maker" },
  { id: "user_checker", name: "Chloe Checker", email: "chloe@example.com", role: "checker" },
  { id: "user_admin", name: "Ada Admin", email: "ada@example.com", role: "admin" },
] as const;

export async function seedUsers(prisma: PrismaClient) {
  for (const u of SEED_USERS) {
    await prisma.user.upsert({ where: { id: u.id }, update: u, create: u });
  }
}

export async function seed(prisma: PrismaClient) {
  await seedUsers(prisma);
}

if (process.argv[1]?.endsWith("seed.ts")) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then(() => console.log("Seeded."))
    .finally(() => prisma.$disconnect());
}
