import { User, DreamEntry } from "@prisma/client";
import { prisma } from './client.js'

export async function getOrCreateUser(tgId: string): Promise<User> {
  let user = await prisma.user.findUnique({ where: { tgId } });
  if (!user) user = await prisma.user.create({ data: { tgId } });
  return user;
}

// Сброс счётчика, если наступил новый месяц
export async function ensureMonthlyReset(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId } })
  if (!u) return
  const now = new Date()
  const needReset =
    !u.lastPlanReset ||
    (u.lastPlanReset.getUTCFullYear() !== now.getUTCFullYear() ||
     u.lastPlanReset.getUTCMonth() !== now.getUTCMonth())
  if (needReset) {
    await prisma.user.update({
      where: { id: userId },
      data: { monthlyCount: 0, lastPlanReset: now },
    })
  }
}

export async function incMonthlyCount(userId: string) {
  await prisma.user.update({
    where: { id: userId },
    data: { monthlyCount: { increment: 1 } },
  })
}

export async function setPlan(tgId: string, plan: string, months = 1) {
  const user = await prisma.user.findUnique({ where: { tgId } })
  if (!user) return null
  const now = new Date()
  const until = new Date(now)
  until.setMonth(until.getMonth() + months)
  return prisma.user.update({
    where: { tgId },
    data: {
      plan,
      planUntil: until,
    },
  })
}

export async function getUserByTg(tgId: string) {
  return prisma.user.findUnique({ where: { tgId } })
}

// сохранить стоимость по записи
export async function saveEntryCost(entryId: string, tokensIn: number, tokensOut: number, costRub: number) {
  await prisma.dreamEntry.update({
    where: { id: entryId },
    data: { tokensIn, tokensOut, costRub },
  })
}

export async function createDreamEntry(
  userId: string,
  data: { sleptAt: Date; text: string; symbolsRaw?: string }
): Promise<DreamEntry> {
  return prisma.dreamEntry.create({ data: { ...data, userId } });
}

export async function listDreams(userId: string, limit = 20): Promise<DreamEntry[]> {
  return prisma.dreamEntry.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function updateUser(tgId: string, patch: Partial<User & { lastReportAt?: Date | null; lastReportMonth?: string | null }>): Promise<User> {
  return prisma.user.update({ where: { tgId }, data: patch });
}

export async function updateUserProfile(
  tgId: string,
  data: Partial<{
    timezone: string | null;
    ageBand: "18-24" | "25-34" | "35-44" | "45-54" | "55+";
    chronotype: "lark" | "owl" | "mixed";
    tone: "neutral" | "poetic" | "mystic" | "calm-science";
    esotericaLevel: number;
    sleepGoal: "fall_asleep" | "remember" | "symbols" | "less_anxiety";
    wakeTime: string | null;   // "HH:MM"
    sleepTime: string | null;  // "HH:MM"
    stressLevel: number | null; // 0..10
    dreamFrequency: "rarely" | "sometimes" | "often" | null;
  }>
) {
  return prisma.user.update({
    where: { tgId },
    data,
  });
}

export async function markReminderSent(userId: string, type: "morning"|"evening"|"weekly", when: Date): Promise<void> {
  let data: Partial<User> = {};
  if (type === "morning") data.lastMorningSent = when;
  else if (type === "evening") data.lastEveningSent = when;
  else if (type === "weekly") data.lastWeeklySent = when;
  await prisma.user.update({ where: { id: userId }, data });
}

export async function getAllUsers(): Promise<User[]> {
  return prisma.user.findMany();
}

export async function getLastDream(userId: string) {
  return prisma.dreamEntry.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function saveInterpretation(
  entryId: string,
  data: {
    llmJson: any;
    tokensIn?: number;
    tokensOut?: number;
    costRub?: number;
    sentiment?: string;
    keywords?: string;
  }
) {
  const { llmJson, ...rest } = data;
  return prisma.dreamEntry.update({
    where: { id: entryId },
    data: {
      ...rest,
      llmJsonText: llmJson != null ? JSON.stringify(llmJson) : null,
    },
  });
}

export async function getDreamsForExport(
  userId: string,
  fromDate?: Date,
  toDate?: Date,
) {
  const whereClause: any = { userId };
  if (fromDate) {
    whereClause.createdAt = { gte: fromDate };
  }
  if (toDate) {
    whereClause.createdAt = { ...whereClause.createdAt, lte: toDate };
  }

  const rows = await prisma.dreamEntry.findMany({
    where: whereClause,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      sleptAt: true,
      text: true,
      symbolsRaw: true,
      llmJsonText: true, // может быть String или Json в зависимости от схемы
    },
  });

  // Приводим llmJson к объекту, если это строка
  const parsed = rows.map((r) => {
    let llm: any = undefined;
    try {
      if (typeof (r as any).llmJsonText === "string") {
        llm = JSON.parse((r as any).llmJsonText as string);
      } else {
        llm = (r as any).llmJsonText ?? undefined;
      }
    } catch {
      llm = undefined;
    }
    return { ...r, llmJsonText: llm };
  });

  return parsed;
}

export async function getDreamEntryById(id: string) {
  return prisma.dreamEntry.findUnique({ where: { id } });
}

export function isProfileComplete(u: User): boolean {
  return Boolean(u.timezone && u.ageBand && u.chronotype && u.wakeTime && u.sleepTime);
}

export async function updateDreamEntryKeywords(id: string, keywords: string) {
  return prisma.dreamEntry.update({
    where: { id },
    data: { keywords },
  });
}

export async function addKeywordToLatestEntry(userId: string, keyword: string): Promise<void> {
  const latestDream = await getLastDream(userId);
  if (!latestDream) return;

  const keywordsSet = new Set<string>();
  if (latestDream.keywords) {
    latestDream.keywords.split(',').forEach(kw => {
      const trimmedKw = kw.trim();
      if (trimmedKw) keywordsSet.add(trimmedKw);
    });
  }
  keywordsSet.add(keyword.trim());

  const newKeywords = Array.from(keywordsSet).join(', ');
  await updateDreamEntryKeywords(latestDream.id, newKeywords);
}

export async function getFirstDreamDate(userId: string): Promise<Date | null> {
  const firstDream = await prisma.dreamEntry.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  return firstDream ? firstDream.createdAt : null;
}

export async function getDreamsSince(userId: string, fromDate: Date) {
  return prisma.dreamEntry.findMany({
    where: { userId, createdAt: { gte: fromDate } },
    orderBy: { createdAt: "asc" },
  });
}

export async function appendKeyword(entryId: string, kw: string): Promise<void> {
  const dream = await prisma.dreamEntry.findUnique({ where: { id: entryId } });
  if (!dream) return;

  const keywordsSet = new Set<string>();
  if (dream.keywords) {
    dream.keywords.split(',').forEach(existingKw => {
      const trimmedKw = existingKw.trim();
      if (trimmedKw) keywordsSet.add(trimmedKw);
    });
  }
  keywordsSet.add(kw.trim());

  const newKeywords = Array.from(keywordsSet).join(', ');
  await updateDreamEntryKeywords(entryId, newKeywords);
}

export async function findLatestPendingDream(userId: string): Promise<DreamEntry | null> {
  const latestDream = await prisma.dreamEntry.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  if (latestDream && latestDream.keywords?.includes('awaiting_profile')) {
    return latestDream;
  }
  return null;
}

export async function clearKeyword(entryId: string, kw: string): Promise<void> {
  const dream = await prisma.dreamEntry.findUnique({ where: { id: entryId } });
  if (!dream) return;

  const keywordsSet = new Set<string>();
  if (dream.keywords) {
    dream.keywords.split(',').forEach(existingKw => {
      const trimmedKw = existingKw.trim();
      if (trimmedKw) keywordsSet.add(trimmedKw);
    });
  }
  keywordsSet.delete(kw.trim());

  const newKeywords = Array.from(keywordsSet).join(', ');
  await updateDreamEntryKeywords(entryId, newKeywords);
}
