-- CreateEnum
CREATE TYPE "MaintenanceTypeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MaintenancePlanStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MaintenanceScheduleType" AS ENUM ('DATE_BASED', 'METER_BASED');

-- CreateEnum
CREATE TYPE "MaintenanceFrequencyUnit" AS ENUM ('DAYS', 'WEEKS', 'MONTHS', 'YEARS');

-- CreateEnum
CREATE TYPE "MaintenanceScheduleStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "MaintenancePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MaintenanceIssueType" AS ENUM ('BREAKDOWN', 'PERFORMANCE', 'SAFETY', 'NOISE', 'LEAK', 'ELECTRICAL', 'MECHANICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenanceRequestStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CONVERTED_TO_WORK_ORDER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkOrderTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "MaintenanceCostCategory" AS ENUM ('LABOUR', 'PARTS', 'SERVICE', 'TRANSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenancePartUsageType" AS ENUM ('CONSUMED', 'RETURNED');

-- CreateEnum
CREATE TYPE "MaintenanceDocumentEntityType" AS ENUM ('REQUEST', 'WORK_ORDER');

-- CreateEnum
CREATE TYPE "MaintenanceDocumentType" AS ENUM ('BEFORE_PHOTO', 'AFTER_PHOTO', 'INVOICE', 'REPORT', 'OTHER');

-- CreateTable
CREATE TABLE "maintenance_types" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "MaintenanceTypeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_plans" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "maintenanceTypeId" TEXT NOT NULL,
    "assetId" TEXT,
    "assetCategoryId" TEXT,
    "status" "MaintenancePlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "priority" "MaintenancePriority" NOT NULL DEFAULT 'MEDIUM',
    "estimatedDurationMinutes" INTEGER,
    "instructions" TEXT,
    "safetyNotes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_plan_tasks" (
    "id" TEXT NOT NULL,
    "maintenancePlanId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "estimatedDurationMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_plan_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_schedules" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "maintenancePlanId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "scheduleType" "MaintenanceScheduleType" NOT NULL,
    "frequencyValue" INTEGER,
    "frequencyUnit" "MaintenanceFrequencyUnit",
    "nextDueDate" TIMESTAMP(3),
    "meterType" "AssetMeterType",
    "meterInterval" DOUBLE PRECISION,
    "nextDueMeterReading" DOUBLE PRECISION,
    "lastGeneratedAt" TIMESTAMP(3),
    "lastGeneratedWorkOrderId" TEXT,
    "status" "MaintenanceScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_requests" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "requestCode" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "reportedById" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "MaintenancePriority" NOT NULL DEFAULT 'MEDIUM',
    "issueType" "MaintenanceIssueType",
    "status" "MaintenanceRequestStatus" NOT NULL DEFAULT 'OPEN',
    "requestedDueDate" TIMESTAMP(3),
    "notes" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_orders" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "workOrderCode" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "maintenanceTypeId" TEXT NOT NULL,
    "maintenancePlanId" TEXT,
    "maintenanceRequestId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "MaintenancePriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToId" TEXT,
    "plannedStartAt" TIMESTAMP(3),
    "plannedEndAt" TIMESTAMP(3),
    "actualStartAt" TIMESTAMP(3),
    "actualEndAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "rootCause" TEXT,
    "correctiveAction" TEXT,
    "resolution" TEXT,
    "notes" TEXT,
    "isExternalService" BOOLEAN NOT NULL DEFAULT false,
    "externalSupplierId" TEXT,
    "externalProviderName" TEXT,
    "externalReference" TEXT,
    "externalSentAt" TIMESTAMP(3),
    "externalReturnedAt" TIMESTAMP(3),
    "meterReadingId" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_order_tasks" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkOrderTaskStatus" NOT NULL DEFAULT 'PENDING',
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "assignedToId" TEXT,
    "estimatedDurationMinutes" INTEGER,
    "actualDurationMinutes" INTEGER,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_order_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_downtimes" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "reason" TEXT,
    "planned" BOOLEAN NOT NULL DEFAULT false,
    "recordedById" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_downtimes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_part_usages" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitOfMeasure" TEXT,
    "usageType" "MaintenancePartUsageType" NOT NULL DEFAULT 'CONSUMED',
    "notes" TEXT,
    "inventoryTransactionId" TEXT,
    "recordedById" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_part_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_costs" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "category" "MaintenanceCostCategory" NOT NULL,
    "description" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "supplierId" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "recordedById" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "maintenance_costs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_documents" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "entityType" "MaintenanceDocumentEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "documentType" "MaintenanceDocumentType" NOT NULL,
    "url" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fileName" TEXT,
    "caption" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "maintenance_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "maintenance_types_organisationId_status_idx" ON "maintenance_types"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_types_organisationId_code_key" ON "maintenance_types"("organisationId", "code");

-- CreateIndex
CREATE INDEX "maintenance_plans_organisationId_status_idx" ON "maintenance_plans"("organisationId", "status");

-- CreateIndex
CREATE INDEX "maintenance_plans_organisationId_assetId_idx" ON "maintenance_plans"("organisationId", "assetId");

-- CreateIndex
CREATE INDEX "maintenance_plans_organisationId_assetCategoryId_idx" ON "maintenance_plans"("organisationId", "assetCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_plans_organisationId_idempotencyKey_key" ON "maintenance_plans"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_plan_tasks_maintenancePlanId_sequence_key" ON "maintenance_plan_tasks"("maintenancePlanId", "sequence");

-- CreateIndex
CREATE INDEX "maintenance_schedules_organisationId_status_idx" ON "maintenance_schedules"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_schedules_maintenancePlanId_assetId_key" ON "maintenance_schedules"("maintenancePlanId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_schedules_organisationId_idempotencyKey_key" ON "maintenance_schedules"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "maintenance_requests_organisationId_status_idx" ON "maintenance_requests"("organisationId", "status");

-- CreateIndex
CREATE INDEX "maintenance_requests_organisationId_assetId_idx" ON "maintenance_requests"("organisationId", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_requests_organisationId_requestCode_key" ON "maintenance_requests"("organisationId", "requestCode");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_requests_organisationId_idempotencyKey_key" ON "maintenance_requests"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "work_orders_organisationId_status_idx" ON "work_orders"("organisationId", "status");

-- CreateIndex
CREATE INDEX "work_orders_organisationId_assetId_idx" ON "work_orders"("organisationId", "assetId");

-- CreateIndex
CREATE INDEX "work_orders_organisationId_priority_idx" ON "work_orders"("organisationId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_organisationId_workOrderCode_key" ON "work_orders"("organisationId", "workOrderCode");

-- CreateIndex
CREATE UNIQUE INDEX "work_orders_organisationId_idempotencyKey_key" ON "work_orders"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "work_order_tasks_workOrderId_sequence_key" ON "work_order_tasks"("workOrderId", "sequence");

-- CreateIndex
CREATE INDEX "asset_downtimes_organisationId_assetId_idx" ON "asset_downtimes"("organisationId", "assetId");

-- CreateIndex
CREATE INDEX "asset_downtimes_workOrderId_idx" ON "asset_downtimes"("workOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "asset_downtimes_organisationId_idempotencyKey_key" ON "asset_downtimes"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "maintenance_part_usages_workOrderId_idx" ON "maintenance_part_usages"("workOrderId");

-- CreateIndex
CREATE INDEX "maintenance_part_usages_organisationId_productId_idx" ON "maintenance_part_usages"("organisationId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_part_usages_organisationId_idempotencyKey_key" ON "maintenance_part_usages"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "maintenance_costs_workOrderId_idx" ON "maintenance_costs"("workOrderId");

-- CreateIndex
CREATE INDEX "maintenance_costs_organisationId_category_idx" ON "maintenance_costs"("organisationId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "maintenance_costs_organisationId_idempotencyKey_key" ON "maintenance_costs"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "maintenance_documents_organisationId_idx" ON "maintenance_documents"("organisationId");

-- CreateIndex
CREATE INDEX "maintenance_documents_entityType_entityId_idx" ON "maintenance_documents"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "maintenance_types" ADD CONSTRAINT "maintenance_types_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_maintenanceTypeId_fkey" FOREIGN KEY ("maintenanceTypeId") REFERENCES "maintenance_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_assetCategoryId_fkey" FOREIGN KEY ("assetCategoryId") REFERENCES "asset_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_plan_tasks" ADD CONSTRAINT "maintenance_plan_tasks_maintenancePlanId_fkey" FOREIGN KEY ("maintenancePlanId") REFERENCES "maintenance_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_maintenancePlanId_fkey" FOREIGN KEY ("maintenancePlanId") REFERENCES "maintenance_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_maintenanceTypeId_fkey" FOREIGN KEY ("maintenanceTypeId") REFERENCES "maintenance_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_maintenancePlanId_fkey" FOREIGN KEY ("maintenancePlanId") REFERENCES "maintenance_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "maintenance_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_externalSupplierId_fkey" FOREIGN KEY ("externalSupplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_order_tasks" ADD CONSTRAINT "work_order_tasks_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_downtimes" ADD CONSTRAINT "asset_downtimes_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_downtimes" ADD CONSTRAINT "asset_downtimes_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_downtimes" ADD CONSTRAINT "asset_downtimes_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_part_usages" ADD CONSTRAINT "maintenance_part_usages_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_part_usages" ADD CONSTRAINT "maintenance_part_usages_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_part_usages" ADD CONSTRAINT "maintenance_part_usages_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_costs" ADD CONSTRAINT "maintenance_costs_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_costs" ADD CONSTRAINT "maintenance_costs_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_costs" ADD CONSTRAINT "maintenance_costs_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_documents" ADD CONSTRAINT "maintenance_documents_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
