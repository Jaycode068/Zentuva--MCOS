-- CreateEnum
CREATE TYPE "LocationStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AdjustmentReason" AS ENUM ('PHYSICAL_COUNT', 'DAMAGE', 'SPOILAGE', 'LOSS', 'FOUND_STOCK', 'DATA_CORRECTION', 'OTHER');

-- DropIndex
DROP INDEX "inventory_stock_organisationId_productId_key";

-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN     "locationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "inventory_stock" ADD COLUMN     "locationId" TEXT NOT NULL,
ADD COLUMN     "quantityReserved" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "inventory_transactions" ADD COLUMN     "adjustmentReason" "AdjustmentReason",
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "locationId" TEXT NOT NULL,
ADD COLUMN     "notes" TEXT,
ALTER COLUMN "referenceId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "inventory_locations" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "LocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_locations_organisationId_idx" ON "inventory_locations"("organisationId");

-- CreateIndex
CREATE INDEX "inventory_locations_organisationId_status_idx" ON "inventory_locations"("organisationId", "status");

-- CreateIndex
CREATE INDEX "goods_receipts_locationId_idx" ON "goods_receipts"("locationId");

-- CreateIndex
CREATE INDEX "inventory_stock_locationId_idx" ON "inventory_stock"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_stock_organisationId_productId_locationId_key" ON "inventory_stock"("organisationId", "productId", "locationId");

-- CreateIndex
CREATE INDEX "inventory_transactions_locationId_idx" ON "inventory_transactions"("locationId");

-- AddForeignKey
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_stock" ADD CONSTRAINT "inventory_stock_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

