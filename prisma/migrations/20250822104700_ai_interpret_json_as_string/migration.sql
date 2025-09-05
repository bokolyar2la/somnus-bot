-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DreamEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sleptAt" DATETIME NOT NULL,
    "text" TEXT NOT NULL,
    "symbolsRaw" TEXT,
    "llmJson" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costRub" REAL NOT NULL DEFAULT 0,
    "sentiment" TEXT,
    "keywords" TEXT,
    CONSTRAINT "DreamEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DreamEntry" ("createdAt", "id", "sleptAt", "symbolsRaw", "text", "userId") SELECT "createdAt", "id", "sleptAt", "symbolsRaw", "text", "userId" FROM "DreamEntry";
DROP TABLE "DreamEntry";
ALTER TABLE "new_DreamEntry" RENAME TO "DreamEntry";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
