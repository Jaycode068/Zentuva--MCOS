import { Injectable } from '@nestjs/common';
import { CapitalRequirement, CapitalRequirementStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListCapitalRequirementsParams {
  status?: CapitalRequirementStatus;
}

export interface CreateCapitalRequirementData {
  organisationId: string;
  title: string;
  description?: string;
  requiredAmount: number;
  requiredDate: Date;
  type: CapitalRequirement['type'];
  priority: CapitalRequirement['priority'];
  budgetId?: string;
  budgetLineId?: string;
  costCentreId?: string;
  notes?: string;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateCapitalRequirementResult {
  capitalRequirement: CapitalRequirement;
  wasCreated: boolean;
}

/**
 * Thin Prisma access for the `CapitalRequirement` aggregate (Sprint 17,
 * docs/domains/debt-management.md §3/§4) — a structured business reason for
 * financing, never itself an approved loan.
 */
@Injectable()
export class CapitalRequirementRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<CapitalRequirement | null> {
    return this.prisma.capitalRequirement.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListCapitalRequirementsParams = {},
  ): Promise<CapitalRequirement[]> {
    return this.prisma.capitalRequirement.findMany({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
      orderBy: { requiredDate: 'asc' },
    });
  }

  async create(data: CreateCapitalRequirementData): Promise<CreateCapitalRequirementResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.capitalRequirement.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { capitalRequirement: existing, wasCreated: false };
        }
      }

      const capitalRequirement = await tx.capitalRequirement.create({
        data: {
          organisationId: data.organisationId,
          title: data.title,
          description: data.description,
          requiredAmount: data.requiredAmount,
          requiredDate: data.requiredDate,
          type: data.type,
          priority: data.priority,
          budgetId: data.budgetId,
          budgetLineId: data.budgetLineId,
          costCentreId: data.costCentreId,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
        },
      });

      return { capitalRequirement, wasCreated: true };
    });
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.CapitalRequirementUncheckedUpdateInput,
  ): Promise<CapitalRequirement | null> {
    return this.updateMatching(organisationId, id, data);
  }

  setStatus(
    organisationId: string,
    id: string,
    data: Prisma.CapitalRequirementUncheckedUpdateInput,
  ): Promise<CapitalRequirement | null> {
    return this.updateMatching(organisationId, id, data);
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.CapitalRequirementUncheckedUpdateInput,
  ): Promise<CapitalRequirement | null> {
    const result = await this.prisma.capitalRequirement.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.capitalRequirement.findUniqueOrThrow({ where: { id } });
  }
}
