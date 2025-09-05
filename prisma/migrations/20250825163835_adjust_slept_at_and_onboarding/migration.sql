-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DreamEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sleptAt" DATETIME,
    "text" TEXT NOT NULL,
    "symbolsRaw" TEXT,
    "llmJsonText" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costRub" REAL NOT NULL DEFAULT 0,
    "keywords" TEXT,
    "sentiment" TEXT,
    CONSTRAINT "DreamEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DreamEntry" ("costRub", "createdAt", "id", "keywords", "llmJsonText", "sentiment", "sleptAt", "symbolsRaw", "text", "tokensIn", "tokensOut", "userId") SELECT "costRub", "createdAt", "id", "keywords", "llmJsonText", "sentiment", "sleptAt", "symbolsRaw", "text", "tokensIn", "tokensOut", "userId" FROM "DreamEntry";
DROP TABLE "DreamEntry";
ALTER TABLE "new_DreamEntry" RENAME TO "DreamEntry";
CREATE INDEX "DreamEntry_userId_idx" ON "DreamEntry"("userId");
CREATE INDEX "DreamEntry_createdAt_idx" ON "DreamEntry"("createdAt");
CREATE INDEX "DreamEntry_sleptAt_idx" ON "DreamEntry"("sleptAt");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tgId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timezone" TEXT,
    "ageBand" TEXT,
    "chronotype" TEXT,
    "tone" TEXT,
    "esotericaLevel" INTEGER,
    "sleepGoal" TEXT,
    "wakeTime" TEXT,
    "sleepTime" TEXT,
    "stressLevel" INTEGER,
    "dreamFrequency" TEXT,
    "remindMorning" TEXT,
    "remindEvening" TEXT,
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "weeklyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "weeklyDay" INTEGER NOT NULL DEFAULT 0,
    "weeklyHour" INTEGER NOT NULL DEFAULT 10,
    "lastMorningSent" DATETIME,
    "lastEveningSent" DATETIME,
    "lastWeeklySent" DATETIME,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "planUntil" DATETIME,
    "monthlyCount" INTEGER NOT NULL DEFAULT 0,
    "lastPlanReset" DATETIME,
    "firstInterpretDone" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_User" ("ageBand", "chronotype", "createdAt", "dreamFrequency", "esotericaLevel", "id", "lastEveningSent", "lastMorningSent", "lastPlanReset", "lastWeeklySent", "monthlyCount", "plan", "planUntil", "remindEvening", "remindMorning", "remindersEnabled", "sleepGoal", "sleepTime", "stressLevel", "tgId", "timezone", "tone", "wakeTime", "weeklyDay", "weeklyEnabled", "weeklyHour") SELECT "ageBand", "chronotype", "createdAt", "dreamFrequency", "esotericaLevel", "id", "lastEveningSent", "lastMorningSent", "lastPlanReset", "lastWeeklySent", "monthlyCount", "plan", "planUntil", "remindEvening", "remindMorning", "remindersEnabled", "sleepGoal", "sleepTime", "stressLevel", "tgId", "timezone", "tone", "wakeTime", "weeklyDay", "weeklyEnabled", "weeklyHour" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_tgId_key" ON "User"("tgId");
CREATE INDEX "User_plan_idx" ON "User"("plan");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
