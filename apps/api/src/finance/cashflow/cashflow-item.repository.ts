import { Injectable } from '@nestjs/common';
import {
  CashflowDirection,
  CashflowForecastItem,
  CashflowForecastSourceType,
  CashflowItemStatus,
  CashflowRecurrence,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListCashflowForecastItemsParams {
  status?: CashflowItemStatus;
  cashAccountId?: string;
}

export interface CreateCashflowForecastItemData {
  organisationId: string;
  cashAccountId?: string;
  direction: CashflowDirection;
  description: string;
  amount: number;
  currency: string;
  expectedDate: Date;
  recurrence: CashflowRecurrence;
  recurrenceEndDate?: Date;
  notes?: string;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreateCashflowForecastItemResult {
  cashflowForecastItem: CashflowForecastItem;
  wasCreated: boolean;
}

/** `ONE_TIME` → `MANUAL_FORECAST`, anything else → `RECURRING_ITEM` — see the
 *  model's own doc comment in `schema.prisma`. */
function deriveSourceType(recurrence: CashflowRecurrence): CashflowForecastSourceType {
  return recurrence === CashflowRecurrence.ONE_TIME
    ? CashflowForecastSourceType.MANUAL_FORECAST
    : CashflowForecastSourceType.RECURRING_ITEM;
}

/**
 * Thin Prisma access for the `CashflowForecastItem` aggregate (Sprint 15,
 * docs/domains/cashflow.md §5/§6) — a management-entered future cash commitment,
 * never a substitute for an Invoice/SupplierInvoice/Payment/SupplierPayment.
 */
@Injectable()
export class CashflowItemRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<CashflowForecastItem | null> {
    return this.prisma.cashflowForecastItem.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListCashflowForecastItemsParams = {},
  ): Promise<CashflowForecastItem[]> {
    return this.prisma.cashflowForecastItem.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.cashAccountId ? { cashAccountId: params.cashAccountId } : {}),
      },
      orderBy: { expectedDate: 'asc' },
    });
  }

  /** Every `ACTIVE` item for this organisation — the raw material the forecast
   *  engine expands into occurrences. No date filtering here (recurrence
   *  expansion needs the item's own `expectedDate`/`recurrenceEndDate`, not a
   *  pre-filtered slice) — small, bounded row count for an SMB, no N+1 risk. */
  findActiveByOrganisation(organisationId: string): Promise<CashflowForecastItem[]> {
    return this.prisma.cashflowForecastItem.findMany({
      where: { organisationId, status: CashflowItemStatus.ACTIVE },
    });
  }

  async create(data: CreateCashflowForecastItemData): Promise<CreateCashflowForecastItemResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.cashflowForecastItem.findUnique({
          where: {
            organisationId_idempotencyKey: {
              organisationId: data.organisationId,
              idempotencyKey: data.idempotencyKey,
            },
          },
        });
        if (existing) {
          return { cashflowForecastItem: existing, wasCreated: false };
        }
      }

      const cashflowForecastItem = await tx.cashflowForecastItem.create({
        data: {
          organisationId: data.organisationId,
          cashAccountId: data.cashAccountId,
          direction: data.direction,
          sourceType: deriveSourceType(data.recurrence),
          description: data.description,
          amount: data.amount,
          currency: data.currency,
          expectedDate: data.expectedDate,
          recurrence: data.recurrence,
          recurrenceEndDate: data.recurrenceEndDate,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
          updatedById: data.createdById,
        },
      });

      return { cashflowForecastItem, wasCreated: true };
    });
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.CashflowForecastItemUpdateInput,
  ): Promise<CashflowForecastItem | null> {
    return this.updateMatching(organisationId, id, data);
  }

  deactivate(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<CashflowForecastItem | null> {
    return this.updateMatching(organisationId, id, {
      status: CashflowItemStatus.INACTIVE,
      updatedById: actorUserId,
    });
  }

  activate(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<CashflowForecastItem | null> {
    return this.updateMatching(organisationId, id, {
      status: CashflowItemStatus.ACTIVE,
      updatedById: actorUserId,
    });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.CashflowForecastItemUpdateInput,
  ): Promise<CashflowForecastItem | null> {
    const result = await this.prisma.cashflowForecastItem.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.cashflowForecastItem.findUniqueOrThrow({ where: { id } });
  }
}
