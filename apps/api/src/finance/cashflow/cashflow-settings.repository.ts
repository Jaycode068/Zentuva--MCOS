import { Injectable } from '@nestjs/common';
import { CashflowSettings } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface UpsertCashflowSettingsData {
  minimumCashReserve?: number;
  defaultCollectionDelayDays?: number;
  defaultPaymentDelayDays?: number;
}

/**
 * Thin Prisma access for the `CashflowSettings` aggregate (Sprint 15,
 * docs/domains/cashflow.md §10) — one row per organisation. `upsert()` is
 * naturally idempotent (a repeated identical `PUT` produces the same row), so no
 * `idempotencyKey` column exists on this model, unlike every other Sprint 15
 * write.
 */
@Injectable()
export class CashflowSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByOrganisation(organisationId: string): Promise<CashflowSettings | null> {
    return this.prisma.cashflowSettings.findUnique({ where: { organisationId } });
  }

  upsert(
    organisationId: string,
    data: UpsertCashflowSettingsData,
    actorUserId: string,
  ): Promise<CashflowSettings> {
    return this.prisma.cashflowSettings.upsert({
      where: { organisationId },
      create: { organisationId, ...data, updatedById: actorUserId },
      update: { ...data, updatedById: actorUserId },
    });
  }
}
