import { Injectable } from '@nestjs/common';
import { CapitalProject, CapitalProjectStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

const PROJECT_CODE_PREFIX = 'CAP';
const PROJECT_CODE_SEQUENCE_LENGTH = 6;

export interface ListCapitalProjectsParams {
  status?: CapitalProjectStatus;
}

export interface CreateCapitalProjectData {
  organisationId: string;
  name: string;
  description?: string;
  businessPurpose?: string;
  category: CapitalProject['category'];
  ownerId?: string;
  costCentreId?: string;
  capitalRequirementId?: string;
  budgetId?: string;
  budgetLineId?: string;
  plannedStartDate: Date;
  plannedCompletionDate: Date;
  expectedAnnualRevenueImpact?: number;
  expectedAnnualOperatingCostImpact?: number;
  expectedAnnualSavings?: number;
  usefulLifeYears?: number;
  currentCapacityUnitsPerDay?: number;
  expectedCapacityUnitsPerDay?: number;
  expectedCommissioningDate?: Date;
  currency?: string;
  notes?: string;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateCapitalProjectResult {
  capitalProject: CapitalProject;
  wasCreated: boolean;
}

export interface PlannedCostLineForForecast {
  capitalProjectId: string;
  projectCode: string;
  projectName: string;
  description: string;
  plannedMonth: Date;
  amount: number;
}

/**
 * Thin Prisma access for the `CapitalProject` aggregate (Sprint 18,
 * docs/domains/investment-projects.md §5/§6) — the management layer over
 * Sprints 13-17. Posts nothing (see `investment-independence.spec.ts`).
 */
@Injectable()
export class CapitalProjectRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<CapitalProject | null> {
    return this.prisma.capitalProject.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListCapitalProjectsParams = {},
  ): Promise<CapitalProject[]> {
    return this.prisma.capitalProject.findMany({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(data: CreateCapitalProjectData): Promise<CreateCapitalProjectResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.capitalProject.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { capitalProject: existing, wasCreated: false };
        }
      }

      const projectCode = await this.generateProjectCode(tx, data.organisationId);

      const capitalProject = await tx.capitalProject.create({
        data: {
          organisationId: data.organisationId,
          projectCode,
          name: data.name,
          description: data.description,
          businessPurpose: data.businessPurpose,
          category: data.category,
          ownerId: data.ownerId,
          costCentreId: data.costCentreId,
          capitalRequirementId: data.capitalRequirementId,
          budgetId: data.budgetId,
          budgetLineId: data.budgetLineId,
          plannedStartDate: data.plannedStartDate,
          plannedCompletionDate: data.plannedCompletionDate,
          expectedAnnualRevenueImpact: data.expectedAnnualRevenueImpact,
          expectedAnnualOperatingCostImpact: data.expectedAnnualOperatingCostImpact,
          expectedAnnualSavings: data.expectedAnnualSavings,
          usefulLifeYears: data.usefulLifeYears,
          currentCapacityUnitsPerDay: data.currentCapacityUnitsPerDay,
          expectedCapacityUnitsPerDay: data.expectedCapacityUnitsPerDay,
          expectedCommissioningDate: data.expectedCommissioningDate,
          currency: data.currency ?? 'NGN',
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
        },
      });

      return { capitalProject, wasCreated: true };
    });
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.CapitalProjectUncheckedUpdateInput,
  ): Promise<CapitalProject | null> {
    return this.updateMatching(organisationId, id, data);
  }

  setStatus(
    organisationId: string,
    id: string,
    data: Prisma.CapitalProjectUncheckedUpdateInput,
  ): Promise<CapitalProject | null> {
    return this.updateMatching(organisationId, id, data);
  }

  /** Every planned cost line for an `ACTIVE` project with no linked
   *  Purchase Order — the raw material `CashflowForecastService` reads as
   *  `CAPITAL_PROJECT` outflow lines (docs/domains/investment-projects.md
   *  "Cashflow Integration"). Excluded once a real PO is linked — the
   *  existing `SUPPLIER_PAYABLE` source already represents that same future
   *  outflow, avoiding double-counting. `DRAFT`/`PROPOSED`/`UNDER_REVIEW`/
   *  `APPROVED`/`ON_HOLD` projects contribute nothing — execution must have
   *  actually begun. */
  async findPlannedCostLinesForForecast(
    organisationId: string,
  ): Promise<PlannedCostLineForForecast[]> {
    const rows = await this.prisma.capitalProjectCostLine.findMany({
      where: {
        purchaseOrderId: null,
        capitalProject: { organisationId, status: CapitalProjectStatus.ACTIVE },
      },
      include: { capitalProject: { select: { projectCode: true, name: true } } },
      orderBy: { plannedMonth: 'asc' },
    });
    return rows.map((row) => ({
      capitalProjectId: row.capitalProjectId,
      projectCode: row.capitalProject.projectCode,
      projectName: row.capitalProject.name,
      description: row.description,
      plannedMonth: row.plannedMonth,
      amount: row.plannedAmount,
    }));
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.CapitalProjectUncheckedUpdateInput,
  ): Promise<CapitalProject | null> {
    const result = await this.prisma.capitalProject.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.capitalProject.findUniqueOrThrow({ where: { id } });
  }

  private async generateProjectCode(
    tx: Prisma.TransactionClient,
    organisationId: string,
  ): Promise<string> {
    let sequence = 1;
    let candidate = this.formatProjectCode(sequence);
    while (
      await tx.capitalProject.findUnique({
        where: { organisationId_projectCode: { organisationId, projectCode: candidate } },
        select: { id: true },
      })
    ) {
      sequence += 1;
      candidate = this.formatProjectCode(sequence);
    }
    return candidate;
  }

  private formatProjectCode(sequence: number): string {
    return `${PROJECT_CODE_PREFIX}-${String(sequence).padStart(PROJECT_CODE_SEQUENCE_LENGTH, '0')}`;
  }
}
