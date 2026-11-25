-- Per-element design chats (KUK-940).
--
-- ElementChat: one scoped chat session per design element (component / page /
-- template / data / flow) inside a project. Holds the element chat's turn
-- lease (same semantics as Design/Campaign: claim on turn start, abandoned-
-- lease reclaim, terminal fencing) plus the distilled element context prompt.
-- elementType + elementId is a polymorphic reference to the element row —
-- no FK (SQLite cannot reference five tables from one column); handlers
-- validate existence and project ownership before creating a session.

-- CreateTable
CREATE TABLE "ElementChat" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "elementType" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "activeTurnId" TEXT,
    "turnClaimedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "error" TEXT,
    "contextPrompt" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ElementChat_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ElementChat_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ElementChat_projectId_idx" ON "ElementChat"("projectId");

-- CreateIndex (unique session per project + element)
CREATE UNIQUE INDEX "ElementChat_projectId_elementType_elementId_key" ON "ElementChat"("projectId", "elementType", "elementId");

-- RedefineTables (Message gains the nullable elementId third ownership arm;
-- the exactly-one CHECK widens from {designId, campaignId} to
-- {designId, campaignId, elementId}; all rows copied unchanged. SQLite
-- cannot ALTER a CHECK, so the 0016 table-copy pattern applies.)
CREATE TABLE "new_Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "designId" TEXT,
    "campaignId" TEXT,
    "elementId" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((
        ("designId" IS NOT NULL) +
        ("campaignId" IS NOT NULL) +
        ("elementId" IS NOT NULL)
    ) = 1),
    CONSTRAINT "Message_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_elementId_fkey" FOREIGN KEY ("elementId") REFERENCES "ElementChat" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Message" ("id", "designId", "campaignId", "elementId", "role", "content", "attachments", "createdAt")
SELECT "id", "designId", "campaignId", NULL, "role", "content", "attachments", "createdAt" FROM "Message";

DROP TABLE "Message";

ALTER TABLE "new_Message" RENAME TO "Message";

-- CreateIndex
CREATE INDEX "Message_designId_createdAt_idx" ON "Message"("designId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_campaignId_createdAt_idx" ON "Message"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_elementId_createdAt_idx" ON "Message"("elementId", "createdAt");
