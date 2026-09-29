-- CreateEnum
CREATE TYPE "CollectionPointStatus" AS ENUM ('ENABLED', 'DISABLED');

-- AlterTable
ALTER TABLE "outlets" ADD COLUMN     "collectionPointOperatingHours" TEXT,
ADD COLUMN     "collectionPointResponsibleUserId" TEXT,
ADD COLUMN     "collectionPointStatus" "CollectionPointStatus" NOT NULL DEFAULT 'DISABLED';

-- CreateIndex
CREATE INDEX "outlets_organisationId_territoryId_collectionPointStatus_idx" ON "outlets"("organisationId", "territoryId", "collectionPointStatus");

