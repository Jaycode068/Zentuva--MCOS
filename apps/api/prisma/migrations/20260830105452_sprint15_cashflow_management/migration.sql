-- CreateEnum
CREATE TYPE "CashflowDirection" AS ENUM ('INFLOW', 'OUTFLOW');

-- CreateEnum
CREATE TYPE "CashflowRecurrence" AS ENUM ('ONE_TIME', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "CashflowItemStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CashflowForecastSourceType" AS ENUM ('CUSTOMER_RECEIVABLE', 'SUPPLIER_PAYABLE', 'RECURRING_ITEM', 'MANUAL_FORECAST', 'OTHER');

-- CreateTable
CREATE TABLE "cashflow_forecast_items" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "cashAccountId" TEXT,
    "direction" "CashflowDirection" NOT NULL,
    "sourceType" "CashflowForecastSourceType" NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "expectedDate" TIMESTAMP(3) NOT NULL,
    "recurrence" "CashflowRecurrence" NOT NULL DEFAULT 'ONE_TIME',
    "recurrenceEndDate" TIMESTAMP(3),
    "status" "CashflowItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashflow_forecast_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashflow_scenarios" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "inflowDelayDays" INTEGER NOT NULL DEFAULT 0,
    "inflowMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "outflowDelayDays" INTEGER NOT NULL DEFAULT 0,
    "outflowMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "status" "CashflowItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashflow_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashflow_forecast_adjustments" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "sourceType" "CashflowForecastSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "adjustedExpectedDate" TIMESTAMP(3),
    "adjustedAmount" DOUBLE PRECISION,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashflow_forecast_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashflow_settings" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "minimumCashReserve" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "defaultCollectionDelayDays" INTEGER NOT NULL DEFAULT 0,
    "defaultPaymentDelayDays" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashflow_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cashflow_forecast_items_organisationId_idx" ON "cashflow_forecast_items"("organisationId");

-- CreateIndex
CREATE INDEX "cashflow_forecast_items_organisationId_status_idx" ON "cashflow_forecast_items"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cashflow_forecast_items_organisationId_idempotencyKey_key" ON "cashflow_forecast_items"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "cashflow_scenarios_organisationId_idx" ON "cashflow_scenarios"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "cashflow_scenarios_organisationId_idempotencyKey_key" ON "cashflow_scenarios"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "cashflow_forecast_adjustments_organisationId_idx" ON "cashflow_forecast_adjustments"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "cashflow_forecast_adjustments_organisationId_sourceType_sou_key" ON "cashflow_forecast_adjustments"("organisationId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "cashflow_settings_organisationId_key" ON "cashflow_settings"("organisationId");

-- AddForeignKey
ALTER TABLE "cashflow_forecast_items" ADD CONSTRAINT "cashflow_forecast_items_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashflow_forecast_items" ADD CONSTRAINT "cashflow_forecast_items_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashflow_scenarios" ADD CONSTRAINT "cashflow_scenarios_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashflow_forecast_adjustments" ADD CONSTRAINT "cashflow_forecast_adjustments_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashflow_settings" ADD CONSTRAINT "cashflow_settings_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
