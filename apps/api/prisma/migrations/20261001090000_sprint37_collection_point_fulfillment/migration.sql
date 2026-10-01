-- CreateEnum
CREATE TYPE "CollectionPointFulfillmentStatus" AS ENUM ('ASSIGNED', 'PREPARING', 'READY_FOR_COLLECTION', 'COLLECTED');

-- AlterTable
ALTER TABLE "outlets" ADD COLUMN     "inventoryLocationId" TEXT;

-- CreateTable
CREATE TABLE "collection_point_fulfillments" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "status" "CollectionPointFulfillmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "preparingAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),
    "collectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "collection_point_fulfillments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "collection_point_fulfillments_salesOrderId_key" ON "collection_point_fulfillments"("salesOrderId");

-- CreateIndex
CREATE INDEX "collection_point_fulfillments_organisationId_idx" ON "collection_point_fulfillments"("organisationId");

-- CreateIndex
CREATE INDEX "collection_point_fulfillments_organisationId_outletId_statu_idx" ON "collection_point_fulfillments"("organisationId", "outletId", "status");

-- AddForeignKey
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_inventoryLocationId_fkey" FOREIGN KEY ("inventoryLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_point_fulfillments" ADD CONSTRAINT "collection_point_fulfillments_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_point_fulfillments" ADD CONSTRAINT "collection_point_fulfillments_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_point_fulfillments" ADD CONSTRAINT "collection_point_fulfillments_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

