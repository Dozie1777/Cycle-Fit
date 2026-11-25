-- Persist the assistant turn's UI message parts (KUK chat refresh bug):
-- reasoning text and tool calls with their inputs/outputs were only ever
-- streamed live — the Message row kept the flat final text, so a page
-- refresh rebuilt the transcript without thoughts or tool cards. The new
-- nullable column holds a JSON array of UIMessage parts for assistant rows;
-- null keeps the old text-only read for user rows, pre-feature rows, and
-- turns whose parts overflow the storage-fit guard.
ALTER TABLE "Message" ADD COLUMN "parts" TEXT;
