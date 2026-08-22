-- CreateEnum
CREATE TYPE "BillOfMaterialStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ProductionOrderStatus" AS ENUM ('DRAFT', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductionRejectionReason" AS ENUM ('BURNT', 'UNDERWEIGHT', 'PACKAGING_DEFECT', 'POOR_SEAL', 'OTHER');

-- CreateTable
CREATE TABLE "bill_of_materials" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "bomNumber" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT,
    "status" "BillOfMaterialStatus" NOT NULL DEFAULT 'DRAFT',
    "yieldQuantity" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_of_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_of_material_items" (
    "id" TEXT NOT NULL,
    "billOfMaterialId" TEXT NOT NULL,
    "componentProductId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitOfMeasure" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_of_material_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_orders" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "productionOrderNumber" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "billOfMaterialId" TEXT NOT NULL,
    "plannedQuantity" DOUBLE PRECISION NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "ProductionOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_order_items" (
    "id" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "componentProductId" TEXT NOT NULL,
    "requiredQuantity" DOUBLE PRECISION NOT NULL,
    "unitOfMeasure" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_material_issues" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "issuedDate" TIMESTAMP(3) NOT NULL,
    "issuedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_material_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_material_issue_items" (
    "id" TEXT NOT NULL,
    "productionMaterialIssueId" TEXT NOT NULL,
    "componentProductId" TEXT NOT NULL,
    "quantityIssued" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_material_issue_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_runs" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "productionOrderId" TEXT NOT NULL,
    "producedQuantity" DOUBLE PRECISION NOT NULL,
    "rejectedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "acceptedQuantity" DOUBLE PRECISION NOT NULL,
    "rejectionReason" "ProductionRejectionReason",
    "rejectionNotes" TEXT,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "production_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bill_of_materials_bomNumber_key" ON "bill_of_materials"("bomNumber");

-- CreateIndex
CREATE INDEX "bill_of_materials_organisationId_idx" ON "bill_of_materials"("organisationId");

-- CreateIndex
CREATE INDEX "bill_of_materials_organisationId_productId_idx" ON "bill_of_materials"("organisationId", "productId");

-- CreateIndex
CREATE INDEX "bill_of_materials_organisationId_productId_status_idx" ON "bill_of_materials"("organisationId", "productId", "status");

-- CreateIndex
CREATE INDEX "bill_of_material_items_billOfMaterialId_idx" ON "bill_of_material_items"("billOfMaterialId");

-- CreateIndex
CREATE INDEX "bill_of_material_items_componentProductId_idx" ON "bill_of_material_items"("componentProductId");

-- CreateIndex
CREATE UNIQUE INDEX "bill_of_material_items_billOfMaterialId_componentProductId_key" ON "bill_of_material_items"("billOfMaterialId", "componentProductId");

-- CreateIndex
CREATE UNIQUE INDEX "production_orders_productionOrderNumber_key" ON "production_orders"("productionOrderNumber");

-- CreateIndex
CREATE INDEX "production_orders_organisationId_idx" ON "production_orders"("organisationId");

-- CreateIndex
CREATE INDEX "production_orders_organisationId_status_idx" ON "production_orders"("organisationId", "status");

-- CreateIndex
CREATE INDEX "production_orders_organisationId_productId_idx" ON "production_orders"("organisationId", "productId");

-- CreateIndex
CREATE INDEX "production_orders_billOfMaterialId_idx" ON "production_orders"("billOfMaterialId");

-- CreateIndex
CREATE INDEX "production_orders_locationId_idx" ON "production_orders"("locationId");

-- CreateIndex
CREATE INDEX "production_order_items_productionOrderId_idx" ON "production_order_items"("productionOrderId");

-- CreateIndex
CREATE INDEX "production_order_items_componentProductId_idx" ON "production_order_items"("componentProductId");

-- CreateIndex
CREATE INDEX "production_material_issues_organisationId_idx" ON "production_material_issues"("organisationId");

-- CreateIndex
CREATE INDEX "production_material_issues_organisationId_productionOrderId_idx" ON "production_material_issues"("organisationId", "productionOrderId");

-- CreateIndex
CREATE INDEX "production_material_issue_items_productionMaterialIssueId_idx" ON "production_material_issue_items"("productionMaterialIssueId");

-- CreateIndex
CREATE INDEX "production_material_issue_items_componentProductId_idx" ON "production_material_issue_items"("componentProductId");

-- CreateIndex
CREATE UNIQUE INDEX "production_runs_productionOrderId_key" ON "production_runs"("productionOrderId");

-- CreateIndex
CREATE INDEX "production_runs_organisationId_idx" ON "production_runs"("organisationId");

-- AddForeignKey
ALTER TABLE "bill_of_materials" ADD CONSTRAINT "bill_of_materials_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_of_materials" ADD CONSTRAINT "bill_of_materials_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_of_material_items" ADD CONSTRAINT "bill_of_material_items_billOfMaterialId_fkey" FOREIGN KEY ("billOfMaterialId") REFERENCES "bill_of_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_of_material_items" ADD CONSTRAINT "bill_of_material_items_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_billOfMaterialId_fkey" FOREIGN KEY ("billOfMaterialId") REFERENCES "bill_of_materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_items" ADD CONSTRAINT "production_order_items_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_order_items" ADD CONSTRAINT "production_order_items_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_material_issues" ADD CONSTRAINT "production_material_issues_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_material_issues" ADD CONSTRAINT "production_material_issues_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_material_issue_items" ADD CONSTRAINT "production_material_issue_items_productionMaterialIssueId_fkey" FOREIGN KEY ("productionMaterialIssueId") REFERENCES "production_material_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_material_issue_items" ADD CONSTRAINT "production_material_issue_items_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_runs" ADD CONSTRAINT "production_runs_productionOrderId_fkey" FOREIGN KEY ("productionOrderId") REFERENCES "production_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
