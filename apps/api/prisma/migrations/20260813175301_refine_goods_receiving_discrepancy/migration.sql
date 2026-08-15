/*
  Warnings:

  - You are about to drop the column `quantityReceived` on the `goods_receipt_items` table. All the data in the column will be lost.
  - Added the required column `acceptedQuantity` to the `goods_receipt_items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `deliveredQuantity` to the `goods_receipt_items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `purchaseOrderItemId` to the `goods_receipt_items` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "RejectionReason" AS ENUM ('DAMAGED', 'DEFECTIVE', 'WRONG_ITEM', 'WRONG_SPECIFICATION', 'CONTAMINATED', 'OTHER');

-- CreateEnum
CREATE TYPE "DiscrepancyStatus" AS ENUM ('NONE', 'PENDING_SUPPLIER', 'REPLACEMENT_EXPECTED', 'REPLACEMENT_RECEIVED', 'CREDIT_EXPECTED', 'RESOLVED');

-- AlterEnum
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'PARTIALLY_RECEIVED';

-- AlterTable
ALTER TABLE "goods_receipt_items" DROP COLUMN "quantityReceived",
ADD COLUMN     "acceptedQuantity" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "deliveredQuantity" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "purchaseOrderItemId" TEXT NOT NULL,
ADD COLUMN     "rejectedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "rejectionNotes" TEXT,
ADD COLUMN     "rejectionReason" "RejectionReason";

-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN     "discrepancyNotes" TEXT,
ADD COLUMN     "discrepancyStatus" "DiscrepancyStatus" NOT NULL DEFAULT 'NONE';

-- CreateIndex
CREATE INDEX "goods_receipt_items_purchaseOrderItemId_idx" ON "goods_receipt_items"("purchaseOrderItemId");

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_purchaseOrderItemId_fkey" FOREIGN KEY ("purchaseOrderItemId") REFERENCES "purchase_order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
