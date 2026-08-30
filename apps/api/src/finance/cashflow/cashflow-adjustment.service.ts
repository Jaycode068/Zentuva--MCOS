import { Injectable } from '@nestjs/common';
import { CashflowForecastAdjustment, CashflowForecastSourceType } from '@prisma/client';
import { UpsertCashflowForecastAdjustmentInput } from '@zentuva/validation';

import {
  CashflowAdjustmentRepository,
  UpsertCashflowForecastAdjustmentResult,
} from './cashflow-adjustment.repository';

/** Domain service for the `CashflowForecastAdjustment` aggregate (Sprint 15,
 *  docs/domains/cashflow.md §8). */
@Injectable()
export class CashflowAdjustmentService {
  constructor(private readonly cashflowAdjustmentRepository: CashflowAdjustmentRepository) {}

  list(organisationId: string): Promise<CashflowForecastAdjustment[]> {
    return this.cashflowAdjustmentRepository.findManyByOrganisation(organisationId);
  }

  getBySource(
    organisationId: string,
    sourceType: CashflowForecastSourceType,
    sourceId: string,
  ): Promise<CashflowForecastAdjustment | null> {
    return this.cashflowAdjustmentRepository.findBySource(organisationId, sourceType, sourceId);
  }

  upsert(
    organisationId: string,
    input: UpsertCashflowForecastAdjustmentInput,
    actorUserId: string,
  ): Promise<UpsertCashflowForecastAdjustmentResult> {
    return this.cashflowAdjustmentRepository.upsert({
      organisationId,
      sourceType: input.sourceType as CashflowForecastSourceType,
      sourceId: input.sourceId,
      adjustedExpectedDate: input.adjustedExpectedDate,
      adjustedAmount: input.adjustedAmount,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      actorUserId,
    });
  }
}
