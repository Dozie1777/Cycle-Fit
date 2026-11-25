/* BrandKit → DesignToken backfill (KUK-918): DesignSystem/DesignToken
   (migration 0020) become the project's queryable token store. This
   migration backfills the existing brand layer into the token store so
   every project's brand kit is readable as DesignTokens immediately after
   it applies. The BrandKit tables stay in place this release (the UI/API
   keep writing them; a runtime sync helper mirrors every brand-kit write
   into DesignToken) — dropping them is a later cleanup migration.

   Mapping (mirrored 1:1 by src/lib/design-tokens.ts syncDesignTokensFromBrandKit):
   - BrandKit               → one DesignSystem row (1:1 via its unique projectId).
   - BrandColor, light mode → category "color",     role = the shadcn token name
                              (background, foreground, primary, ...).
   - BrandColor, dark mode  → category "color",     role = "dark-<role>"
                              (the dark palette overrides the same shadcn roles,
                              so the mode is encoded as a role prefix — the
                              [systemId, category, role] unique stays collision-free
                              and the composition engine can scope overrides).
   - BrandTypography        → category "typography", role = its role, value = the
                              CSS font stack.
   - BrandFont              → category "font",       role = the family, value = a
                              JSON string {"source","url","weights","italic"} in a
                              TEXT column (D1 is SQLite — no native JSON).

   Designed to apply cleanly over any existing data and to be idempotent:
   - Additive only; no existing table is modified or dropped.
   - DesignSystem is upserted on its unique projectId (insert only when absent).
   - Every DesignToken insert is guarded with WHERE NOT EXISTS on the
     [systemId, category, role] unique triple, so re-running (or a
     pre-existing system with tokens) never duplicates or overwrites rows.
     Token ids are random — the triple, not the id, carries determinism. */

-- Upsert a DesignSystem for every project that has a BrandKit (1:1).
INSERT INTO "DesignSystem" ("id", "projectId", "createdAt", "updatedAt")
SELECT 'ds_' || b."projectId", b."projectId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "BrandKit" b
WHERE NOT EXISTS (
    SELECT 1 FROM "DesignSystem" ds WHERE ds."projectId" = b."projectId"
);

-- Light palette colors → color tokens keyed by their shadcn role.
INSERT INTO "DesignToken" ("id", "systemId", "category", "role", "value")
SELECT 'dt_' || hex(randomblob(12)), ds."id", 'color', c."role", c."value"
FROM "BrandColor" c
JOIN "BrandPalette" p ON p."id" = c."paletteId"
JOIN "BrandKit" b ON b."id" = p."kitId"
JOIN "DesignSystem" ds ON ds."projectId" = b."projectId"
WHERE p."mode" = 'light'
  AND NOT EXISTS (
    SELECT 1 FROM "DesignToken" t
    WHERE t."systemId" = ds."id" AND t."category" = 'color' AND t."role" = c."role"
);

-- Dark palette colors → color tokens with the dark- role prefix convention.
INSERT INTO "DesignToken" ("id", "systemId", "category", "role", "value")
SELECT 'dt_' || hex(randomblob(12)), ds."id", 'color', 'dark-' || c."role", c."value"
FROM "BrandColor" c
JOIN "BrandPalette" p ON p."id" = c."paletteId"
JOIN "BrandKit" b ON b."id" = p."kitId"
JOIN "DesignSystem" ds ON ds."projectId" = b."projectId"
WHERE p."mode" = 'dark'
  AND NOT EXISTS (
    SELECT 1 FROM "DesignToken" t
    WHERE t."systemId" = ds."id" AND t."category" = 'color'
      AND t."role" = 'dark-' || c."role"
);

-- Typography roles → typography tokens (value = the CSS stack).
INSERT INTO "DesignToken" ("id", "systemId", "category", "role", "value")
SELECT 'dt_' || hex(randomblob(12)), ds."id", 'typography', ty."role", ty."stack"
FROM "BrandTypography" ty
JOIN "BrandKit" b ON b."id" = ty."kitId"
JOIN "DesignSystem" ds ON ds."projectId" = b."projectId"
WHERE NOT EXISTS (
    SELECT 1 FROM "DesignToken" t
    WHERE t."systemId" = ds."id" AND t."category" = 'typography' AND t."role" = ty."role"
);

-- Fonts → font tokens (role = family; value = JSON loading info as TEXT).
-- json_object handles NULL url/weights as JSON null and json() turns the
-- italic flag into a real JSON boolean (not 0/1).
-- NOTE: for a duplicated family this backfill keeps the first-inserted row
-- (arbitrary table order), while the runtime sync keeps the earliest
-- createdAt row — self-healing: the next kit write's stale sweep reconciles.
INSERT INTO "DesignToken" ("id", "systemId", "category", "role", "value")
SELECT 'dt_' || hex(randomblob(12)), ds."id", 'font', f."family",
       json_object(
         'source', f."source",
         'url', f."url",
         'weights', f."weights",
         'italic', json(CASE WHEN f."italic" = 1 THEN 'true' ELSE 'false' END)
       )
FROM "BrandFont" f
JOIN "BrandKit" b ON b."id" = f."kitId"
JOIN "DesignSystem" ds ON ds."projectId" = b."projectId"
WHERE NOT EXISTS (
    SELECT 1 FROM "DesignToken" t
    WHERE t."systemId" = ds."id" AND t."category" = 'font' AND t."role" = f."family"
);
