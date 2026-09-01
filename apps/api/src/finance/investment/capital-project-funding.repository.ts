import { Injectable } from '@nestjs/common';
import { CapitalProjectFunding, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateCapitalProjectFundingData {
  organisationId: string;
  capitalProjectId: string;
  fundingType: CapitalProjectFunding['fundingType'];
  amount: number;
  debtFacilityId?: string;
  cashAccountId?: string;
  description?: string;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateCapitalProjectFundingResult {
  capitalProjectFunding: CapitalProjectFunding;
  wasCreated: boolean;
}

/**
 * Thin Prisma access for `CapitalProjectFunding` (Sprint 18, docs/domains/
 * investment-projects.md §11) — a planned funding source. `create()` is
 * idempotency-checked-first (the Sprint 9/10 lesson — a real new financial
 * record, not a status flip).
 */
@Injectable()
export class CapitalProjectFundingRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByProject(capitalProjectId: string): Promise<CapitalProjectFunding[]> {
    return this.prisma.capitalProjectFunding.findMany({
      where: { capitalProjectId },
      orderBy: { createdAt: 'asc' },
    });
  }

  findById(organisationId: string, id: string): Promise<CapitalProjectFunding | null> {
    return this.prisma.capitalProjectFunding.findFirst({ where: { id, organisationId } });
  }

  async create(data: CreateCapitalProjectFundingData): Promise<CreateCapitalProjectFundingResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.capitalProjectFunding.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { capitalProjectFunding: existing, wasCreated: false };
        }
      }

      const capitalProjectFunding = await tx.capitalProjectFunding.create({
        data: {
          organisationId: data.organisationId,
          capitalProjectId: data.capitalProjectId,
          fundingType: data.fundingType,
          amount: data.amount,
          debtFacilityId: data.debtFacilityId,
          cashAccountId: data.cashAccountId,
          description: data.description,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
        },
      });

      return { capitalProjectFunding, wasCreated: true };
    });
  }

  async update(
    organisationId: string,
    id: string,
    data: Prisma.CapitalProjectFundingUncheckedUpdateInput,
  ): Promise<CapitalProjectFunding | null> {
    const result = await this.prisma.capitalProjectFunding.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.capitalProjectFunding.findUniqueOrThrow({ where: { id } });
  }

  async remove(organisationId: string, id: string): Promise<boolean> {
    const result = await this.prisma.capitalProjectFunding.deleteMany({
      where: { id, organisationId },
    });
    return result.count > 0;
  }
}
