-- AlterTable
ALTER TABLE "DesignProject" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE "DesignProject" ADD COLUMN "error" TEXT;

-- CreateTable
CREATE TABLE "DesignMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DesignMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "DesignProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DesignMessage_projectId_createdAt_idx" ON "DesignMessage"("projectId", "createdAt");
