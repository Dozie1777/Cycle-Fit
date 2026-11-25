-- Add optional target end date to campaigns
ALTER TABLE "Campaign" ADD COLUMN "targetEndDate" DATETIME;

-- KPI target definitions
CREATE TABLE "CampaignKpi" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetNumber" REAL,
    "targetBoolean" BOOLEAN,
    "targetText" TEXT,
    "unit" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignKpi_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CampaignKpi_campaignId_sortOrder_idx" ON "CampaignKpi"("campaignId", "sortOrder");

-- KPI recorded actuals (supports multiple snapshots per KPI)
CREATE TABLE "CampaignKpiResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kpiId" TEXT NOT NULL,
    "actualNumber" REAL,
    "actualBoolean" BOOLEAN,
    "actualText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reportId" TEXT,
    "recordedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampaignKpiResult_kpiId_fkey" FOREIGN KEY ("kpiId") REFERENCES "CampaignKpi" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignKpiResult_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "CampaignReport" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "CampaignKpiResult_kpiId_recordedAt_idx" ON "CampaignKpiResult"("kpiId", "recordedAt");
CREATE INDEX "CampaignKpiResult_reportId_idx" ON "CampaignKpiResult"("reportId");
