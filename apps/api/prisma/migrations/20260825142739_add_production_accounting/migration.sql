-- AlterTable
ALTER TABLE "inventory_stock" ADD COLUMN     "averageUnitCost" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "production_material_issues" ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "production_runs" ADD COLUMN     "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "production_material_issues_productionOrderId_idempotencyKey_key" ON "production_material_issues"("productionOrderId", "idempotencyKey");
