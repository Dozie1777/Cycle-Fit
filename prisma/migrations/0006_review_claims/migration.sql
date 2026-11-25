-- CreateTable
CREATE TABLE "ReviewClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repository" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "checkRunId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewClaim_deliveryId_key" ON "ReviewClaim"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewClaim_repository_headSha_key" ON "ReviewClaim"("repository", "headSha");
