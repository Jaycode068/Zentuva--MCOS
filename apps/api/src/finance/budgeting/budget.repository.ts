import { Injectable } from '@nestjs/common';
import { Budget, BudgetStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListBudgetsParams {
  status?: BudgetStatus;
  fiscalYear?: number;
  budgetCode?: string;
}

export interface CreateBudgetData {
  organisationId: string;
  budgetCode: string;
  name: string;
  description?: string;
  fiscalYear: number;
  scenarioName: string;
  cashflowScenarioId?: string;
  startDate: Date;
  endDate: Date;
  currency: string;
  notes?: string;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateBudgetResult {
  budget: Budget;
  wasCreated: boolean;
}

/**
 * Thin Prisma access for the `Budget` aggregate (Sprint 16, docs/domains/
 * budgeting.md) — a `Budget` row is its own version *and* its own scenario
 * (docs/domains/budgeting.md §3/§4), never a second table for either concept.
 */
@Injectable()
export class BudgetRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<Budget | null> {
    return this.prisma.budget.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListBudgetsParams = {},
  ): Promise<Budget[]> {
    return this.prisma.budget.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.fiscalYear ? { fiscalYear: params.fiscalYear } : {}),
        ...(params.budgetCode ? { budgetCode: params.budgetCode } : {}),
      },
      orderBy: [{ budgetCode: 'asc' }, { scenarioName: 'asc' }, { version: 'desc' }],
    });
  }

  /** Every sibling row sharing this budget's own `budgetCode`+`fiscalYear`
   *  (every scenario, every version) — the raw material for the frontend's
   *  scenario-comparison table (docs/domains/budgeting.md §15). */
  findSiblingsByCode(
    organisationId: string,
    budgetCode: string,
    fiscalYear: number,
  ): Promise<Budget[]> {
    return this.prisma.budget.findMany({
      where: { organisationId, budgetCode, fiscalYear },
      orderBy: [{ scenarioName: 'asc' }, { version: 'desc' }],
    });
  }

  /** The currently `ACTIVE` row for this exact `(budgetCode, scenarioName)`
   *  lineage, if any — used by `activate()` to know what to supersede. */
  findActiveInLineage(
    organisationId: string,
    budgetCode: string,
    scenarioName: string,
    excludeId?: string,
  ): Promise<Budget | null> {
    return this.prisma.budget.findFirst({
      where: {
        organisationId,
        budgetCode,
        scenarioName,
        status: BudgetStatus.ACTIVE,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  }

  async create(data: CreateBudgetData): Promise<CreateBudgetResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.budget.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { budget: existing, wasCreated: false };
        }
      }

      const budget = await tx.budget.create({
        data: {
          organisationId: data.organisationId,
          budgetCode: data.budgetCode,
          name: data.name,
          description: data.description,
          fiscalYear: data.fiscalYear,
          scenarioName: data.scenarioName,
          cashflowScenarioId: data.cashflowScenarioId,
          startDate: data.startDate,
          endDate: data.endDate,
          currency: data.currency,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
        },
      });

      return { budget, wasCreated: true };
    });
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.BudgetUncheckedUpdateInput,
  ): Promise<Budget | null> {
    return this.updateMatching(organisationId, id, data);
  }

  approve(organisationId: string, id: string, actorUserId: string): Promise<Budget | null> {
    return this.updateMatching(organisationId, id, {
      status: BudgetStatus.APPROVED,
      approvedById: actorUserId,
      approvedAt: new Date(),
    });
  }

  close(organisationId: string, id: string): Promise<Budget | null> {
    return this.updateMatching(organisationId, id, {
      status: BudgetStatus.CLOSED,
      closedAt: new Date(),
    });
  }

  /** Activates `id` and, inside the same transaction, supersedes whatever
   *  other row currently holds `ACTIVE` in the same `(budgetCode,
   *  scenarioName)` lineage (docs/domains/budgeting.md §5) — never two
   *  simultaneously-`ACTIVE` rows for the same lineage. */
  async activate(organisationId: string, id: string): Promise<Budget | null> {
    return this.prisma.$transaction(async (tx) => {
      const budget = await tx.budget.findFirst({ where: { id, organisationId } });
      if (!budget) {
        return null;
      }

      const previouslyActive = await tx.budget.findFirst({
        where: {
          organisationId,
          budgetCode: budget.budgetCode,
          scenarioName: budget.scenarioName,
          status: BudgetStatus.ACTIVE,
          id: { not: id },
        },
      });
      if (previouslyActive) {
        await tx.budget.update({
          where: { id: previouslyActive.id },
          data: { status: BudgetStatus.SUPERSEDED },
        });
      }

      return tx.budget.update({
        where: { id },
        data: { status: BudgetStatus.ACTIVE, activatedAt: new Date() },
      });
    });
  }

  /** Creates the next version in this budget's own lineage — `DRAFT`, one
   *  version higher, `revisesBudgetId` pointing back at `id` — and copies
   *  every current `BudgetLine` across so a revision starts as a full,
   *  independently-editable copy rather than an empty shell. */
  async revise(organisationId: string, id: string, actorUserId: string): Promise<Budget | null> {
    return this.prisma.$transaction(async (tx) => {
      const source = await tx.budget.findFirst({
        where: { id, organisationId },
        include: { lines: true },
      });
      if (!source) {
        return null;
      }

      const revision = await tx.budget.create({
        data: {
          organisationId,
          budgetCode: source.budgetCode,
          name: source.name,
          description: source.description,
          fiscalYear: source.fiscalYear,
          scenarioName: source.scenarioName,
          version: source.version + 1,
          revisesBudgetId: source.id,
          cashflowScenarioId: source.cashflowScenarioId,
          startDate: source.startDate,
          endDate: source.endDate,
          currency: source.currency,
          notes: source.notes,
          createdById: actorUserId,
        },
      });

      if (source.lines.length > 0) {
        await tx.budgetLine.createMany({
          data: source.lines.map((line) => ({
            budgetId: revision.id,
            chartOfAccountId: line.chartOfAccountId,
            costCentreId: line.costCentreId,
            lineType: line.lineType,
            periodMonth: line.periodMonth,
            amount: line.amount,
            description: line.description,
            notes: line.notes,
            createdById: actorUserId,
            updatedById: actorUserId,
          })),
        });
      }

      return revision;
    });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.BudgetUncheckedUpdateInput,
  ): Promise<Budget | null> {
    const result = await this.prisma.budget.updateMany({ where: { id, organisationId }, data });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.budget.findUniqueOrThrow({ where: { id } });
  }
}
