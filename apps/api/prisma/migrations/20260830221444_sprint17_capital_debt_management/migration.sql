-- CreateEnum
CREATE TYPE "LenderType" AS ENUM ('BANK', 'FINANCIAL_INSTITUTION', 'INVESTOR', 'DIRECTOR', 'SHAREHOLDER', 'OTHER');

-- CreateEnum
CREATE TYPE "LenderStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CapitalRequirementType" AS ENUM ('CAPEX', 'WORKING_CAPITAL', 'EXPANSION', 'EQUIPMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "CapitalRequirementPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CapitalRequirementStatus" AS ENUM ('DRAFT', 'PROPOSED', 'APPROVED', 'FUNDED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DebtType" AS ENUM ('TERM_LOAN', 'WORKING_CAPITAL', 'ASSET_FINANCE', 'OVERDRAFT', 'OTHER');

-- CreateEnum
CREATE TYPE "InterestType" AS ENUM ('FIXED');

-- CreateEnum
CREATE TYPE "RepaymentMethod" AS ENUM ('AMORTISING', 'INTEREST_ONLY', 'BULLET');

-- CreateEnum
CREATE TYPE "RepaymentFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "DebtFacilityStatus" AS ENUM ('PROPOSED', 'APPROVED', 'ACTIVE', 'PARTIALLY_REPAID', 'PAID_OFF', 'CANCELLED', 'DEFAULTED');

-- CreateEnum
CREATE TYPE "DebtScheduleStatus" AS ENUM ('SCHEDULED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE');

-- AlterEnum
ALTER TYPE "CashflowForecastSourceType" ADD VALUE 'LOAN_REPAYMENT';

-- CreateTable
CREATE TABLE "lenders" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LenderType" NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "status" "LenderStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capital_requirements" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "requiredAmount" DOUBLE PRECISION NOT NULL,
    "requiredDate" TIMESTAMP(3) NOT NULL,
    "type" "CapitalRequirementType" NOT NULL,
    "status" "CapitalRequirementStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "CapitalRequirementPriority" NOT NULL DEFAULT 'MEDIUM',
    "budgetId" TEXT,
    "budgetLineId" TEXT,
    "costCentreId" TEXT,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "fundedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capital_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt_facilities" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "facilityCode" TEXT NOT NULL,
    "lenderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "debtType" "DebtType" NOT NULL,
    "principalAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "interestRatePercent" DOUBLE PRECISION NOT NULL,
    "interestType" "InterestType" NOT NULL DEFAULT 'FIXED',
    "repaymentMethod" "RepaymentMethod" NOT NULL,
    "repaymentFrequency" "RepaymentFrequency" NOT NULL DEFAULT 'MONTHLY',
    "startDate" TIMESTAMP(3) NOT NULL,
    "tenorMonths" INTEGER NOT NULL,
    "graceMonths" INTEGER NOT NULL DEFAULT 0,
    "maturityDate" TIMESTAMP(3) NOT NULL,
    "status" "DebtFacilityStatus" NOT NULL DEFAULT 'PROPOSED',
    "liabilityAccountId" TEXT NOT NULL,
    "interestExpenseAccountId" TEXT NOT NULL,
    "capitalRequirementId" TEXT,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "defaultedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debt_facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt_drawdowns" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "debtFacilityId" TEXT NOT NULL,
    "cashAccountId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "drawdownDate" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debt_drawdowns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt_repayment_schedules" (
    "id" TEXT NOT NULL,
    "debtFacilityId" TEXT NOT NULL,
    "installmentNumber" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "openingPrincipal" DOUBLE PRECISION NOT NULL,
    "principalDue" DOUBLE PRECISION NOT NULL,
    "interestDue" DOUBLE PRECISION NOT NULL,
    "totalDue" DOUBLE PRECISION NOT NULL,
    "closingPrincipal" DOUBLE PRECISION NOT NULL,
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "DebtScheduleStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debt_repayment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt_repayments" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "debtFacilityId" TEXT NOT NULL,
    "cashAccountId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "principalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interestAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feeAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feeExpenseAccountId" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debt_repayments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lenders_organisationId_idx" ON "lenders"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "lenders_organisationId_name_key" ON "lenders"("organisationId", "name");

-- CreateIndex
CREATE INDEX "capital_requirements_organisationId_status_idx" ON "capital_requirements"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "capital_requirements_organisationId_idempotencyKey_key" ON "capital_requirements"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "debt_facilities_organisationId_status_idx" ON "debt_facilities"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "debt_facilities_organisationId_facilityCode_key" ON "debt_facilities"("organisationId", "facilityCode");

-- CreateIndex
CREATE UNIQUE INDEX "debt_facilities_organisationId_idempotencyKey_key" ON "debt_facilities"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "debt_drawdowns_debtFacilityId_idx" ON "debt_drawdowns"("debtFacilityId");

-- CreateIndex
CREATE UNIQUE INDEX "debt_drawdowns_organisationId_idempotencyKey_key" ON "debt_drawdowns"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "debt_repayment_schedules_debtFacilityId_status_idx" ON "debt_repayment_schedules"("debtFacilityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "debt_repayment_schedules_debtFacilityId_installmentNumber_key" ON "debt_repayment_schedules"("debtFacilityId", "installmentNumber");

-- CreateIndex
CREATE INDEX "debt_repayments_debtFacilityId_idx" ON "debt_repayments"("debtFacilityId");

-- CreateIndex
CREATE UNIQUE INDEX "debt_repayments_organisationId_idempotencyKey_key" ON "debt_repayments"("organisationId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "lenders" ADD CONSTRAINT "lenders_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_requirements" ADD CONSTRAINT "capital_requirements_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_requirements" ADD CONSTRAINT "capital_requirements_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_requirements" ADD CONSTRAINT "capital_requirements_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "budget_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capital_requirements" ADD CONSTRAINT "capital_requirements_costCentreId_fkey" FOREIGN KEY ("costCentreId") REFERENCES "cost_centres"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_facilities" ADD CONSTRAINT "debt_facilities_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_facilities" ADD CONSTRAINT "debt_facilities_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "lenders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_facilities" ADD CONSTRAINT "debt_facilities_liabilityAccountId_fkey" FOREIGN KEY ("liabilityAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_facilities" ADD CONSTRAINT "debt_facilities_interestExpenseAccountId_fkey" FOREIGN KEY ("interestExpenseAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_facilities" ADD CONSTRAINT "debt_facilities_capitalRequirementId_fkey" FOREIGN KEY ("capitalRequirementId") REFERENCES "capital_requirements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_drawdowns" ADD CONSTRAINT "debt_drawdowns_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_drawdowns" ADD CONSTRAINT "debt_drawdowns_debtFacilityId_fkey" FOREIGN KEY ("debtFacilityId") REFERENCES "debt_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_drawdowns" ADD CONSTRAINT "debt_drawdowns_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_repayment_schedules" ADD CONSTRAINT "debt_repayment_schedules_debtFacilityId_fkey" FOREIGN KEY ("debtFacilityId") REFERENCES "debt_facilities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_repayments" ADD CONSTRAINT "debt_repayments_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_repayments" ADD CONSTRAINT "debt_repayments_debtFacilityId_fkey" FOREIGN KEY ("debtFacilityId") REFERENCES "debt_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_repayments" ADD CONSTRAINT "debt_repayments_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_repayments" ADD CONSTRAINT "debt_repayments_feeExpenseAccountId_fkey" FOREIGN KEY ("feeExpenseAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
