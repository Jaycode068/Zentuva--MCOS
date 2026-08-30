import { Injectable } from '@nestjs/common';
import { BudgetLine, BudgetLineType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface UpsertBudgetLineData {
  budgetId: string;
  chartOfAccountId?: string;
  costCentreId?: string;
  lineType: BudgetLineType;
  periodMonth: Date;
  amount: number;
  description?: string;
  notes?: string;
  actorUserId: string;
}

export interface UpsertBudgetLineResult {
  budgetLine: BudgetLine;
  wasCreated: boolean;
}

/**
 * Thin Prisma access for the `BudgetLine` aggregate (Sprint 16, docs/domains/
 * budgeting.md §6). `REVENUE`/`OPERATING_EXPENSE` lines (`chartOfAccountId`
 * set) behave as an upsert — one line per account+cost-centre+month+type, a
 * re-POST updates the amount, matching the monthly-grid mental model where
 * each cell maps to exactly one row. `CAPEX` lines (`chartOfAccountId`
 * absent) are always a plain insert — discrete named items with no natural
 * key, never merged.
 */
@Injectable()
export class BudgetLineRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByBudget(budgetId: string): Promise<BudgetLine[]> {
    return this.prisma.budgetLine.findMany({
      where: { budgetId },
      orderBy: [{ lineType: 'asc' }, { periodMonth: 'asc' }],
    });
  }

  async upsert(data: UpsertBudgetLineData): Promise<UpsertBudgetLineResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.chartOfAccountId) {
        const existing = await tx.budgetLine.findFirst({
          where: {
            budgetId: data.budgetId,
            chartOfAccountId: data.chartOfAccountId,
            costCentreId: data.costCentreId ?? null,
            periodMonth: data.periodMonth,
            lineType: data.lineType,
          },
        });
        if (existing) {
          const budgetLine = await tx.budgetLine.update({
            where: { id: existing.id },
            data: {
              amount: data.amount,
              description: data.description,
              notes: data.notes,
              updatedById: data.actorUserId,
            },
          });
          return { budgetLine, wasCreated: false };
        }
      }

      const budgetLine = await tx.budgetLine.create({
        data: {
          budgetId: data.budgetId,
          chartOfAccountId: data.chartOfAccountId,
          costCentreId: data.costCentreId,
          lineType: data.lineType,
          periodMonth: data.periodMonth,
          amount: data.amount,
          description: data.description,
          notes: data.notes,
          createdById: data.actorUserId,
          updatedById: data.actorUserId,
        },
      });
      return { budgetLine, wasCreated: true };
    });
  }

  async update(
    budgetId: string,
    id: string,
    data: Prisma.BudgetLineUpdateInput,
  ): Promise<BudgetLine | null> {
    const result = await this.prisma.budgetLine.updateMany({ where: { id, budgetId }, data });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.budgetLine.findUniqueOrThrow({ where: { id } });
  }
}
