import { Injectable } from '@nestjs/common';
import { DecisionScenario, Prisma, RepaymentMethod } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateDecisionScenarioData {
  decisionAnalysisId: string;
  name: string;
  scenarioType?: DecisionScenario['scenarioType'];
  initialInvestment?: number;
  additionalCapex?: number;
  additionalMonthlyRevenue?: number;
  annualRevenueGrowthPercent?: number;
  rampUpMonths?: number;
  additionalMonthlyOperatingCost?: number;
  additionalMonthlyMaintenanceCost?: number;
  additionalMonthlyLabourCost?: number;
  additionalMonthlyUtilitiesCost?: number;
  additionalMonthlyLogisticsCost?: number;
  cashFundingAmount?: number;
  debtFundingAmount?: number;
  debtInterestRatePercent?: number;
  debtTermMonths?: number;
  debtRepaymentMethod?: RepaymentMethod;
  workingCapitalImpact?: number;
  notes?: string;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateDecisionScenarioResult {
  decisionScenario: DecisionScenario;
  wasCreated: boolean;
}

/**
 * Thin Prisma access for `DecisionScenario` (Sprint 19, docs/domains/
 * financial-decision-analysis.md) — every field is a raw planning
 * assumption; ROI/NPV/IRR/payback/break-even/sensitivity are always
 * recomputed live by `decision-calculations.ts`, never stored here.
 * Tenant scoping is enforced one level up, by the service confirming the
 * parent `DecisionAnalysis` belongs to the caller's organisation first —
 * the exact `CapitalProjectCostLineRepository` precedent.
 */
@Injectable()
export class DecisionScenarioRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByAnalysis(decisionAnalysisId: string): Promise<DecisionScenario[]> {
    return this.prisma.decisionScenario.findMany({
      where: { decisionAnalysisId },
      orderBy: { createdAt: 'asc' },
    });
  }

  findById(id: string): Promise<DecisionScenario | null> {
    return this.prisma.decisionScenario.findUnique({ where: { id } });
  }

  async create(data: CreateDecisionScenarioData): Promise<CreateDecisionScenarioResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.decisionScenario.findUnique({
          where: {
            decisionAnalysisId_idempotencyKey: {
              decisionAnalysisId: data.decisionAnalysisId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { decisionScenario: existing, wasCreated: false };
        }
      }

      const decisionScenario = await tx.decisionScenario.create({
        data: {
          decisionAnalysisId: data.decisionAnalysisId,
          name: data.name,
          scenarioType: data.scenarioType ?? 'CUSTOM',
          initialInvestment: data.initialInvestment,
          additionalCapex: data.additionalCapex ?? 0,
          additionalMonthlyRevenue: data.additionalMonthlyRevenue ?? 0,
          annualRevenueGrowthPercent: data.annualRevenueGrowthPercent ?? 0,
          rampUpMonths: data.rampUpMonths ?? 0,
          additionalMonthlyOperatingCost: data.additionalMonthlyOperatingCost ?? 0,
          additionalMonthlyMaintenanceCost: data.additionalMonthlyMaintenanceCost ?? 0,
          additionalMonthlyLabourCost: data.additionalMonthlyLabourCost ?? 0,
          additionalMonthlyUtilitiesCost: data.additionalMonthlyUtilitiesCost ?? 0,
          additionalMonthlyLogisticsCost: data.additionalMonthlyLogisticsCost ?? 0,
          cashFundingAmount: data.cashFundingAmount ?? 0,
          debtFundingAmount: data.debtFundingAmount ?? 0,
          debtInterestRatePercent: data.debtInterestRatePercent,
          debtTermMonths: data.debtTermMonths,
          debtRepaymentMethod: data.debtRepaymentMethod ?? 'AMORTISING',
          workingCapitalImpact: data.workingCapitalImpact ?? 0,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
        },
      });

      return { decisionScenario, wasCreated: true };
    });
  }

  async update(
    id: string,
    data: Prisma.DecisionScenarioUncheckedUpdateInput,
  ): Promise<DecisionScenario | null> {
    const result = await this.prisma.decisionScenario.updateMany({ where: { id }, data });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.decisionScenario.findUniqueOrThrow({ where: { id } });
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.prisma.decisionScenario.deleteMany({ where: { id } });
    return result.count > 0;
  }
}
