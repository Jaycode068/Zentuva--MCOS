-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'APPROVED', 'ACTIVE', 'SUPERSEDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "BudgetLineType" AS ENUM ('REVENUE', 'OPERATING_EXPENSE', 'CAPEX');

-- CreateEnum
CREATE TYPE "CostCentreStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "budgetCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fiscalYear" INTEGER NOT NULL,
    "scenarioName" TEXT NOT NULL DEFAULT 'Base',
    "version" INTEGER NOT NULL DEFAULT 1,
    "revisesBudgetId" TEXT,
    "cashflowScenarioId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "chartOfAccountId" TEXT,
    "costCentreId" TEXT,
    "lineType" "BudgetLineType" NOT NULL,
    "periodMonth" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centres" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CostCentreStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cost_centres_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budgets_organisationId_status_idx" ON "budgets"("organisationId", "status");

-- CreateIndex
CREATE INDEX "budgets_organisationId_budgetCode_idx" ON "budgets"("organisationId", "budgetCode");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_organisationId_budgetCode_scenarioName_version_key" ON "budgets"("organisationId", "budgetCode", "scenarioName", "version");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_organisationId_idempotencyKey_key" ON "budgets"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "budget_lines_budgetId_idx" ON "budget_lines"("budgetId");

-- CreateIndex
CREATE UNIQUE INDEX "budget_lines_budgetId_chartOfAccountId_costCentreId_periodM_key" ON "budget_lines"("budgetId", "chartOfAccountId", "costCentreId", "periodMonth", "lineType");

-- CreateIndex
CREATE INDEX "cost_centres_organisationId_idx" ON "cost_centres"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centres_organisationId_code_key" ON "cost_centres"("organisationId", "code");

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_revisesBudgetId_fkey" FOREIGN KEY ("revisesBudgetId") REFERENCES "budgets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_cashflowScenarioId_fkey" FOREIGN KEY ("cashflowScenarioId") REFERENCES "cashflow_scenarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_chartOfAccountId_fkey" FOREIGN KEY ("chartOfAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_costCentreId_fkey" FOREIGN KEY ("costCentreId") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centres" ADD CONSTRAINT "cost_centres_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
