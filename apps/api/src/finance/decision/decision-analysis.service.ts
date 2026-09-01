import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DecisionAnalysis, DecisionAnalysisStatus } from '@prisma/client';
import { CreateDecisionAnalysisInput, UpdateDecisionAnalysisInput } from '@zentuva/validation';

import { CapitalProjectRepository } from '../investment/capital-project.repository';
import { DebtFacilityRepository } from '../debt/debt-facility.repository';
import {
  CreateDecisionAnalysisResult,
  DecisionAnalysisRepository,
  ListDecisionAnalysesParams,
} from './decision-analysis.repository';

/**
 * Domain service for the `DecisionAnalysis` aggregate (Sprint 19, docs/
 * domains/financial-decision-analysis.md) — the MVP-closing management-
 * decision layer. Lifecycle only; every ROI/NPV/IRR/payback/sensitivity/
 * recommendation figure lives on `DecisionScenarioService`, computed live.
 * Never posts a Journal Entry, never mutates the Capital Project or Debt
 * Facility it optionally references (read-only links, decision #13/#14).
 */
@Injectable()
export class DecisionAnalysisService {
  constructor(
    private readonly decisionAnalysisRepository: DecisionAnalysisRepository,
    private readonly capitalProjectRepository: CapitalProjectRepository,
    private readonly debtFacilityRepository: DebtFacilityRepository,
  ) {}

  async getById(organisationId: string, id: string): Promise<DecisionAnalysis> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListDecisionAnalysesParams): Promise<DecisionAnalysis[]> {
    return this.decisionAnalysisRepository.findManyByOrganisation(organisationId, params);
  }

  async create(
    organisationId: string,
    input: CreateDecisionAnalysisInput,
    actorUserId: string,
  ): Promise<CreateDecisionAnalysisResult> {
    await this.validateReferences(organisationId, input);
    return this.decisionAnalysisRepository.create({
      organisationId,
      name: input.name,
      description: input.description,
      decisionType: input.decisionType,
      analysisPeriodMonths: input.analysisPeriodMonths,
      discountRatePercent: input.discountRatePercent,
      maxAcceptablePaybackYears: input.maxAcceptablePaybackYears,
      capitalProjectId: input.capitalProjectId,
      debtFacilityId: input.debtFacilityId,
      currency: input.currency,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
    });
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateDecisionAnalysisInput,
  ): Promise<DecisionAnalysis> {
    const analysis = await this.getByIdOrThrow(organisationId, id);
    this.assertEditable(analysis);
    await this.validateReferences(organisationId, input);
    const updated = await this.decisionAnalysisRepository.update(organisationId, id, {
      name: input.name,
      description: input.description,
      decisionType: input.decisionType,
      analysisPeriodMonths: input.analysisPeriodMonths,
      discountRatePercent: input.discountRatePercent,
      maxAcceptablePaybackYears: input.maxAcceptablePaybackYears,
      capitalProjectId: input.capitalProjectId,
      debtFacilityId: input.debtFacilityId,
      notes: input.notes,
    });
    if (!updated) {
      throw new NotFoundException('Decision analysis not found');
    }
    return updated;
  }

  async submit(
    organisationId: string,
    id: string,
  ): Promise<{ decisionAnalysis: DecisionAnalysis; transitioned: boolean }> {
    return this.transition(
      organisationId,
      id,
      [DecisionAnalysisStatus.DRAFT],
      DecisionAnalysisStatus.UNDER_REVIEW,
      {
        submittedAt: new Date(),
      },
    );
  }

  async approve(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<{ decisionAnalysis: DecisionAnalysis; transitioned: boolean }> {
    return this.transition(
      organisationId,
      id,
      [DecisionAnalysisStatus.UNDER_REVIEW],
      DecisionAnalysisStatus.APPROVED,
      { approvedById: actorUserId, approvedAt: new Date() },
    );
  }

  async reject(
    organisationId: string,
    id: string,
    actorUserId: string,
    rejectionReason?: string,
  ): Promise<{ decisionAnalysis: DecisionAnalysis; transitioned: boolean }> {
    return this.transition(
      organisationId,
      id,
      [DecisionAnalysisStatus.UNDER_REVIEW],
      DecisionAnalysisStatus.REJECTED,
      { rejectedById: actorUserId, rejectedAt: new Date(), rejectionReason },
    );
  }

  assertEditable(analysis: DecisionAnalysis): void {
    if (
      analysis.status !== DecisionAnalysisStatus.DRAFT &&
      analysis.status !== DecisionAnalysisStatus.UNDER_REVIEW
    ) {
      throw new BadRequestException(
        `Cannot edit a ${analysis.status.toLowerCase().replace('_', ' ')} decision analysis`,
      );
    }
  }

  async getByIdOrThrow(organisationId: string, id: string): Promise<DecisionAnalysis> {
    const analysis = await this.decisionAnalysisRepository.findById(organisationId, id);
    if (!analysis) {
      throw new NotFoundException('Decision analysis not found');
    }
    return analysis;
  }

  private async validateReferences(
    organisationId: string,
    input: { capitalProjectId?: string | null; debtFacilityId?: string | null },
  ): Promise<void> {
    if (input.capitalProjectId) {
      const project = await this.capitalProjectRepository.findById(
        organisationId,
        input.capitalProjectId,
      );
      if (!project) {
        throw new BadRequestException('Linked capital project not found');
      }
    }
    if (input.debtFacilityId) {
      const facility = await this.debtFacilityRepository.findById(
        organisationId,
        input.debtFacilityId,
      );
      if (!facility) {
        throw new BadRequestException('Linked debt facility not found');
      }
    }
  }

  /** Soft, status-based idempotency (docs/domains/financial-decision-
   *  analysis.md "Idempotency") — a valid retry returns the original
   *  result, never a duplicate audit event or an error. */
  private async transition(
    organisationId: string,
    id: string,
    fromStatuses: DecisionAnalysisStatus[],
    toStatus: DecisionAnalysisStatus,
    extraData: Record<string, unknown>,
  ): Promise<{ decisionAnalysis: DecisionAnalysis; transitioned: boolean }> {
    const analysis = await this.getByIdOrThrow(organisationId, id);
    if (analysis.status === toStatus) {
      return { decisionAnalysis: analysis, transitioned: false };
    }
    if (!fromStatuses.includes(analysis.status)) {
      throw new BadRequestException(
        `Cannot move a ${analysis.status.toLowerCase().replace('_', ' ')} decision analysis to ${toStatus
          .toLowerCase()
          .replace('_', ' ')}`,
      );
    }
    const updated = await this.decisionAnalysisRepository.setStatus(organisationId, id, {
      status: toStatus,
      ...extraData,
    });
    if (!updated) {
      throw new NotFoundException('Decision analysis not found');
    }
    return { decisionAnalysis: updated, transitioned: true };
  }
}
