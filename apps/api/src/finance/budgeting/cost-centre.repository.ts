import { Injectable } from '@nestjs/common';
import { CostCentre, CostCentreStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListCostCentresParams {
  status?: CostCentreStatus;
}

export interface CreateCostCentreData {
  organisationId: string;
  code: string;
  name: string;
  description?: string;
  createdById: string;
}

export interface CreateCostCentreResult {
  costCentre: CostCentre;
  wasCreated: boolean;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Thin Prisma access for the `CostCentre` aggregate (Sprint 16, docs/domains/
 * budgeting.md §10) — a lightweight budget-line tag, never linked to the Chart
 * of Accounts. No `idempotencyKey` column (unlike every money-affecting write
 * in this codebase) — `create()` instead catches the `@@unique([organisationId,
 * code])` violation and returns the existing row, the same idempotent-by-
 * construction pattern `BankReconciliationRepository.match()` (Sprint 14)
 * already established for a non-financial duplicate-submission case.
 */
@Injectable()
export class CostCentreRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<CostCentre | null> {
    return this.prisma.costCentre.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListCostCentresParams = {},
  ): Promise<CostCentre[]> {
    return this.prisma.costCentre.findMany({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
      orderBy: { code: 'asc' },
    });
  }

  async create(data: CreateCostCentreData): Promise<CreateCostCentreResult> {
    try {
      const costCentre = await this.prisma.costCentre.create({
        data: {
          organisationId: data.organisationId,
          code: data.code,
          name: data.name,
          description: data.description,
          createdById: data.createdById,
        },
      });
      return { costCentre, wasCreated: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const existing = await this.prisma.costCentre.findFirst({
          where: { organisationId: data.organisationId, code: data.code },
        });
        if (existing) {
          return { costCentre: existing, wasCreated: false };
        }
      }
      throw error;
    }
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.CostCentreUpdateInput,
  ): Promise<CostCentre | null> {
    return this.updateMatching(organisationId, id, data);
  }

  deactivate(organisationId: string, id: string): Promise<CostCentre | null> {
    return this.updateMatching(organisationId, id, { status: CostCentreStatus.INACTIVE });
  }

  activate(organisationId: string, id: string): Promise<CostCentre | null> {
    return this.updateMatching(organisationId, id, { status: CostCentreStatus.ACTIVE });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.CostCentreUpdateInput,
  ): Promise<CostCentre | null> {
    const result = await this.prisma.costCentre.updateMany({ where: { id, organisationId }, data });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.costCentre.findUniqueOrThrow({ where: { id } });
  }
}
