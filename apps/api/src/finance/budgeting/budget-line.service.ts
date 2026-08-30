import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BudgetLine, BudgetStatus } from '@prisma/client';
import { CreateBudgetLineInput, UpdateBudgetLineInput } from '@zentuva/validation';

import { BudgetService } from './budget.service';
import { BudgetLineRepository, UpsertBudgetLineResult } from './budget-line.repository';
import { truncateToMonth } from './fiscal-year';

/** Domain service for the `BudgetLine` aggregate (Sprint 16, docs/domains/
 *  budgeting.md §6) — every write is routed through `BudgetService.
 *  assertLineWritable()` first, so the `DRAFT`-only guard, account-type
 *  eligibility, and fiscal-month-range checks are never duplicated. */
@Injectable()
export class BudgetLineService {
  constructor(
    private readonly budgetLineRepository: BudgetLineRepository,
    private readonly budgetService: BudgetService,
  ) {}

  list(budgetId: string): Promise<BudgetLine[]> {
    return this.budgetLineRepository.findManyByBudget(budgetId);
  }

  async upsert(
    organisationId: string,
    budgetId: string,
    input: CreateBudgetLineInput,
    actorUserId: string,
  ): Promise<UpsertBudgetLineResult> {
    const periodMonth = truncateToMonth(input.periodMonth);
    await this.budgetService.assertLineWritable(organisationId, budgetId, {
      lineType: input.lineType,
      chartOfAccountId: input.chartOfAccountId,
      periodMonth,
    });

    return this.budgetLineRepository.upsert({
      budgetId,
      chartOfAccountId: input.chartOfAccountId,
      costCentreId: input.costCentreId,
      lineType: input.lineType,
      periodMonth,
      amount: input.amount,
      description: input.description,
      notes: input.notes,
      actorUserId,
    });
  }

  async update(
    organisationId: string,
    budgetId: string,
    lineId: string,
    input: UpdateBudgetLineInput,
    actorUserId: string,
  ): Promise<BudgetLine> {
    const budget = await this.budgetService.getById(organisationId, budgetId);
    if (budget.status !== BudgetStatus.DRAFT) {
      throw new BadRequestException(
        'This budget is no longer a draft and cannot be edited directly — create a revision instead',
      );
    }
    const updated = await this.budgetLineRepository.update(budgetId, lineId, {
      amount: input.amount,
      description: input.description,
      notes: input.notes,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Budget line not found');
    }
    return updated;
  }
}
