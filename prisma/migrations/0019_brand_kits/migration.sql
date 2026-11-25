/* Brand kits (KUK-893): the design studio's persistent brand layer — one
   BrandKit per project holding palettes (light + dark), typography roles,
   and font loading info so design chats reuse the project's visual identity
   instead of re-deriving style each session.

   Designed to apply cleanly over any existing data:
   - All new tables start empty; no existing table is touched.
   - Colors and typography are rows-per-role (role-keyed with compound
     unique indexes), not typed columns — new roles need no migration.
     Required roles (background/foreground/primary on the light palette)
     are enforced in the API's Zod validation, not in the DB.
   - Fonts are modeled (source/weights/italic), never stored as raw
     HTML/link snippets; the CSS/HTML is generated from the rows.
   - Deleting a project cascades kit -> palettes -> colors and the
     typography/font rows. */

-- CreateTable (1:1 with its project)
CREATE TABLE "BrandKit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BrandKit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable (one palette mode per kit)
CREATE TABLE "BrandPalette" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kitId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    CONSTRAINT "BrandPalette_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "BrandKit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable (rows-per-role: shadcn token names)
CREATE TABLE "BrandColor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paletteId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "BrandColor_paletteId_fkey" FOREIGN KEY ("paletteId") REFERENCES "BrandPalette" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable (rows-per-role: heading/body/display; shared across modes)
CREATE TABLE "BrandTypography" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kitId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "stack" TEXT NOT NULL,
    CONSTRAINT "BrandTypography_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "BrandKit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable (font loading info; never raw HTML/link snippets)
CREATE TABLE "BrandFont" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kitId" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'google',
    "url" TEXT,
    "weights" TEXT,
    "italic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrandFont_kitId_fkey" FOREIGN KEY ("kitId") REFERENCES "BrandKit" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "BrandKit_projectId_key" ON "BrandKit"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandPalette_kitId_mode_key" ON "BrandPalette"("kitId", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "BrandColor_paletteId_role_key" ON "BrandColor"("paletteId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "BrandTypography_kitId_role_key" ON "BrandTypography"("kitId", "role");

-- CreateIndex
CREATE INDEX "BrandFont_kitId_idx" ON "BrandFont"("kitId");
