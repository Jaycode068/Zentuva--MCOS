import { Injectable } from '@nestjs/common';
import { UpdateCashflowSettingsInput } from '@zentuva/validation';

import { CashflowSettingsRepository } from './cashflow-settings.repository';

/** The effective settings the forecast engine consumes — always fully defaulted,
 *  never `null`, even for an organisation that has never configured anything
 *  (docs/domains/cashflow.md §10). */
export interface EffectiveCashflowSettings {
  minimumCashReserve: number;
  defaultCollectionDelayDays: number;
  defaultPaymentDelayDays: number;
}

const DEFAULT_SETTINGS: EffectiveCashflowSettings = {
  minimumCashReserve: 0,
  defaultCollectionDelayDays: 0,
  defaultPaymentDelayDays: 0,
};

/**
 * Domain service for `CashflowSettings` (Sprint 15, docs/domains/cashflow.md
 * §10) — a single row per organisation, always readable with sensible defaults
 * even before it has ever been explicitly configured.
 */
@Injectable()
export class CashflowSettingsService {
  constructor(private readonly cashflowSettingsRepository: CashflowSettingsRepository) {}

  async getEffective(organisationId: string): Promise<EffectiveCashflowSettings> {
    const settings = await this.cashflowSettingsRepository.findByOrganisation(organisationId);
    if (!settings) {
      return DEFAULT_SETTINGS;
    }
    return {
      minimumCashReserve: settings.minimumCashReserve,
      defaultCollectionDelayDays: settings.defaultCollectionDelayDays,
      defaultPaymentDelayDays: settings.defaultPaymentDelayDays,
    };
  }

  async update(
    organisationId: string,
    input: UpdateCashflowSettingsInput,
    actorUserId: string,
  ): Promise<EffectiveCashflowSettings> {
    const updated = await this.cashflowSettingsRepository.upsert(
      organisationId,
      input,
      actorUserId,
    );
    return {
      minimumCashReserve: updated.minimumCashReserve,
      defaultCollectionDelayDays: updated.defaultCollectionDelayDays,
      defaultPaymentDelayDays: updated.defaultPaymentDelayDays,
    };
  }
}
