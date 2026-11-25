-- AlterTable
ALTER TABLE "ReviewClaim" ADD COLUMN "leaseUntil" DATETIME;

-- CreateTable
CREATE TABLE "ReviewDeliveryClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deliveryId" TEXT NOT NULL,
    "checkRunId" INTEGER,
    "leaseUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewDeliveryClaim_deliveryId_key" ON "ReviewDeliveryClaim"("deliveryId");
