import { Injectable, NotFoundException } from '@nestjs/common';
import { CashflowScenario } from '@prisma/client';
import { CreateCashflowScenarioInput, UpdateCashflowScenarioInput } from '@zentuva/validation';

import {
  CashflowScenarioRepository,
  CreateCashflowScenarioResult,
  ListCashflowScenariosParams,
} from './cashflow-scenario.repository';

/** Domain service for the `CashflowScenario` aggregate (Sprint 15,
 *  docs/domains/cashflow.md §7). */
@Injectable()
export class CashflowScenarioService {
  constructor(private readonly cashflowScenarioRepository: CashflowScenarioRepository) {}

  getById(organisationId: string, id: string): Promise<CashflowScenario> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListCashflowScenariosParams): Promise<CashflowScenario[]> {
    return this.cashflowScenarioRepository.findManyByOrganisation(organisationId, params);
  }

  create(
    organisationId: string,
    input: CreateCashflowScenarioInput,
    actorUserId: string,
  ): Promise<CreateCashflowScenarioResult> {
    return this.cashflowScenarioRepository.create({
      organisationId,
      name: input.name,
      description: input.description,
      inflowDelayDays: input.inflowDelayDays,
      inflowMultiplier: input.inflowMultiplier,
      outflowDelayDays: input.outflowDelayDays,
      outflowMultiplier: input.outflowMultiplier,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
    });
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateCashflowScenarioInput,
    actorUserId: string,
  ): Promise<CashflowScenario> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.cashflowScenarioRepository.update(organisationId, id, {
      name: input.name,
      description: input.description,
      inflowDelayDays: input.inflowDelayDays,
      inflowMultiplier: input.inflowMultiplier,
      outflowDelayDays: input.outflowDelayDays,
      outflowMultiplier: input.outflowMultiplier,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Cashflow scenario not found');
    }
    return updated;
  }

  async deactivate(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<CashflowScenario> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.cashflowScenarioRepository.deactivate(
      organisationId,
      id,
      actorUserId,
    );
    if (!updated) {
      throw new NotFoundException('Cashflow scenario not found');
    }
    return updated;
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<CashflowScenario> {
    const scenario = await this.cashflowScenarioRepository.findById(organisationId, id);
    if (!scenario) {
      throw new NotFoundException('Cashflow scenario not found');
    }
    return scenario;
  }
}
