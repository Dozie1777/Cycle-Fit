-- AlterTable
ALTER TABLE "ReviewClaim" ADD COLUMN "state" TEXT NOT NULL DEFAULT 'creating';

-- AlterTable
ALTER TABLE "ReviewDeliveryClaim" ADD COLUMN "state" TEXT NOT NULL DEFAULT 'creating';
ALTER TABLE "ReviewDeliveryClaim" ADD COLUMN "processId" TEXT;
