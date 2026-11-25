/* Normalized building-block design model (KUK-917): structured, queryable
   design entities for the studio — design tokens, dummy-data collections,
   versioned web components (draft/published/retired with a single
   published-version pointer per component), pages composed by pinning
   exact component versions, templates, user flows, and DB-tracked
   versioned publications.

   Designed to apply cleanly over any existing data:
   - All new tables start empty; no existing table is touched.
   - JSON payloads (apiSchema, defaults, propsOverrides, dataBindings,
     record data, publication manifests) are TEXT columns — D1 is SQLite.
   - Circular FK (Component.publishedVersionId <-> ComponentVersion) is
     safe in SQLite: forward references in FK definitions are allowed and
     the delete path is guarded in handlers (components are soft-deleted).
   - Deleting a project cascades its whole building-block tree; deleting a
     design detaches (SetNull) its pages and cascades its publications. */

-- CreateTable (1:1 with its project)
CREATE TABLE "DesignSystem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DesignSystem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DesignToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "systemId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "DesignToken_systemId_fkey" FOREIGN KEY ("systemId") REFERENCES "DesignSystem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DataCollection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DataCollection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DataRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "collectionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    CONSTRAINT "DataRecord_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "DataCollection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Component" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tagName" TEXT NOT NULL,
    "publishedVersionId" TEXT,
    "createdTurnId" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Component_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Component_publishedVersionId_fkey" FOREIGN KEY ("publishedVersionId") REFERENCES "ComponentVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ComponentVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "componentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "js" TEXT NOT NULL,
    "html" TEXT,
    "css" TEXT,
    "shadowMode" TEXT NOT NULL DEFAULT 'light',
    "apiSchema" TEXT,
    "defaults" TEXT,
    "previewR2Key" TEXT,
    "changeNote" TEXT,
    "createdTurnId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ComponentVersion_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "Component" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Template_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TemplateSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "componentVersionId" TEXT,
    "propsOverrides" TEXT,
    CONSTRAINT "TemplateSlot_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TemplateSlot_componentVersionId_fkey" FOREIGN KEY ("componentVersionId") REFERENCES "ComponentVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "designId" TEXT,
    "path" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Page_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Page_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PageBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pageId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "componentVersionId" TEXT,
    "templateId" TEXT,
    "sourceHtml" TEXT,
    "propsOverrides" TEXT,
    "dataBindings" TEXT,
    CONSTRAINT "PageBlock_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PageBlock_componentVersionId_fkey" FOREIGN KEY ("componentVersionId") REFERENCES "ComponentVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PageBlock_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Flow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Flow_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FlowStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "flowId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "pageId" TEXT NOT NULL,
    "entryAction" TEXT,
    "exitTarget" TEXT,
    CONSTRAINT "FlowStep_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FlowStep_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "Page" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "designId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "renderedR2Key" TEXT NOT NULL,
    "previewR2Key" TEXT,
    "manifest" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Publication_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DesignSystem_projectId_key" ON "DesignSystem"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DesignToken_systemId_category_role_key" ON "DesignToken"("systemId", "category", "role");

-- CreateIndex
CREATE INDEX "DataCollection_projectId_createdAt_idx" ON "DataCollection"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DataCollection_projectId_name_key" ON "DataCollection"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DataRecord_collectionId_ordinal_key" ON "DataRecord"("collectionId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "Component_publishedVersionId_key" ON "Component"("publishedVersionId");

-- CreateIndex
CREATE INDEX "Component_projectId_createdAt_idx" ON "Component"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Component_projectId_name_key" ON "Component"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Component_projectId_tagName_key" ON "Component"("projectId", "tagName");

-- CreateIndex
CREATE INDEX "ComponentVersion_componentId_status_idx" ON "ComponentVersion"("componentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ComponentVersion_componentId_version_key" ON "ComponentVersion"("componentId", "version");

-- CreateIndex
CREATE INDEX "Template_projectId_createdAt_idx" ON "Template"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Template_projectId_name_key" ON "Template"("projectId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateSlot_templateId_ordinal_key" ON "TemplateSlot"("templateId", "ordinal");

-- CreateIndex
CREATE INDEX "Page_projectId_createdAt_idx" ON "Page"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Page_projectId_path_key" ON "Page"("projectId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "PageBlock_pageId_ordinal_key" ON "PageBlock"("pageId", "ordinal");

-- CreateIndex
CREATE INDEX "Flow_projectId_createdAt_idx" ON "Flow"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Flow_projectId_name_key" ON "Flow"("projectId", "name");

-- CreateIndex
CREATE INDEX "FlowStep_pageId_idx" ON "FlowStep"("pageId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowStep_flowId_ordinal_key" ON "FlowStep"("flowId", "ordinal");

-- CreateIndex
CREATE INDEX "Publication_designId_createdAt_idx" ON "Publication"("designId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_designId_version_key" ON "Publication"("designId", "version");

