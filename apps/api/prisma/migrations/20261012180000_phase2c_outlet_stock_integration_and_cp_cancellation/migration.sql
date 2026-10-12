-- AlterEnum
ALTER TYPE "CollectionPointFulfillmentStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
ALTER TYPE "InventoryTransactionType" ADD VALUE 'DELIVERY';

-- AlterTable
ALTER TABLE "collection_point_fulfillments" ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT;

-- AlterTable
ALTER TABLE "sales_fulfilments" ADD COLUMN     "destinationLocationId" TEXT;

-- CreateIndex
CREATE INDEX "sales_fulfilments_destinationLocationId_idx" ON "sales_fulfilments"("destinationLocationId");

-- AddForeignKey
ALTER TABLE "sales_fulfilments" ADD CONSTRAINT "sales_fulfilments_destinationLocationId_fkey" FOREIGN KEY ("destinationLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

