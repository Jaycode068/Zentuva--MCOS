-- CreateEnum
CREATE TYPE "DiscrepancyResolutionAction" AS ENUM ('REPLACEMENT', 'RETURN', 'CREDIT', 'ACCEPT_AS_IS', 'PRICE_ADJUSTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerReturnReason" AS ENUM ('DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'WRONG_QUANTITY', 'CUSTOMER_REJECTED', 'QUALITY_ISSUE', 'EXPIRED', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerReturnStatus" AS ENUM ('REQUESTED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierReturnStatus" AS ENUM ('COMPLETED');

-- AlterEnum
ALTER TYPE "InventoryTransactionType" ADD VALUE 'RETURN';

-- AlterTable
ALTER TABLE "credit_notes" ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT;

-- AlterTable
ALTER TABLE "goods_receipt_items" ADD COLUMN     "replacedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "replacesRejectedItemId" TEXT,
ADD COLUMN     "returnedExcessQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "returnedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN     "discrepancyResolutionAction" "DiscrepancyResolutionAction",
ADD COLUMN     "replacesGoodsReceiptId" TEXT;

-- AlterTable
ALTER TABLE "sales_fulfilment_items" ADD COLUMN     "quantityReturned" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "customer_returns" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "returnCode" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "outletId" TEXT,
    "salesOrderId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "CustomerReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "returnDate" TIMESTAMP(3) NOT NULL,
    "reason" "CustomerReturnReason" NOT NULL,
    "reasonNotes" TEXT,
    "notes" TEXT,
    "photoUrl" TEXT,
    "photoKey" TEXT,
    "idempotencyKey" TEXT,
    "receivedIdempotencyKey" TEXT,
    "receivedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_return_items" (
    "id" TEXT NOT NULL,
    "customerReturnId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "salesFulfilmentItemId" TEXT NOT NULL,
    "quantityReturned" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantityResalable" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantityDamaged" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantityQuarantine" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantityScrap" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "quantityCredited" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_returns" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "returnCode" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "returnDate" TIMESTAMP(3) NOT NULL,
    "reason" "RejectionReason" NOT NULL,
    "reasonNotes" TEXT,
    "notes" TEXT,
    "photoUrl" TEXT,
    "photoKey" TEXT,
    "status" "SupplierReturnStatus" NOT NULL DEFAULT 'COMPLETED',
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_return_items" (
    "id" TEXT NOT NULL,
    "supplierReturnId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "goodsReceiptItemId" TEXT NOT NULL,
    "quantityReturned" DOUBLE PRECISION NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "excessPortion" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_returns_returnCode_key" ON "customer_returns"("returnCode");

-- CreateIndex
CREATE INDEX "customer_returns_organisationId_idx" ON "customer_returns"("organisationId");

-- CreateIndex
CREATE INDEX "customer_returns_organisationId_customerId_idx" ON "customer_returns"("organisationId", "customerId");

-- CreateIndex
CREATE INDEX "customer_returns_organisationId_status_idx" ON "customer_returns"("organisationId", "status");

-- CreateIndex
CREATE INDEX "customer_returns_salesOrderId_idx" ON "customer_returns"("salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_returns_salesOrderId_idempotencyKey_key" ON "customer_returns"("salesOrderId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "customer_return_items_customerReturnId_idx" ON "customer_return_items"("customerReturnId");

-- CreateIndex
CREATE INDEX "customer_return_items_salesFulfilmentItemId_idx" ON "customer_return_items"("salesFulfilmentItemId");

-- CreateIndex
CREATE INDEX "customer_return_items_productId_idx" ON "customer_return_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_returnCode_key" ON "supplier_returns"("returnCode");

-- CreateIndex
CREATE INDEX "supplier_returns_organisationId_idx" ON "supplier_returns"("organisationId");

-- CreateIndex
CREATE INDEX "supplier_returns_organisationId_supplierId_idx" ON "supplier_returns"("organisationId", "supplierId");

-- CreateIndex
CREATE INDEX "supplier_returns_purchaseOrderId_idx" ON "supplier_returns"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "supplier_returns_goodsReceiptId_idx" ON "supplier_returns"("goodsReceiptId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_goodsReceiptId_idempotencyKey_key" ON "supplier_returns"("goodsReceiptId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "supplier_return_items_supplierReturnId_idx" ON "supplier_return_items"("supplierReturnId");

-- CreateIndex
CREATE INDEX "supplier_return_items_goodsReceiptItemId_idx" ON "supplier_return_items"("goodsReceiptItemId");

-- CreateIndex
CREATE INDEX "supplier_return_items_productId_idx" ON "supplier_return_items"("productId");

-- CreateIndex
CREATE INDEX "credit_notes_sourceType_sourceId_idx" ON "credit_notes"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "goods_receipt_items_replacesRejectedItemId_idx" ON "goods_receipt_items"("replacesRejectedItemId");

-- CreateIndex
CREATE INDEX "goods_receipts_replacesGoodsReceiptId_idx" ON "goods_receipts"("replacesGoodsReceiptId");

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_replacesGoodsReceiptId_fkey" FOREIGN KEY ("replacesGoodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_replacesRejectedItemId_fkey" FOREIGN KEY ("replacesRejectedItemId") REFERENCES "goods_receipt_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "outlets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_returns" ADD CONSTRAINT "customer_returns_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_items" ADD CONSTRAINT "customer_return_items_customerReturnId_fkey" FOREIGN KEY ("customerReturnId") REFERENCES "customer_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_items" ADD CONSTRAINT "customer_return_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_return_items" ADD CONSTRAINT "customer_return_items_salesFulfilmentItemId_fkey" FOREIGN KEY ("salesFulfilmentItemId") REFERENCES "sales_fulfilment_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_goodsReceiptId_fkey" FOREIGN KEY ("goodsReceiptId") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_supplierReturnId_fkey" FOREIGN KEY ("supplierReturnId") REFERENCES "supplier_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_return_items" ADD CONSTRAINT "supplier_return_items_goodsReceiptItemId_fkey" FOREIGN KEY ("goodsReceiptItemId") REFERENCES "goods_receipt_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
