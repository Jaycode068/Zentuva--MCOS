-- CreateEnum
CREATE TYPE "DecisionAnalysisStatus" AS ENUM ('DRAFT', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('NEW_INVESTMENT', 'EXPANSION', 'EQUIPMENT_UPGRADE', 'COST_REDUCTION', 'OTHER');

-- CreateEnum
CREATE TYPE "DecisionScenarioType" AS ENUM ('BASE', 'OPTIMISTIC', 'PESSIMISTIC', 'CUSTOM');

-- CreateTable
CREATE TABLE "decision_analyses" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "decisionType" "DecisionType" NOT NULL,
    "status" "DecisionAnalysisStatus" NOT NULL DEFAULT 'DRAFT',
    "analysisPeriodMonths" INTEGER NOT NULL DEFAULT 60,
    "discountRatePercent" DOUBLE PRECISION NOT NULL DEFAULT 15,
    "maxAcceptablePaybackYears" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "capitalProjectId" TEXT,
    "debtFacilityId" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_scenarios" (
    "id" TEXT NOT NULL,
    "decisionAnalysisId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scenarioType" "DecisionScenarioType" NOT NULL DEFAULT 'CUSTOM',
    "initialInvestment" DOUBLE PRECISION,
    "additionalCapex" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "additionalMonthlyRevenue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "annualRevenueGrowthPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rampUpMonths" INTEGER NOT NULL DEFAULT 0,
    "additionalMonthlyOperatingCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "additionalMonthlyMaintenanceCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "additionalMonthlyLabourCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "additionalMonthlyUtilitiesCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "additionalMonthlyLogisticsCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cashFundingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "debtFundingAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "debtInterestRatePercent" DOUBLE PRECISION,
    "debtTermMonths" INTEGER,
    "debtRepaymentMethod" "RepaymentMethod" DEFAULT 'AMORTISING',
    "workingCapitalImpact" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "notes" TEXT,
    "idempotencyKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decision_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "decision_analyses_organisationId_status_idx" ON "decision_analyses"("organisationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "decision_analyses_organisationId_idempotencyKey_key" ON "decision_analyses"("organisationId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "decision_scenarios_decisionAnalysisId_name_key" ON "decision_scenarios"("decisionAnalysisId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "decision_scenarios_decisionAnalysisId_idempotencyKey_key" ON "decision_scenarios"("decisionAnalysisId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "decision_analyses" ADD CONSTRAINT "decision_analyses_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "organisations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_analyses" ADD CONSTRAINT "decision_analyses_capitalProjectId_fkey" FOREIGN KEY ("capitalProjectId") REFERENCES "capital_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_analyses" ADD CONSTRAINT "decision_analyses_debtFacilityId_fkey" FOREIGN KEY ("debtFacilityId") REFERENCES "debt_facilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_scenarios" ADD CONSTRAINT "decision_scenarios_decisionAnalysisId_fkey" FOREIGN KEY ("decisionAnalysisId") REFERENCES "decision_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
