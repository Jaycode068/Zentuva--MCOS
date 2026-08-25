-- AlterTable
ALTER TABLE "goods_receipt_items" ADD COLUMN     "payableQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill: every row that exists before this migration predates any accounting
-- integration (no JournalEntry was ever posted for a goods receipt before Sprint 8),
-- so there is nothing to reconcile — set payableQuantity = acceptedQuantity for all
-- pre-existing rows purely so old rows aren't left at a misleading 0. No new journals
-- are retroactively posted for them.
UPDATE "goods_receipt_items" SET "payableQuantity" = "acceptedQuantity";

-- AlterTable
ALTER TABLE "goods_receipts" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_purchaseOrderId_idempotencyKey_key" ON "goods_receipts"("purchaseOrderId", "idempotencyKey");
