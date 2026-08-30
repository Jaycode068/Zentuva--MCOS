import { Injectable } from '@nestjs/common';
import { CashflowForecastAdjustment, CashflowForecastSourceType } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface UpsertCashflowForecastAdjustmentData {
  organisationId: string;
  sourceType: CashflowForecastSourceType;
  sourceId: string;
  adjustedExpectedDate?: Date;
  adjustedAmount?: number;
  notes?: string;
  idempotencyKey?: string;
  actorUserId: string;
}

export interface UpsertCashflowForecastAdjustmentResult {
  adjustment: CashflowForecastAdjustment;
  wasCreated: boolean;
}

/**
 * Thin Prisma access for the `CashflowForecastAdjustment` aggregate (Sprint 15,
 * docs/domains/cashflow.md §8) — a per-invoice forecast override that never
 * touches the underlying `Invoice`/`SupplierInvoice` row. At most one row per
 * `(organisationId, sourceType, sourceId)`, upserted.
 */
@Injectable()
export class CashflowAdjustmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findBySource(
    organisationId: string,
    sourceType: CashflowForecastSourceType,
    sourceId: string,
  ): Promise<CashflowForecastAdjustment | null> {
    return this.prisma.cashflowForecastAdjustment.findUnique({
      where: { organisationId_sourceType_sourceId: { organisationId, sourceType, sourceId } },
    });
  }

  findManyByOrganisation(organisationId: string): Promise<CashflowForecastAdjustment[]> {
    return this.prisma.cashflowForecastAdjustment.findMany({ where: { organisationId } });
  }

  async upsert(
    data: UpsertCashflowForecastAdjustmentData,
  ): Promise<UpsertCashflowForecastAdjustmentResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existingByKey = await tx.cashflowForecastAdjustment.findFirst({
          where: { organisationId: data.organisationId, idempotencyKey: data.idempotencyKey },
        });
        if (existingByKey) {
          return { adjustment: existingByKey, wasCreated: false };
        }
      }

      const existing = await tx.cashflowForecastAdjustment.findUnique({
        where: {
          organisationId_sourceType_sourceId: {
            organisationId: data.organisationId,
            sourceType: data.sourceType,
            sourceId: data.sourceId,
          },
        },
      });

      const adjustment = await tx.cashflowForecastAdjustment.upsert({
        where: {
          organisationId_sourceType_sourceId: {
            organisationId: data.organisationId,
            sourceType: data.sourceType,
            sourceId: data.sourceId,
          },
        },
        create: {
          organisationId: data.organisationId,
          sourceType: data.sourceType,
          sourceId: data.sourceId,
          adjustedExpectedDate: data.adjustedExpectedDate,
          adjustedAmount: data.adjustedAmount,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.actorUserId,
          updatedById: data.actorUserId,
        },
        update: {
          adjustedExpectedDate: data.adjustedExpectedDate,
          adjustedAmount: data.adjustedAmount,
          notes: data.notes,
          updatedById: data.actorUserId,
        },
      });

      return { adjustment, wasCreated: !existing };
    });
  }
}
