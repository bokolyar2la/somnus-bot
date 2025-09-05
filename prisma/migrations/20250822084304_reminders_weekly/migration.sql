-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tgId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "timezone" TEXT,
    "remindMorning" TEXT,
    "remindEvening" TEXT,
    "remindersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "weeklyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "weeklyDay" INTEGER NOT NULL DEFAULT 0,
    "weeklyHour" INTEGER NOT NULL DEFAULT 10,
    "lastMorningSent" DATETIME,
    "lastEveningSent" DATETIME,
    "lastWeeklySent" DATETIME
);
INSERT INTO "new_User" ("createdAt", "id", "tgId") SELECT "createdAt", "id", "tgId" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_tgId_key" ON "User"("tgId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
