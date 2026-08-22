-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SalesOrderStatus" ADD VALUE 'PARTIALLY_FULFILLED';
ALTER TYPE "SalesOrderStatus" ADD VALUE 'FULFILLED';

-- AlterTable
ALTER TABLE "sales_order_items" ADD COLUMN     "quantityFulfilled" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "sales_fulfilments" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "fulfilmentDate" TIMESTAMP(3) NOT NULL,
    "fulfilledById" TEXT,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_fulfilments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_fulfilment_items" (
    "id" TEXT NOT NULL,
    "salesFulfilmentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "salesOrderItemId" TEXT NOT NULL,
    "quantityFulfilled" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_fulfilment_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_fulfilments_organisationId_idx" ON "sales_fulfilments"("organisationId");

-- CreateIndex
CREATE INDEX "sales_fulfilments_organisationId_salesOrderId_idx" ON "sales_fulfilments"("organisationId", "salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_fulfilments_salesOrderId_idempotencyKey_key" ON "sales_fulfilments"("salesOrderId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "sales_fulfilment_items_salesFulfilmentId_idx" ON "sales_fulfilment_items"("salesFulfilmentId");

-- CreateIndex
CREATE INDEX "sales_fulfilment_items_productId_idx" ON "sales_fulfilment_items"("productId");

-- CreateIndex
CREATE INDEX "sales_fulfilment_items_salesOrderItemId_idx" ON "sales_fulfilment_items"("salesOrderItemId");

-- AddForeignKey
ALTER TABLE "sales_fulfilments" ADD CONSTRAINT "sales_fulfilments_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_fulfilments" ADD CONSTRAINT "sales_fulfilments_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_fulfilments" ADD CONSTRAINT "sales_fulfilments_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_fulfilment_items" ADD CONSTRAINT "sales_fulfilment_items_salesFulfilmentId_fkey" FOREIGN KEY ("salesFulfilmentId") REFERENCES "sales_fulfilments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_fulfilment_items" ADD CONSTRAINT "sales_fulfilment_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_fulfilment_items" ADD CONSTRAINT "sales_fulfilment_items_salesOrderItemId_fkey" FOREIGN KEY ("salesOrderItemId") REFERENCES "sales_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
