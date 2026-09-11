-- CreateEnum
CREATE TYPE "MaintenancePartUsageStatus" AS ENUM ('REQUESTED', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MaintenanceProcurementStatus" AS ENUM ('IDENTIFIED', 'LINKED', 'CANCELLED');

-- AlterTable
ALTER TABLE "maintenance_costs" ADD COLUMN     "costCentreId" TEXT;

-- AlterTable
ALTER TABLE "maintenance_part_usages" ADD COLUMN     "issueIdempotencyKey" TEXT,
ADD COLUMN     "issuedAt" TIMESTAMP(3),
ADD COLUMN     "issuedById" TEXT,
ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "status" "MaintenancePartUsageStatus" NOT NULL DEFAULT 'REQUESTED',
ADD COLUMN     "totalCost" DOUBLE PRECISION,
ADD COLUMN     "unitCost" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "maintenance_procurement_requirements" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "estimatedCost" DOUBLE PRECISION,
    "status" "MaintenanceProcurementStatus" NOT NULL DEFAULT 'IDENTIFIED',
    "purchaseOrderId" TEXT,
    "supplierId" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "linkedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_procurement_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_procurement_requirements_workOrderId_idx" ON "maintenance_procurement_requirements"("workOrderId");

-- CreateIndex
CREATE INDEX "maintenance_procurement_requirements_organisationId_status_idx" ON "maintenance_procurement_requirements"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_procurement_requirements_organisationId_idempot_key" ON "maintenance_procurement_requirements"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "maintenance_costs_organisationId_costCentreId_idx" ON "maintenance_costs"("organisationId", "costCentreId");

-- CreateIndex
CREATE INDEX "maintenance_part_usages_organisationId_status_idx" ON "maintenance_part_usages"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_part_usages_organisationId_issueIdempotencyKey_key" ON "maintenance_part_usages"("organisationId", "issueIdempotencyKey");

-- AddForeignKey
ALTER TABLE "maintenance_procurement_requirements" ADD CONSTRAINT "maintenance_procurement_requirements_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_procurement_requirements" ADD CONSTRAINT "maintenance_procurement_requirements_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_procurement_requirements" ADD CONSTRAINT "maintenance_procurement_requirements_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

