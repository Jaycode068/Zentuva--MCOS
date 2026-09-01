import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CapitalProject, CapitalProjectStatus } from '@prisma/client';
import {
  CreateCapitalProjectCostLineInput,
  CreateCapitalProjectFundingInput,
  CreateCapitalProjectInput,
  UpdateCapitalProjectInput,
} from '@zentuva/validation';

import { ChartOfAccountRepository } from '../accounting/chart-of-account.repository';
import { BudgetLineRepository } from '../budgeting/budget-line.repository';
import { BudgetRepository } from '../budgeting/budget.repository';
import { CostCentreRepository } from '../budgeting/cost-centre.repository';
import { CashAccountRepository } from '../cash/cash-account.repository';
import { CapitalRequirementRepository } from '../debt/capital-requirement.repository';
import { DebtFacilityRepository } from '../debt/debt-facility.repository';
import { PurchaseOrderRepository } from '../../procurement/purchase-order/purchase-order.repository';
import { SupplierInvoiceRepository } from '../supplier-invoice.repository';
import {
  CapitalProjectCostLineRepository,
  CreateCapitalProjectCostLineData,
} from './capital-project-cost-line.repository';
import {
  CapitalProjectFundingRepository,
  CreateCapitalProjectFundingResult,
} from './capital-project-funding.repository';
import {
  CapitalProjectRepository,
  CreateCapitalProjectResult,
  ListCapitalProjectsParams,
} from './capital-project.repository';

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export type FundingStatus = 'FULLY_FUNDED' | 'UNDERFUNDED' | 'OVERFUNDED';

export interface CapitalProjectFinancials {
  plannedCost: number;
  totalFunding: number;
  fundingGap: number;
  fundingStatus: FundingStatus;
  committedCost: number;
  actualCost: number;
  remainingCost: number;
}

export interface BudgetAllocation {
  budgetedAmount: number;
  plannedCost: number;
  allocationPercent: number | null;
}

/** Domain service for the `CapitalProject` aggregate (Sprint 18, docs/
 *  domains/investment-projects.md) — lifecycle guards, server-computed
 *  financials, and read-only Budget Allocation. Never posts a Journal
 *  Entry, never mutates Budget/Debt/Cash/Procurement data it references. */
@Injectable()
export class CapitalProjectService {
  constructor(
    private readonly capitalProjectRepository: CapitalProjectRepository,
    private readonly costLineRepository: CapitalProjectCostLineRepository,
    private readonly fundingRepository: CapitalProjectFundingRepository,
    private readonly budgetRepository: BudgetRepository,
    private readonly budgetLineRepository: BudgetLineRepository,
    private readonly costCentreRepository: CostCentreRepository,
    private readonly capitalRequirementRepository: CapitalRequirementRepository,
    private readonly debtFacilityRepository: DebtFacilityRepository,
    private readonly cashAccountRepository: CashAccountRepository,
    private readonly chartOfAccountRepository: ChartOfAccountRepository,
    private readonly purchaseOrderRepository: PurchaseOrderRepository,
    private readonly supplierInvoiceRepository: SupplierInvoiceRepository,
  ) {}

  async getById(
    organisationId: string,
    id: string,
  ): Promise<CapitalProject & { financials: CapitalProjectFinancials }> {
    const project = await this.getByIdOrThrow(organisationId, id);
    const financials = await this.getFinancials(organisationId, project);
    return { ...project, financials };
  }

  list(organisationId: string, params?: ListCapitalProjectsParams): Promise<CapitalProject[]> {
    return this.capitalProjectRepository.findManyByOrganisation(organisationId, params);
  }

  async listCostLines(organisationId: string, capitalProjectId: string) {
    await this.getByIdOrThrow(organisationId, capitalProjectId);
    return this.costLineRepository.findManyByProject(capitalProjectId);
  }

  async listFunding(organisationId: string, capitalProjectId: string) {
    await this.getByIdOrThrow(organisationId, capitalProjectId);
    return this.fundingRepository.findManyByProject(capitalProjectId);
  }

  async create(
    organisationId: string,
    input: CreateCapitalProjectInput,
    actorUserId: string,
  ): Promise<CreateCapitalProjectResult> {
    await this.validateReferences(organisationId, input);
    return this.capitalProjectRepository.create({
      organisationId,
      name: input.name,
      description: input.description,
      businessPurpose: input.businessPurpose,
      category: input.category,
      ownerId: input.ownerId,
      costCentreId: input.costCentreId,
      capitalRequirementId: input.capitalRequirementId,
      budgetId: input.budgetId,
      budgetLineId: input.budgetLineId,
      plannedStartDate: input.plannedStartDate,
      plannedCompletionDate: input.plannedCompletionDate,
      expectedAnnualRevenueImpact: input.expectedAnnualRevenueImpact,
      expectedAnnualOperatingCostImpact: input.expectedAnnualOperatingCostImpact,
      expectedAnnualSavings: input.expectedAnnualSavings,
      usefulLifeYears: input.usefulLifeYears,
      currentCapacityUnitsPerDay: input.currentCapacityUnitsPerDay,
      expectedCapacityUnitsPerDay: input.expectedCapacityUnitsPerDay,
      expectedCommissioningDate: input.expectedCommissioningDate,
      currency: input.currency,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
    });
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateCapitalProjectInput,
  ): Promise<CapitalProject> {
    const project = await this.getByIdOrThrow(organisationId, id);
    this.assertDraft(project);
    await this.validateReferences(organisationId, input);
    const updated = await this.capitalProjectRepository.update(organisationId, id, {
      name: input.name,
      description: input.description,
      businessPurpose: input.businessPurpose,
      category: input.category,
      ownerId: input.ownerId,
      costCentreId: input.costCentreId,
      capitalRequirementId: input.capitalRequirementId,
      budgetId: input.budgetId,
      budgetLineId: input.budgetLineId,
      plannedStartDate: input.plannedStartDate,
      plannedCompletionDate: input.plannedCompletionDate,
      expectedAnnualRevenueImpact: input.expectedAnnualRevenueImpact,
      expectedAnnualOperatingCostImpact: input.expectedAnnualOperatingCostImpact,
      expectedAnnualSavings: input.expectedAnnualSavings,
      usefulLifeYears: input.usefulLifeYears,
      currentCapacityUnitsPerDay: input.currentCapacityUnitsPerDay,
      expectedCapacityUnitsPerDay: input.expectedCapacityUnitsPerDay,
      expectedCommissioningDate: input.expectedCommissioningDate,
      notes: input.notes,
    });
    if (!updated) {
      throw new NotFoundException('Capital project not found');
    }
    return updated;
  }

  async submit(
    organisationId: string,
    id: string,
  ): Promise<{ capitalProject: CapitalProject; transitioned: boolean }> {
    return this.transition(
      organisationId,
      id,
      [CapitalProjectStatus.DRAFT],
      CapitalProjectStatus.PROPOSED,
      {},
    );
  }

  async startReview(
    organisationId: string,
    id: string,
  ): Promise<{ capitalProject: CapitalProject; transitioned: boolean }> {
    return this.transition(
      organisationId,
      id,
      [CapitalProjectStatus.PROPOSED],
      CapitalProjectStatus.UNDER_REVIEW,
      {},
    );
  }

  async approve(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<{ capitalProject: CapitalProject; transitioned: boolean }> {
    return this.transition(
      organisationId,
      id,
      [CapitalProjectStatus.UNDER_REVIEW],
      CapitalProjectStatus.APPROVED,
      { approvedById: actorUserId, approvedAt: new Date() },
    );
  }

  /** Sends the project back for revision rather than a dead end — an
   *  explicit design decision (docs/domains/investment-projects.md §6). */
  async reject(
    organisationId: string,
    id: string,
  ): Promise<{ capitalProject: CapitalProject; transitioned: boolean }> {
    return this.transition(
      organisationId,
      id,
      [CapitalProjectStatus.UNDER_REVIEW],
      CapitalProjectStatus.DRAFT,
      {},
    );
  }

  async activate(
    organisationId: string,
    id: string,
  ): Promise<{ capitalProject: CapitalProject; transitioned: boolean }> {
    return this.transition(
      organisationId,
      id,
      [CapitalProjectStatus.APPROVED],
      CapitalProjectStatus.ACTIVE,
      { activatedAt: new Date(), actualStartDate: new Date() },
    );
  }

  async hold(
    organisationId: string,
    id: string,
  ): Promise<{ capitalProject: CapitalProject; transitioned: boolean }> {
    return this.transition(
      organisationId,
      id,
      [CapitalProjectStatus.ACTIVE],
      CapitalProjectStatus.ON_HOLD,
      {},
    );
  }

  async resume(
    organisationId: string,
    id: string,
  ): Promise<{ capitalProject: CapitalProject; transitioned: boolean }> {
    return this.transition(
      organisationId,
      id,
      [CapitalProjectStatus.ON_HOLD],
      CapitalProjectStatus.ACTIVE,
      {},
    );
  }

  async complete(
    organisationId: string,
    id: string,
  ): Promise<{ capitalProject: CapitalProject; transitioned: boolean }> {
    return this.transition(
      organisationId,
      id,
      [CapitalProjectStatus.ACTIVE],
      CapitalProjectStatus.COMPLETED,
      { completedAt: new Date(), actualCompletionDate: new Date() },
    );
  }

  /** Never reachable directly from `ACTIVE` — an active project must be
   *  placed `ON_HOLD` first (the same "never cancel something already in
   *  motion" discipline `DebtFacility` established, Sprint 17). */
  async cancel(
    organisationId: string,
    id: string,
  ): Promise<{ capitalProject: CapitalProject; transitioned: boolean }> {
    return this.transition(
      organisationId,
      id,
      [
        CapitalProjectStatus.DRAFT,
        CapitalProjectStatus.PROPOSED,
        CapitalProjectStatus.UNDER_REVIEW,
        CapitalProjectStatus.APPROVED,
        CapitalProjectStatus.ON_HOLD,
      ],
      CapitalProjectStatus.CANCELLED,
      { cancelledAt: new Date() },
    );
  }

  /** Computed on read only — never writes to `Budget`/`BudgetLine`
   *  (mirrors `CapitalRequirementService.getBudgetCoverage`, decision #7:
   *  reimplemented locally rather than shared, a ~5-line formula). */
  async getBudgetAllocation(organisationId: string, id: string): Promise<BudgetAllocation | null> {
    const project = await this.getByIdOrThrow(organisationId, id);
    if (!project.budgetId) {
      return null;
    }
    const plannedCost = await this.getPlannedCost(id);

    let budgetedAmount = 0;
    const lines = await this.budgetLineRepository.findManyByBudget(project.budgetId);
    if (project.budgetLineId) {
      const line = lines.find((candidate) => candidate.id === project.budgetLineId);
      budgetedAmount = line?.amount ?? 0;
    } else {
      budgetedAmount = lines
        .filter((line) => line.lineType === 'CAPEX')
        .reduce((sum, line) => sum + line.amount, 0);
    }

    const allocationPercent = plannedCost === 0 ? null : (budgetedAmount / plannedCost) * 100;

    return {
      budgetedAmount: roundCurrency(budgetedAmount),
      plannedCost: roundCurrency(plannedCost),
      allocationPercent: allocationPercent === null ? null : roundCurrency(allocationPercent),
    };
  }

  async getSpending(organisationId: string, id: string): Promise<CapitalProjectFinancials> {
    const project = await this.getByIdOrThrow(organisationId, id);
    return this.getFinancials(organisationId, project);
  }

  async addCostLine(
    organisationId: string,
    capitalProjectId: string,
    input: CreateCapitalProjectCostLineInput,
    actorUserId: string,
  ) {
    const project = await this.getByIdOrThrow(organisationId, capitalProjectId);
    this.assertDraft(project);
    if (input.chartOfAccountId) {
      const account = await this.chartOfAccountRepository.findById(
        organisationId,
        input.chartOfAccountId,
      );
      if (!account) {
        throw new NotFoundException('Chart of account not found');
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
    if (input.purchaseOrderId) {
      const purchaseOrder = await this.purchaseOrderRepository.findById(
        organisationId,
        input.purchaseOrderId,
      );
      if (!purchaseOrder) {
        throw new NotFoundException('Purchase order not found');
      }
    }
    const data: CreateCapitalProjectCostLineData = {
      capitalProjectId,
      description: input.description,
      category: input.category,
      plannedAmount: input.plannedAmount,
      chartOfAccountId: input.chartOfAccountId,
      costCentreId: input.costCentreId,
      plannedMonth: input.plannedMonth,
      purchaseOrderId: input.purchaseOrderId,
      notes: input.notes,
      createdById: actorUserId,
    };
    return this.costLineRepository.create(data);
  }

  async removeCostLine(organisationId: string, capitalProjectId: string, costLineId: string) {
    const project = await this.getByIdOrThrow(organisationId, capitalProjectId);
    this.assertDraft(project);
    const removed = await this.costLineRepository.remove(costLineId);
    if (!removed) {
      throw new NotFoundException('Cost line not found');
    }
  }

  async addFunding(
    organisationId: string,
    capitalProjectId: string,
    input: CreateCapitalProjectFundingInput,
    actorUserId: string,
  ): Promise<CreateCapitalProjectFundingResult> {
    const project = await this.getByIdOrThrow(organisationId, capitalProjectId);
    this.assertFundingEditable(project);

    if (input.fundingType === 'DEBT') {
      if (!input.debtFacilityId) {
        throw new BadRequestException('debtFacilityId is required when fundingType is DEBT');
      }
      const facility = await this.debtFacilityRepository.findById(
        organisationId,
        input.debtFacilityId,
      );
      if (!facility) {
        throw new NotFoundException('Debt facility not found');
      }
    }
    if (input.cashAccountId) {
      const cashAccount = await this.cashAccountRepository.findById(
        organisationId,
        input.cashAccountId,
      );
      if (!cashAccount) {
        throw new NotFoundException('Cash account not found');
      }
    }

    return this.fundingRepository.create({
      organisationId,
      capitalProjectId,
      fundingType: input.fundingType,
      amount: input.amount,
      debtFacilityId: input.debtFacilityId,
      cashAccountId: input.cashAccountId,
      description: input.description,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
    });
  }

  async removeFunding(organisationId: string, capitalProjectId: string, fundingId: string) {
    const project = await this.getByIdOrThrow(organisationId, capitalProjectId);
    this.assertFundingEditable(project);
    const removed = await this.fundingRepository.remove(organisationId, fundingId);
    if (!removed) {
      throw new NotFoundException('Funding not found');
    }
  }

  private async getPlannedCost(capitalProjectId: string): Promise<number> {
    const lines = await this.costLineRepository.findManyByProject(capitalProjectId);
    return roundCurrency(lines.reduce((sum, line) => sum + line.plannedAmount, 0));
  }

  private async getFinancials(
    organisationId: string,
    project: CapitalProject,
  ): Promise<CapitalProjectFinancials> {
    const [costLines, fundingRows] = await Promise.all([
      this.costLineRepository.findManyByProject(project.id),
      this.fundingRepository.findManyByProject(project.id),
    ]);

    const plannedCost = roundCurrency(costLines.reduce((sum, line) => sum + line.plannedAmount, 0));
    const totalFunding = roundCurrency(fundingRows.reduce((sum, row) => sum + row.amount, 0));
    const fundingGap = roundCurrency(Math.max(0, plannedCost - totalFunding));
    const fundingStatus: FundingStatus =
      totalFunding === plannedCost
        ? 'FULLY_FUNDED'
        : totalFunding < plannedCost
          ? 'UNDERFUNDED'
          : 'OVERFUNDED';

    const purchaseOrderIds = [
      ...new Set(
        costLines.map((line) => line.purchaseOrderId).filter((id): id is string => id !== null),
      ),
    ];

    let committedCost = 0;
    let actualCost = 0;
    if (purchaseOrderIds.length > 0) {
      const results = await Promise.all(
        purchaseOrderIds.map(async (purchaseOrderId) => {
          const [purchaseOrder, ap] = await Promise.all([
            this.purchaseOrderRepository.findById(organisationId, purchaseOrderId),
            this.supplierInvoiceRepository.getApByPurchaseOrder(organisationId, purchaseOrderId),
          ]);
          return {
            committed:
              purchaseOrder && purchaseOrder.status !== 'CANCELLED' ? purchaseOrder.total : 0,
            actual: ap.aggregate._sum.recognizedAmount ?? 0,
          };
        }),
      );
      committedCost = roundCurrency(results.reduce((sum, row) => sum + row.committed, 0));
      actualCost = roundCurrency(results.reduce((sum, row) => sum + row.actual, 0));
    }

    const remainingCost = roundCurrency(plannedCost - committedCost);

    return {
      plannedCost,
      totalFunding,
      fundingGap,
      fundingStatus,
      committedCost,
      actualCost,
      remainingCost,
    };
  }

  private async transition(
    organisationId: string,
    id: string,
    fromStatuses: CapitalProjectStatus[],
    toStatus: CapitalProjectStatus,
    extraData: Record<string, unknown>,
  ): Promise<{ capitalProject: CapitalProject; transitioned: boolean }> {
    const project = await this.getByIdOrThrow(organisationId, id);
    if (project.status === toStatus) {
      // Soft, status-based idempotency (docs/domains/investment-projects.md
      // §11) — a valid retry returns the original result, never a
      // duplicate audit event or an error.
      return { capitalProject: project, transitioned: false };
    }
    if (!fromStatuses.includes(project.status)) {
      throw new BadRequestException(
        `Cannot move a ${project.status.toLowerCase()} project to ${toStatus.toLowerCase()}`,
      );
    }
    const updated = await this.capitalProjectRepository.setStatus(organisationId, id, {
      status: toStatus,
      ...extraData,
    });
    if (!updated) {
      throw new NotFoundException('Capital project not found');
    }
    return { capitalProject: updated, transitioned: true };
  }

  private async validateReferences(
    organisationId: string,
    input: {
      costCentreId?: string | null;
      capitalRequirementId?: string | null;
      budgetId?: string | null;
      budgetLineId?: string | null;
    },
  ): Promise<void> {
    if (input.costCentreId) {
      const costCentre = await this.costCentreRepository.findById(
        organisationId,
        input.costCentreId,
      );
      if (!costCentre) {
        throw new NotFoundException('Cost centre not found');
      }
    }
    if (input.capitalRequirementId) {
      const requirement = await this.capitalRequirementRepository.findById(
        organisationId,
        input.capitalRequirementId,
      );
      if (!requirement) {
        throw new NotFoundException('Capital requirement not found');
      }
    }
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
  }

  private assertDraft(project: CapitalProject): void {
    if (project.status !== CapitalProjectStatus.DRAFT) {
      throw new BadRequestException('Only a draft project can be edited directly');
    }
  }

  private assertFundingEditable(project: CapitalProject): void {
    const editableStatuses: CapitalProjectStatus[] = [
      CapitalProjectStatus.DRAFT,
      CapitalProjectStatus.PROPOSED,
      CapitalProjectStatus.UNDER_REVIEW,
      CapitalProjectStatus.APPROVED,
      CapitalProjectStatus.ACTIVE,
    ];
    if (!editableStatuses.includes(project.status)) {
      throw new BadRequestException(
        `Funding cannot be changed on a ${project.status.toLowerCase()} project`,
      );
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<CapitalProject> {
    const project = await this.capitalProjectRepository.findById(organisationId, id);
    if (!project) {
      throw new NotFoundException('Capital project not found');
    }
    return project;
  }
}
