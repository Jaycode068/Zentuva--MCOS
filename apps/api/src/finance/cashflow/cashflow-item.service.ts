import { Injectable, NotFoundException } from '@nestjs/common';
import { CashflowForecastItem } from '@prisma/client';
import {
  CreateCashflowForecastItemInput,
  UpdateCashflowForecastItemInput,
} from '@zentuva/validation';

import {
  CashflowItemRepository,
  CreateCashflowForecastItemResult,
  ListCashflowForecastItemsParams,
} from './cashflow-item.repository';

/**
 * Domain service for the `CashflowForecastItem` aggregate (Sprint 15,
 * docs/domains/cashflow.md §5/§6).
 */
@Injectable()
export class CashflowItemService {
  constructor(private readonly cashflowItemRepository: CashflowItemRepository) {}

  getById(organisationId: string, id: string): Promise<CashflowForecastItem> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(
    organisationId: string,
    params?: ListCashflowForecastItemsParams,
  ): Promise<CashflowForecastItem[]> {
    return this.cashflowItemRepository.findManyByOrganisation(organisationId, params);
  }

  create(
    organisationId: string,
    input: CreateCashflowForecastItemInput,
    actorUserId: string,
  ): Promise<CreateCashflowForecastItemResult> {
    return this.cashflowItemRepository.create({
      organisationId,
      cashAccountId: input.cashAccountId,
      direction: input.direction,
      description: input.description,
      amount: input.amount,
      currency: input.currency,
      expectedDate: input.expectedDate,
      recurrence: input.recurrence,
      recurrenceEndDate: input.recurrenceEndDate,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
    });
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateCashflowForecastItemInput,
    actorUserId: string,
  ): Promise<CashflowForecastItem> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.cashflowItemRepository.update(organisationId, id, {
      cashAccount:
        input.cashAccountId === undefined
          ? undefined
          : input.cashAccountId === null
            ? { disconnect: true }
            : { connect: { id: input.cashAccountId } },
      description: input.description,
      amount: input.amount,
      expectedDate: input.expectedDate,
      recurrenceEndDate: input.recurrenceEndDate,
      notes: input.notes,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Cashflow forecast item not found');
    }
    return updated;
  }

  async deactivate(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<CashflowForecastItem> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.cashflowItemRepository.deactivate(organisationId, id, actorUserId);
    if (!updated) {
      throw new NotFoundException('Cashflow forecast item not found');
    }
    return updated;
  }

  async activate(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<CashflowForecastItem> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.cashflowItemRepository.activate(organisationId, id, actorUserId);
    if (!updated) {
      throw new NotFoundException('Cashflow forecast item not found');
    }
    return updated;
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<CashflowForecastItem> {
    const item = await this.cashflowItemRepository.findById(organisationId, id);
    if (!item) {
      throw new NotFoundException('Cashflow forecast item not found');
    }
    return item;
  }
}
