-- CreateEnum
CREATE TYPE "CapitalProjectStatus" AS ENUM ('DRAFT', 'PROPOSED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CapitalProjectCategory" AS ENUM ('PRODUCTION_EQUIPMENT', 'FACTORY_EXPANSION', 'WAREHOUSE', 'VEHICLE', 'POWER_ENERGY', 'TECHNOLOGY', 'INFRASTRUCTURE', 'OTHER');

-- CreateEnum
CREATE TYPE "CapitalProjectFundingType" AS ENUM ('CASH', 'DEBT', 'OTHER');

-- AlterEnum
ALTER TYPE "CashflowForecastSourceType" ADD VALUE 'CAPITAL_PROJECT';

-- CreateTable
CREATE TABLE "capital_projects" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "businessPurpose" TEXT,
    "category" "CapitalProjectCategory" NOT NULL,
    "status" "CapitalProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "ownerId" TEXT,
    "costCentreId" TEXT,
    "capitalRequirementId" TEXT,
    "budgetId" TEXT,
    "budgetLineId" TEXT,
    "plannedStartDate" TIMESTAMP(3) NOT NULL,
    "plannedCompletionDate" TIMESTAMP(3) NOT NULL,
    "actualStartDate" TIMESTAMP(3),
    "actualCompletionDate" TIMESTAMP(3),
    "expectedAnnualRevenueImpact" DOUBLE PRECISION,
    "expectedAnnualOperatingCostImpact" DOUBLE PRECISION,
    "expectedAnnualSavings" DOUBLE PRECISION,
    "usefulLifeYears" INTEGER,
    "currentCapacityUnitsPerDay" DOUBLE PRECISION,
    "expectedCapacityUnitsPerDay" DOUBLE PRECISION,
    "expectedCommissioningDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capital_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_project_cost_lines" (
    "id" TEXT NOT NULL,
    "capitalProjectId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "plannedAmount" DOUBLE PRECISION NOT NULL,
    "chartOfAccountId" TEXT,
    "costCentreId" TEXT,
    "plannedMonth" TIMESTAMP(3) NOT NULL,
    "purchaseOrderId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capital_project_cost_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_project_fundings" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "capitalProjectId" TEXT NOT NULL,
    "fundingType" "CapitalProjectFundingType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "debtFacilityId" TEXT,
    "cashAccountId" TEXT,
    "description" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capital_project_fundings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "capital_projects_organisationId_status_idx" ON "capital_projects"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "capital_projects_organisationId_projectCode_key" ON "capital_projects"("organisationId", "projectCode");

-- CreateIndex
CREATE UNIQUE INDEX "capital_projects_organisationId_idempotencyKey_key" ON "capital_projects"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "capital_project_cost_lines_capitalProjectId_idx" ON "capital_project_cost_lines"("capitalProjectId");

-- CreateIndex
CREATE INDEX "capital_project_cost_lines_purchaseOrderId_idx" ON "capital_project_cost_lines"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "capital_project_fundings_capitalProjectId_idx" ON "capital_project_fundings"("capitalProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "capital_project_fundings_organisationId_idempotencyKey_key" ON "capital_project_fundings"("organisationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "capital_projects" ADD CONSTRAINT "capital_projects_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_projects" ADD CONSTRAINT "capital_projects_costCentreId_fkey" FOREIGN KEY ("costCentreId") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_projects" ADD CONSTRAINT "capital_projects_capitalRequirementId_fkey" FOREIGN KEY ("capitalRequirementId") REFERENCES "capital_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_projects" ADD CONSTRAINT "capital_projects_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_projects" ADD CONSTRAINT "capital_projects_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "budget_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_project_cost_lines" ADD CONSTRAINT "capital_project_cost_lines_capitalProjectId_fkey" FOREIGN KEY ("capitalProjectId") REFERENCES "capital_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_project_cost_lines" ADD CONSTRAINT "capital_project_cost_lines_chartOfAccountId_fkey" FOREIGN KEY ("chartOfAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_project_cost_lines" ADD CONSTRAINT "capital_project_cost_lines_costCentreId_fkey" FOREIGN KEY ("costCentreId") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_project_cost_lines" ADD CONSTRAINT "capital_project_cost_lines_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_project_fundings" ADD CONSTRAINT "capital_project_fundings_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_project_fundings" ADD CONSTRAINT "capital_project_fundings_capitalProjectId_fkey" FOREIGN KEY ("capitalProjectId") REFERENCES "capital_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_project_fundings" ADD CONSTRAINT "capital_project_fundings_debtFacilityId_fkey" FOREIGN KEY ("debtFacilityId") REFERENCES "debt_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_project_fundings" ADD CONSTRAINT "capital_project_fundings_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
