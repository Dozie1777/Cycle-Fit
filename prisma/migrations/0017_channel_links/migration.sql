/* Channel enumeration (KUK-890): global Channel table + campaign/event links.

   Designed to apply cleanly over any existing data:
   - All new tables start empty; the only existing-table touch is the
     additive CalendarEvent.channelId column (ALTER ADD COLUMN with an
     inline FK, following 0013/0016's precedent).
   - Channel ids are DETERMINISTIC — 'chan-' + a slug of the name — so the
     seed and the legacy backfill below are idempotent and converge: a
     backfilled "Email" and the seeded standard "Email" resolve to the same
     row. Slug chars outside [a-z0-9-] (spaces, /, &, +, ,) become '-'; two
     distinct names that collide to the same slug keep only the first row
     (the PK makes INSERT OR IGNORE skip the second), and the backfill links
     events by name lookup, so an unlinked legacy string simply stays legacy
     text instead of being dropped.
   - The legacy CalendarEvent.channel text and CampaignBrief.channels text
     columns are KEPT this release (deprecated): the backfill links events
     without clearing the text, and no code writes them anymore.
   - Deleting a campaign cascades its channel links; deleting a channel
     cascades campaign links and detaches calendar events (SetNull). */

-- CreateTable (global channel enumeration; admin-owned via POST/PATCH /channels)
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Channel_name_key" ON "Channel"("name");

-- CreateTable (M:N link — the brief's channel mix, replacing the free text)
CREATE TABLE "CampaignChannel" (
    "campaignId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("campaignId", "channelId"),
    CONSTRAINT "CampaignChannel_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CampaignChannel_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CampaignChannel_channelId_idx" ON "CampaignChannel"("channelId");

-- AlterTable (linked channel on calendar slots; detaches on channel delete)
ALTER TABLE "CalendarEvent" ADD COLUMN "channelId" TEXT REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "CalendarEvent_channelId_idx" ON "CalendarEvent"("channelId");

-- Seed the standard channels idempotently (INSERT OR IGNORE + deterministic
-- ids). Colors are sensible defaults for the color-coded pills/swimlanes.
INSERT OR IGNORE INTO "Channel" ("id", "name", "color", "createdAt") VALUES
	('chan-email', 'Email', '#3b82f6', CURRENT_TIMESTAMP),
	('chan-x', 'X', '#111827', CURRENT_TIMESTAMP),
	('chan-linkedin', 'LinkedIn', '#0a66c2', CURRENT_TIMESTAMP),
	('chan-instagram', 'Instagram', '#e1306c', CURRENT_TIMESTAMP),
	('chan-tiktok', 'TikTok', '#69c9d0', CURRENT_TIMESTAMP),
	('chan-youtube', 'YouTube', '#ef4444', CURRENT_TIMESTAMP),
	('chan-blog-seo', 'Blog/SEO', '#10b981', CURRENT_TIMESTAMP),
	('chan-paid-ads', 'Paid ads', '#f59e0b', CURRENT_TIMESTAMP),
	('chan-pr-outreach', 'PR/Outreach', '#8b5cf6', CURRENT_TIMESTAMP),
	('chan-events', 'Events', '#f97316', CURRENT_TIMESTAMP),
	('chan-webinar', 'Webinar', '#6366f1', CURRENT_TIMESTAMP),
	('chan-podcast', 'Podcast', '#ec4899', CURRENT_TIMESTAMP),
	('chan-landing-page', 'Landing page', '#14b8a6', CURRENT_TIMESTAMP),
	('chan-community', 'Community', '#22c55e', CURRENT_TIMESTAMP);

-- Backfill (data-preserving): one Channel per DISTINCT legacy
-- CalendarEvent.channel string (same deterministic id scheme as the seed,
-- so a legacy "Email" converges with the standard channel), then link the
-- events. The legacy text column is kept untouched.
INSERT OR IGNORE INTO "Channel" ("id", "name", "createdAt")
SELECT DISTINCT
	'chan-' || lower(replace(replace(replace(replace(replace(trim("channel"), ' ', '-'), '/', '-'), '&', '-'), '+', '-'), ',', '-')),
	trim("channel"),
	CURRENT_TIMESTAMP
FROM "CalendarEvent"
WHERE "channel" IS NOT NULL AND trim("channel") <> '';

-- Link the backfilled channels by name; rows with no matching channel (slug
-- collisions) keep channelId NULL and remain legacy-text only.
UPDATE "CalendarEvent"
SET "channelId" = (
	SELECT "id" FROM "Channel" WHERE "name" = trim("CalendarEvent"."channel")
)
WHERE "channel" IS NOT NULL AND trim("channel") <> '' AND "channelId" IS NULL;
