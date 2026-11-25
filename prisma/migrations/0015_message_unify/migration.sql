/* Unify DesignMessage into a shared Message model (KUK-866):
   design chat and the upcoming campaign chat are the same pipeline
   (streaming protocol, history replay, turn lease), so one table backs both.

   Designed to apply cleanly over any existing data:
   - RENAME TABLE preserves every row; SQLite's foreign_keys=ON rename
     semantics propagate the Design FK reference (same as 0013's
     DesignProject -> Design rename).
   - The design-owner column is renamed projectId -> designId; the mutually
     exclusive campaignId owner column arrives with the campaigns migration.
   - The old index is dropped and recreated under the new model's conventional
     name; it is not unique and holds no data of its own, so this is lossless.
   - The FK constraint's internal SQLite name (DesignMessage_projectId_fkey)
     is not renamed; SQLite constraint names are cosmetic and Prisma does not
     introspect them. */

-- RenameTable ("DesignMessage" -> "Message")
ALTER TABLE "DesignMessage" RENAME TO "Message";

-- RenameColumn (design owner)
ALTER TABLE "Message" RENAME COLUMN "projectId" TO "designId";

-- DropIndex / CreateIndex (conventional name for the renamed model)
DROP INDEX "DesignMessage_projectId_createdAt_idx";
CREATE INDEX "Message_designId_createdAt_idx" ON "Message"("designId", "createdAt");
