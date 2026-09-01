import { Injectable } from '@nestjs/common';
import { DecisionAnalysis, DecisionAnalysisStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListDecisionAnalysesParams {
  status?: DecisionAnalysisStatus;
}

export interface CreateDecisionAnalysisData {
  organisationId: string;
  name: string;
  description?: string;
  decisionType: DecisionAnalysis['decisionType'];
  analysisPeriodMonths?: number;
  discountRatePercent?: number;
  maxAcceptablePaybackYears?: number;
  capitalProjectId?: string;
  debtFacilityId?: string;
  currency?: string;
  notes?: string;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateDecisionAnalysisResult {
  decisionAnalysis: DecisionAnalysis;
  wasCreated: boolean;
}

/**
 * Thin Prisma access for the `DecisionAnalysis` aggregate (Sprint 19,
 * docs/domains/financial-decision-analysis.md) — the MVP-closing
 * management-decision layer over Sprints 13-18. Posts nothing (see
 * `decision-independence.spec.ts`); every headline figure is computed live
 * by `decision-calculations.ts`, never stored on this row.
 */
@Injectable()
export class DecisionAnalysisRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<DecisionAnalysis | null> {
    return this.prisma.decisionAnalysis.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListDecisionAnalysesParams = {},
  ): Promise<DecisionAnalysis[]> {
    return this.prisma.decisionAnalysis.findMany({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: CreateDecisionAnalysisData): Promise<CreateDecisionAnalysisResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.decisionAnalysis.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { decisionAnalysis: existing, wasCreated: false };
        }
      }

      const decisionAnalysis = await tx.decisionAnalysis.create({
        data: {
          organisationId: data.organisationId,
          name: data.name,
          description: data.description,
          decisionType: data.decisionType,
          analysisPeriodMonths: data.analysisPeriodMonths ?? 60,
          discountRatePercent: data.discountRatePercent ?? 15,
          maxAcceptablePaybackYears: data.maxAcceptablePaybackYears ?? 3,
          capitalProjectId: data.capitalProjectId,
          debtFacilityId: data.debtFacilityId,
          currency: data.currency ?? 'NGN',
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
        },
      });

      return { decisionAnalysis, wasCreated: true };
    });
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.DecisionAnalysisUncheckedUpdateInput,
  ): Promise<DecisionAnalysis | null> {
    return this.updateMatching(organisationId, id, data);
  }

  setStatus(
    organisationId: string,
    id: string,
    data: Prisma.DecisionAnalysisUncheckedUpdateInput,
  ): Promise<DecisionAnalysis | null> {
    return this.updateMatching(organisationId, id, data);
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.DecisionAnalysisUncheckedUpdateInput,
  ): Promise<DecisionAnalysis | null> {
    const result = await this.prisma.decisionAnalysis.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.decisionAnalysis.findUniqueOrThrow({ where: { id } });
  }
}
