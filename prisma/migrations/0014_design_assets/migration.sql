-- Design assets (KUK-864): project asset library + per-design links.
-- New tables + one nullable column; no existing data is touched.

-- AlterTable
ALTER TABLE "DesignMessage" ADD COLUMN "attachments" TEXT;

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "designId" TEXT,
    "kind" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" REAL,
    "description" TEXT,
    "descriptionStatus" TEXT NOT NULL DEFAULT 'pending',
    "descriptionError" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Asset_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DesignAsset" (
    "designId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT NOT NULL,

    PRIMARY KEY ("designId", "assetId"),
    CONSTRAINT "DesignAsset_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DesignAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Asset_projectId_createdAt_idx" ON "Asset"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Asset_designId_createdAt_idx" ON "Asset"("designId", "createdAt");
