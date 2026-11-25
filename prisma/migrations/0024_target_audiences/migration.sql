-- Target audiences (per-campaign structured segmentation rows).
--
-- A campaign can hold several TargetAudience rows (ICP, secondary segments,
-- ...). Unlike the global Channel enumeration there is no shared library and
-- no seed: audiences are company-specific ICPs, so rows are created by the
-- agent's audience tools and the studio audiences editor only.
--
-- The legacy free-text CampaignBrief.audience markdown column is kept,
-- deprecated, for legacy display only — exactly the treatment
-- CampaignBrief.channels received in 0017_channel_links. No surface writes
-- it anymore.

-- CreateTable
CREATE TABLE "TargetAudience" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "demographics" TEXT,
    "psychographics" TEXT,
    "buyingStage" TEXT,
    "body" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TargetAudience_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TargetAudience_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TargetAudience_campaignId_idx" ON "TargetAudience"("campaignId");

-- No backfill: existing CampaignBrief.audience markdown is intentionally
-- left untouched. It keeps rendering through the legacy display fallbacks
-- (admin studio always; share page / asset context when no structured rows
-- exist), and structured rows are created fresh through the agent tools
-- and the studio editor.


