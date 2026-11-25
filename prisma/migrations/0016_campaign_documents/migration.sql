/* Campaigns (KUK-867): campaign container + structured document models.

   Designed to apply cleanly over any existing data:
   - All new tables start empty; the only existing-table touches are
     additive (Design.campaignId) and the Message ownership rebuild below.
   - Design.campaignId follows 0013's precedent (ALTER ADD COLUMN with an
     inline FK; SQLite rename/FK semantics handle the rest).
   - Message becomes owned by either a design or a campaign (exactly one).
     SQLite cannot alter nullability in place, so the table is rebuilt with
     the standard copy pattern: every existing row keeps its id, content,
     timestamps, and attachments; campaignId is NULL for all copied rows and
     the CHECK constraint enforces exactly-one ownership going forward.
     Prisma does not model CHECK constraints, so the datamodel stays clean.
   - Deleting a project cascades Campaign -> its documents; deleting a
     campaign detaches Design.campaignId (SetNull) and cascades its documents;
     deleting an attached design detaches the calendar slot (SetNull). */

-- CreateTable (campaign container; always filed under a project)
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "briefPrompt" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "error" TEXT,
    "activeTurnId" TEXT,
    "turnClaimedAt" DATETIME,
    "shareSlug" TEXT,
    "shareRevokedAt" DATETIME,
    "shareIncludeReports" BOOLEAN NOT NULL DEFAULT false,
    "projectId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Campaign_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_shareSlug_key" ON "Campaign"("shareSlug");

-- CreateIndex
CREATE INDEX "Campaign_projectId_createdAt_idx" ON "Campaign"("projectId", "createdAt");

-- CreateTable (1:1 campaign foundation document)
CREATE TABLE "CampaignBrief" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "objective" TEXT,
    "audience" TEXT,
    "keyMessage" TEXT,
    "tone" TEXT,
    "channels" TEXT,
    "budget" TEXT,
    "kpis" TEXT,
    "body" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignBrief_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignBrief_campaignId_key" ON "CampaignBrief"("campaignId");

-- CreateTable (named plan; a campaign may hold several)
CREATE TABLE "CampaignPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignPlan_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CampaignPlan_campaignId_idx" ON "CampaignPlan"("campaignId");

-- CreateTable (ordered phase of a plan)
CREATE TABLE "PlanPhase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "position" INTEGER NOT NULL,
    "body" TEXT,
    CONSTRAINT "PlanPhase_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CampaignPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PlanPhase_planId_position_idx" ON "PlanPhase"("planId", "position");

-- CreateTable (content-calendar slot; optional attached design asset)
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "channel" TEXT,
    "scheduledAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "assetId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CalendarEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CalendarEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Design" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CalendarEvent_campaignId_scheduledAt_idx" ON "CalendarEvent"("campaignId", "scheduledAt");

-- CreateTable (performance report)
CREATE TABLE "CampaignReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "summary" TEXT,
    "metrics" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CampaignReport_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CampaignReport_campaignId_createdAt_idx" ON "CampaignReport"("campaignId", "createdAt");

-- AlterTable (campaign membership on designs; detaches on campaign delete)
ALTER TABLE "Design" ADD COLUMN "campaignId" TEXT REFERENCES "Campaign"("id") ON DELETE SET NULL;

-- CreateIndex
CREATE INDEX "Design_campaignId_idx" ON "Design"("campaignId");

-- RedefineTables (Message: designId becomes nullable, campaignId added,
-- exactly-one ownership enforced by CHECK; all rows copied unchanged)
CREATE TABLE "new_Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "designId" TEXT,
    "campaignId" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (("designId" IS NULL) <> ("campaignId" IS NULL)),
    CONSTRAINT "Message_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Message" ("id", "designId", "campaignId", "role", "content", "attachments", "createdAt") SELECT "id", "designId", NULL, "role", "content", "attachments", "createdAt" FROM "Message";

DROP TABLE "Message";

ALTER TABLE "new_Message" RENAME TO "Message";

-- CreateIndex
CREATE INDEX "Message_designId_createdAt_idx" ON "Message"("designId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_campaignId_createdAt_idx" ON "Message"("campaignId", "createdAt");
