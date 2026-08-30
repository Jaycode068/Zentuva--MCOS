import { Injectable } from '@nestjs/common';
import { CashflowItemStatus, CashflowScenario, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListCashflowScenariosParams {
  status?: CashflowItemStatus;
}

export interface CreateCashflowScenarioData {
  organisationId: string;
  name: string;
  description?: string;
  inflowDelayDays: number;
  inflowMultiplier: number;
  outflowDelayDays: number;
  outflowMultiplier: number;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateCashflowScenarioResult {
  cashflowScenario: CashflowScenario;
  wasCreated: boolean;
}

/**
 * Thin Prisma access for the `CashflowScenario` aggregate (Sprint 15,
 * docs/domains/cashflow.md §7) — a named set of forecast-adjustment knobs, never
 * a rules engine.
 */
@Injectable()
export class CashflowScenarioRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<CashflowScenario | null> {
    return this.prisma.cashflowScenario.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListCashflowScenariosParams = {},
  ): Promise<CashflowScenario[]> {
    return this.prisma.cashflowScenario.findMany({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(data: CreateCashflowScenarioData): Promise<CreateCashflowScenarioResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.cashflowScenario.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { cashflowScenario: existing, wasCreated: false };
        }
      }

      const cashflowScenario = await tx.cashflowScenario.create({
        data: {
          organisationId: data.organisationId,
          name: data.name,
          description: data.description,
          inflowDelayDays: data.inflowDelayDays,
          inflowMultiplier: data.inflowMultiplier,
          outflowDelayDays: data.outflowDelayDays,
          outflowMultiplier: data.outflowMultiplier,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
          updatedById: data.createdById,
        },
      });

      return { cashflowScenario, wasCreated: true };
    });
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.CashflowScenarioUpdateInput,
  ): Promise<CashflowScenario | null> {
    return this.updateMatching(organisationId, id, data);
  }

  deactivate(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<CashflowScenario | null> {
    return this.updateMatching(organisationId, id, {
      status: CashflowItemStatus.INACTIVE,
      updatedById: actorUserId,
    });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.CashflowScenarioUpdateInput,
  ): Promise<CashflowScenario | null> {
    const result = await this.prisma.cashflowScenario.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.cashflowScenario.findUniqueOrThrow({ where: { id } });
  }
}
