import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
  log: ["error", "warn"], // можно добавить "query" в dev
});

process.on("beforeExit", async () => {
  await prisma.$disconnect().catch(() => {});
});

