import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountType, Budget, BudgetLineType, BudgetStatus } from '@prisma/client';
import { CreateBudgetInput, UpdateBudgetInput } from '@zentuva/validation';

import { ChartOfAccountRepository } from '../accounting/chart-of-account.repository';
import { OrganisationService } from '../../identity/organisation/organisation.service';
import { CashflowScenarioRepository } from '../cashflow/cashflow-scenario.repository';
import { computeFiscalYearRange } from './fiscal-year';
import { BudgetRepository, CreateBudgetResult, ListBudgetsParams } from './budget.repository';

/** For `REVENUE`/`OPERATING_EXPENSE` `BudgetLine`s only — the `AccountType`(s)
 *  a referenced `ChartOfAccount` must have, service-validated (never derived
 *  automatically the other way — see docs/domains/budgeting.md §6). */
const ELIGIBLE_ACCOUNT_TYPES: Record<'REVENUE' | 'OPERATING_EXPENSE', AccountType[]> = {
  REVENUE: [AccountType.REVENUE],
  OPERATING_EXPENSE: [AccountType.EXPENSE, AccountType.COST_OF_SALES],
};

/** Domain service for the `Budget` aggregate (Sprint 16, docs/domains/
 *  budgeting.md) — lifecycle transitions, fiscal-year derivation, and the
 *  `DRAFT`-only editability guard every write below enforces. */
@Injectable()
export class BudgetService {
  constructor(
    private readonly budgetRepository: BudgetRepository,
    private readonly chartOfAccountRepository: ChartOfAccountRepository,
    private readonly organisationService: OrganisationService,
    private readonly cashflowScenarioRepository: CashflowScenarioRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<Budget> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListBudgetsParams): Promise<Budget[]> {
    return this.budgetRepository.findManyByOrganisation(organisationId, params);
  }

  listSiblings(organisationId: string, budgetCode: string, fiscalYear: number): Promise<Budget[]> {
    return this.budgetRepository.findSiblingsByCode(organisationId, budgetCode, fiscalYear);
  }

  async create(
    organisationId: string,
    input: CreateBudgetInput,
    actorUserId: string,
  ): Promise<CreateBudgetResult> {
    const organisation = await this.organisationService.getById(organisationId);
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }

    if (input.cashflowScenarioId) {
      const scenario = await this.cashflowScenarioRepository.findById(
        organisationId,
        input.cashflowScenarioId,
      );
      if (!scenario) {
        throw new NotFoundException('Cashflow scenario not found');
      }
    }

    const { startDate, endDate } = computeFiscalYearRange(
      input.fiscalYear,
      organisation.fiscalYearStart,
    );

    return this.budgetRepository.create({
      organisationId,
      budgetCode: input.budgetCode,
      name: input.name,
      description: input.description,
      fiscalYear: input.fiscalYear,
      scenarioName: input.scenarioName,
      cashflowScenarioId: input.cashflowScenarioId,
      startDate,
      endDate,
      currency: input.currency,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
    });
  }

  async update(organisationId: string, id: string, input: UpdateBudgetInput): Promise<Budget> {
    const budget = await this.getByIdOrThrow(organisationId, id);
    this.assertDraft(budget);
    if (input.cashflowScenarioId) {
      const scenario = await this.cashflowScenarioRepository.findById(
        organisationId,
        input.cashflowScenarioId,
      );
      if (!scenario) {
        throw new NotFoundException('Cashflow scenario not found');
      }
    }
    const updated = await this.budgetRepository.update(organisationId, id, {
      name: input.name,
      description: input.description,
      cashflowScenarioId: input.cashflowScenarioId,
      notes: input.notes,
    });
    if (!updated) {
      throw new NotFoundException('Budget not found');
    }
    return updated;
  }

  async approve(organisationId: string, id: string, actorUserId: string): Promise<Budget> {
    const budget = await this.getByIdOrThrow(organisationId, id);
    if (budget.status !== BudgetStatus.DRAFT) {
      throw new BadRequestException('Only a draft budget can be approved');
    }
    const updated = await this.budgetRepository.approve(organisationId, id, actorUserId);
    if (!updated) {
      throw new NotFoundException('Budget not found');
    }
    return updated;
  }

  async activate(organisationId: string, id: string): Promise<Budget> {
    const budget = await this.getByIdOrThrow(organisationId, id);
    if (budget.status !== BudgetStatus.APPROVED) {
      throw new BadRequestException('Only an approved budget can be activated');
    }
    const updated = await this.budgetRepository.activate(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Budget not found');
    }
    return updated;
  }

  async close(organisationId: string, id: string): Promise<Budget> {
    const budget = await this.getByIdOrThrow(organisationId, id);
    if (budget.status !== BudgetStatus.ACTIVE) {
      throw new BadRequestException('Only an active budget can be closed');
    }
    const updated = await this.budgetRepository.close(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Budget not found');
    }
    return updated;
  }

  async revise(organisationId: string, id: string, actorUserId: string): Promise<Budget> {
    const budget = await this.getByIdOrThrow(organisationId, id);
    if (budget.status === BudgetStatus.DRAFT) {
      throw new BadRequestException(
        'A draft budget can be edited directly — revise an approved, active, or closed one instead',
      );
    }
    const revision = await this.budgetRepository.revise(organisationId, id, actorUserId);
    if (!revision) {
      throw new NotFoundException('Budget not found');
    }
    return revision;
  }

  /** Validates a `BudgetLine`'s account/period against this budget before the
   *  caller (`BudgetLineService`) writes it — the DRAFT-only guard, the
   *  required-account-for-Revenue/OpEx rule, and the fiscal-month-range check
   *  all live here so both create and update paths share one implementation. */
  async assertLineWritable(
    organisationId: string,
    budgetId: string,
    params: { lineType: BudgetLineType; chartOfAccountId?: string; periodMonth: Date },
  ): Promise<Budget> {
    const budget = await this.getByIdOrThrow(organisationId, budgetId);
    this.assertDraft(budget);

    if (params.lineType !== BudgetLineType.CAPEX) {
      if (!params.chartOfAccountId) {
        throw new BadRequestException(`A ${params.lineType} line requires a chartOfAccountId`);
      }
      const account = await this.chartOfAccountRepository.findById(
        organisationId,
        params.chartOfAccountId,
      );
      if (!account) {
        throw new NotFoundException('Chart of account not found');
      }
      const eligibleTypes = ELIGIBLE_ACCOUNT_TYPES[params.lineType];
      if (!eligibleTypes.includes(account.type)) {
        throw new BadRequestException(
          `A ${params.lineType} line must reference a ${eligibleTypes.join('/')} account`,
        );
      }
    } else if (params.chartOfAccountId) {
      const account = await this.chartOfAccountRepository.findById(
        organisationId,
        params.chartOfAccountId,
      );
      if (!account) {
        throw new NotFoundException('Chart of account not found');
      }
    }

    const monthTime = new Date(
      params.periodMonth.getFullYear(),
      params.periodMonth.getMonth(),
      1,
    ).getTime();
    const startTime = new Date(
      budget.startDate.getFullYear(),
      budget.startDate.getMonth(),
      1,
    ).getTime();
    const endTime = new Date(budget.endDate.getFullYear(), budget.endDate.getMonth(), 1).getTime();
    if (monthTime < startTime || monthTime > endTime) {
      throw new BadRequestException("periodMonth falls outside this budget's fiscal year");
    }

    return budget;
  }

  private assertDraft(budget: Budget): void {
    if (budget.status !== BudgetStatus.DRAFT) {
      throw new BadRequestException(
        'This budget is no longer a draft and cannot be edited directly — create a revision instead',
      );
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<Budget> {
    const budget = await this.budgetRepository.findById(organisationId, id);
    if (!budget) {
      throw new NotFoundException('Budget not found');
    }
    return budget;
  }
}
