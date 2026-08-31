import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CapitalRequirement, CapitalRequirementStatus } from '@prisma/client';
import { CreateCapitalRequirementInput, UpdateCapitalRequirementInput } from '@zentuva/validation';

import { BudgetLineRepository } from '../budgeting/budget-line.repository';
import { BudgetRepository } from '../budgeting/budget.repository';
import { CostCentreRepository } from '../budgeting/cost-centre.repository';
import {
  CapitalRequirementRepository,
  CreateCapitalRequirementResult,
  ListCapitalRequirementsParams,
} from './capital-requirement.repository';

export interface BudgetCoverage {
  budgetedAmount: number;
  requiredAmount: number;
  coveragePercent: number | null;
}

/** Domain service for the `CapitalRequirement` aggregate (Sprint 17,
 *  docs/domains/debt-management.md §3-5) — the lifecycle guard and the
 *  read-only Budget Coverage % computation (never mutates the budget it
 *  references). */
@Injectable()
export class CapitalRequirementService {
  constructor(
    private readonly capitalRequirementRepository: CapitalRequirementRepository,
    private readonly budgetRepository: BudgetRepository,
    private readonly budgetLineRepository: BudgetLineRepository,
    private readonly costCentreRepository: CostCentreRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<CapitalRequirement> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(
    organisationId: string,
    params?: ListCapitalRequirementsParams,
  ): Promise<CapitalRequirement[]> {
    return this.capitalRequirementRepository.findManyByOrganisation(organisationId, params);
  }

  async create(
    organisationId: string,
    input: CreateCapitalRequirementInput,
    actorUserId: string,
  ): Promise<CreateCapitalRequirementResult> {
    await this.validateReferences(organisationId, input);
    return this.capitalRequirementRepository.create({
      organisationId,
      title: input.title,
      description: input.description,
      requiredAmount: input.requiredAmount,
      requiredDate: input.requiredDate,
      type: input.type,
      priority: input.priority,
      budgetId: input.budgetId,
      budgetLineId: input.budgetLineId,
      costCentreId: input.costCentreId,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
    });
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateCapitalRequirementInput,
  ): Promise<CapitalRequirement> {
    const requirement = await this.getByIdOrThrow(organisationId, id);
    this.assertDraft(requirement);
    await this.validateReferences(organisationId, input);
    const updated = await this.capitalRequirementRepository.update(organisationId, id, {
      title: input.title,
      description: input.description,
      requiredAmount: input.requiredAmount,
      requiredDate: input.requiredDate,
      priority: input.priority,
      budgetId: input.budgetId,
      budgetLineId: input.budgetLineId,
      costCentreId: input.costCentreId,
      notes: input.notes,
    });
    if (!updated) {
      throw new NotFoundException('Capital requirement not found');
    }
    return updated;
  }

  async propose(organisationId: string, id: string): Promise<CapitalRequirement> {
    return this.transition(organisationId, id, 'DRAFT', {
      status: CapitalRequirementStatus.PROPOSED,
    });
  }

  async approve(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<CapitalRequirement> {
    return this.transition(organisationId, id, 'PROPOSED', {
      status: CapitalRequirementStatus.APPROVED,
      approvedById: actorUserId,
      approvedAt: new Date(),
    });
  }

  async fund(organisationId: string, id: string): Promise<CapitalRequirement> {
    return this.transition(organisationId, id, 'APPROVED', {
      status: CapitalRequirementStatus.FUNDED,
      fundedAt: new Date(),
    });
  }

  async complete(organisationId: string, id: string): Promise<CapitalRequirement> {
    return this.transition(organisationId, id, 'FUNDED', {
      status: CapitalRequirementStatus.COMPLETED,
      completedAt: new Date(),
    });
  }

  async cancel(organisationId: string, id: string): Promise<CapitalRequirement> {
    const requirement = await this.getByIdOrThrow(organisationId, id);
    if (
      requirement.status === CapitalRequirementStatus.COMPLETED ||
      requirement.status === CapitalRequirementStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `A ${requirement.status.toLowerCase()} capital requirement cannot be cancelled`,
      );
    }
    const updated = await this.capitalRequirementRepository.setStatus(organisationId, id, {
      status: CapitalRequirementStatus.CANCELLED,
      cancelledAt: new Date(),
    });
    if (!updated) {
      throw new NotFoundException('Capital requirement not found');
    }
    return updated;
  }

  /** Computed on read only — never writes to `Budget`/`BudgetLine`
   *  (docs/domains/debt-management.md "Budget Integration"). */
  async getBudgetCoverage(organisationId: string, id: string): Promise<BudgetCoverage | null> {
    const requirement = await this.getByIdOrThrow(organisationId, id);
    if (!requirement.budgetId) {
      return null;
    }

    let budgetedAmount = 0;
    if (requirement.budgetLineId) {
      const lines = await this.budgetLineRepository.findManyByBudget(requirement.budgetId);
      const line = lines.find((candidate) => candidate.id === requirement.budgetLineId);
      budgetedAmount = line?.amount ?? 0;
    } else {
      const lines = await this.budgetLineRepository.findManyByBudget(requirement.budgetId);
      budgetedAmount = lines
        .filter((line) => line.lineType === 'CAPEX')
        .reduce((sum, line) => sum + line.amount, 0);
    }

    const coveragePercent =
      requirement.requiredAmount === 0 ? null : (budgetedAmount / requirement.requiredAmount) * 100;

    return {
      budgetedAmount: Math.round(budgetedAmount * 100) / 100,
      requiredAmount: requirement.requiredAmount,
      coveragePercent: coveragePercent === null ? null : Math.round(coveragePercent * 100) / 100,
    };
  }

  private async transition(
    organisationId: string,
    id: string,
    fromStatus: CapitalRequirementStatus,
    data: Parameters<CapitalRequirementRepository['setStatus']>[2],
  ): Promise<CapitalRequirement> {
    const requirement = await this.getByIdOrThrow(organisationId, id);
    if (requirement.status !== fromStatus) {
      throw new BadRequestException(
        `Only a ${fromStatus.toLowerCase()} capital requirement can move to this status`,
      );
    }
    const updated = await this.capitalRequirementRepository.setStatus(organisationId, id, data);
    if (!updated) {
      throw new NotFoundException('Capital requirement not found');
    }
    return updated;
  }

  private async validateReferences(
    organisationId: string,
    input: { budgetId?: string | null; budgetLineId?: string | null; costCentreId?: string | null },
  ): Promise<void> {
    if (input.budgetId) {
      const budget = await this.budgetRepository.findById(organisationId, input.budgetId);
      if (!budget) {
        throw new NotFoundException('Budget not found');
      }
    }
    if (input.budgetLineId) {
      if (!input.budgetId) {
        throw new BadRequestException('budgetLineId requires budgetId');
      }
      const lines = await this.budgetLineRepository.findManyByBudget(input.budgetId);
      if (!lines.some((line) => line.id === input.budgetLineId)) {
        throw new NotFoundException('Budget line not found on this budget');
      }
    }
    if (input.costCentreId) {
      const costCentre = await this.costCentreRepository.findById(
        organisationId,
        input.costCentreId,
      );
      if (!costCentre) {
        throw new NotFoundException('Cost centre not found');
      }
    }
  }

  private assertDraft(requirement: CapitalRequirement): void {
    if (requirement.status !== CapitalRequirementStatus.DRAFT) {
      throw new BadRequestException('Only a draft capital requirement can be edited directly');
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<CapitalRequirement> {
    const requirement = await this.capitalRequirementRepository.findById(organisationId, id);
    if (!requirement) {
      throw new NotFoundException('Capital requirement not found');
    }
    return requirement;
  }
}
