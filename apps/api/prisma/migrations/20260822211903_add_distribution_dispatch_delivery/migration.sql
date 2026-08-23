-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('READY', 'DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CANCELLED', 'FAILED');

-- AlterTable
ALTER TABLE "sales_fulfilment_items" ADD COLUMN     "quantityDispatched" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "dispatches" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "dispatchCode" TEXT NOT NULL,
    "salesFulfilmentId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "outletId" TEXT,
    "sourceLocationId" TEXT NOT NULL,
    "dispatchDate" TIMESTAMP(3) NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'READY',
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispatch_items" (
    "id" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "salesFulfilmentItemId" TEXT NOT NULL,
    "quantityDispatched" DOUBLE PRECISION NOT NULL,
    "quantityDelivered" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispatch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "deliveryDate" TIMESTAMP(3) NOT NULL,
    "receivedByName" TEXT,
    "notes" TEXT,
    "photoUrl" TEXT,
    "photoKey" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_items" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "dispatchItemId" TEXT NOT NULL,
    "quantityDelivered" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dispatches_dispatchCode_key" ON "dispatches"("dispatchCode");

-- CreateIndex
CREATE INDEX "dispatches_organisationId_idx" ON "dispatches"("organisationId");

-- CreateIndex
CREATE INDEX "dispatches_organisationId_status_idx" ON "dispatches"("organisationId", "status");

-- CreateIndex
CREATE INDEX "dispatches_organisationId_salesOrderId_idx" ON "dispatches"("organisationId", "salesOrderId");

-- CreateIndex
CREATE INDEX "dispatches_organisationId_customerId_idx" ON "dispatches"("organisationId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "dispatches_salesFulfilmentId_idempotencyKey_key" ON "dispatches"("salesFulfilmentId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "dispatch_items_dispatchId_idx" ON "dispatch_items"("dispatchId");

-- CreateIndex
CREATE INDEX "dispatch_items_productId_idx" ON "dispatch_items"("productId");

-- CreateIndex
CREATE INDEX "dispatch_items_salesFulfilmentItemId_idx" ON "dispatch_items"("salesFulfilmentItemId");

-- CreateIndex
CREATE INDEX "deliveries_organisationId_idx" ON "deliveries"("organisationId");

-- CreateIndex
CREATE INDEX "deliveries_organisationId_dispatchId_idx" ON "deliveries"("organisationId", "dispatchId");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_dispatchId_idempotencyKey_key" ON "deliveries"("dispatchId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "delivery_items_deliveryId_idx" ON "delivery_items"("deliveryId");

-- CreateIndex
CREATE INDEX "delivery_items_productId_idx" ON "delivery_items"("productId");

-- CreateIndex
CREATE INDEX "delivery_items_dispatchItemId_idx" ON "delivery_items"("dispatchItemId");

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_salesFulfilmentId_fkey" FOREIGN KEY ("salesFulfilmentId") REFERENCES "sales_fulfilments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_sourceLocationId_fkey" FOREIGN KEY ("sourceLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "dispatches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_salesFulfilmentItemId_fkey" FOREIGN KEY ("salesFulfilmentItemId") REFERENCES "sales_fulfilment_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "dispatches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_items" ADD CONSTRAINT "delivery_items_dispatchItemId_fkey" FOREIGN KEY ("dispatchItemId") REFERENCES "dispatch_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
