/* Designed to apply cleanly over any existing data:
   - "Project" starts empty (backfill strategy B: legacy designs stay unfiled,
     with a NULL projectId).
   - The RENAME propagates to any REFERENCES clauses (incl. DesignMessage's
     FK) thanks to SQLite's foreign_keys=ON rename semantics; the new
     projectId FK on "Design" is added after the rename.
   - Deleting a project cascades to its designs (DesignMessage rows already
     cascade from a design via 0004's FK). */

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- RenameTable ("DesignProject" -> "Design")
ALTER TABLE "DesignProject" RENAME TO "Design";

-- AlterTable (unfiled-by-default project link)
ALTER TABLE "Design" ADD COLUMN "projectId" TEXT REFERENCES "Project"("id") ON DELETE CASCADE;

-- CreateIndex
CREATE INDEX "Design_projectId_createdAt_idx" ON "Design"("projectId", "createdAt");
