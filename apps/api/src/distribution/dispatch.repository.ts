import { Injectable } from '@nestjs/common';
import { Dispatch, DispatchStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListDispatchesParams {
  status?: DispatchStatus;
  customerId?: string;
  salesOrderId?: string;
  /** Simple case-insensitive substring match against the dispatch code or the customer's
   *  name — same convention as every other domain's `search` filter. */
  search?: string;
}

const PRODUCT_SELECT = { id: true, code: true, name: true, unit: true };
const CUSTOMER_SELECT = { id: true, customerCode: true, customerName: true, territoryId: true };
const OUTLET_SELECT = { id: true, outletCode: true, name: true, territoryId: true };
const LOCATION_SELECT = { id: true, name: true };

export type DispatchWithRelations = Dispatch & {
  salesFulfilment: { id: string; fulfilmentDate: Date };
  salesOrder: { id: string; orderCode: string };
  customer: { id: string; customerCode: string; customerName: string; territoryId: string | null };
  outlet: { id: string; outletCode: string; name: string; territoryId: string | null } | null;
  sourceLocation: { id: string; name: string };
  items: {
    id: string;
    productId: string;
    salesFulfilmentItemId: string;
    quantityDispatched: number;
    quantityDelivered: number;
    product: { id: string; code: string; name: string; unit: string };
  }[];
};

const RELATIONS_INCLUDE = {
  salesFulfilment: { select: { id: true, fulfilmentDate: true } },
  salesOrder: { select: { id: true, orderCode: true } },
  customer: { select: CUSTOMER_SELECT },
  outlet: { select: OUTLET_SELECT },
  sourceLocation: { select: LOCATION_SELECT },
  items: {
    include: { product: { select: PRODUCT_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
};

export interface CreateDispatchItemData {
  productId: string;
  salesFulfilmentItemId: string;
  quantity: number;
}

export interface CreateDispatchData {
  organisationId: string;
  salesFulfilmentId: string;
  salesOrderId: string;
  customerId: string;
  outletId?: string;
  sourceLocationId: string;
  dispatchCode: string;
  dispatchDate: Date;
  notes?: string;
  idempotencyKey?: string;
  createdById: string;
  items: CreateDispatchItemData[];
}

export interface CreateDispatchResult {
  dispatch: DispatchWithRelations;
  /** `true` only when THIS call created a new row; `false` when an existing
   *  `idempotencyKey` match was returned instead — lets the controller skip re-emitting
   *  the audit event on a replay. */
  wasCreated: boolean;
}

/** Thrown when a fulfilment line's current `quantityDispatched` plus the requested
 *  quantity would exceed `quantityFulfilled`. Its own `Error` subclass (not
 *  `BadRequestException`) because this file has no Nest HTTP context — same convention
 *  as `SalesFulfilmentRepository`'s `InsufficientStockError`. */
export class OverDispatchError extends Error {}

/** Thrown when the referenced `SalesFulfilment` can't be found tenant-scoped inside the
 *  transaction — re-checked here to close the race against a stale service-level
 *  pre-check, same role as `SalesFulfilmentConflictError`. */
export class DispatchConflictError extends Error {}

/**
 * Thin Prisma access for the `Dispatch` aggregate (Sprint 5, docs/domains/
 * distribution.md). No business logic beyond the one atomic `create()` — customer/
 * outlet/location validation lives in `DispatchService`; this file only knows how to
 * read/write rows. Flat, single-module shape (no separate `DispatchItem` controller) —
 * same as `SalesOrder`+`SalesOrderItem`.
 *
 * `create()` mirrors `SalesFulfilmentRepository.create()` one level further down the
 * chain, with `InventoryStock` replaced by `SalesFulfilmentItem.quantityDispatched` —
 * this file NEVER touches `InventoryStock`/`InventoryTransaction` (see
 * `distribution-inventory-independence.spec.ts`).
 */
@Injectable()
export class DispatchRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<DispatchWithRelations | null> {
    return this.prisma.dispatch.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListDispatchesParams = {},
  ): Promise<DispatchWithRelations[]> {
    return this.prisma.dispatch.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.customerId ? { customerId: params.customerId } : {}),
        ...(params.salesOrderId ? { salesOrderId: params.salesOrderId } : {}),
        ...(params.search
          ? {
              OR: [
                { dispatchCode: { contains: params.search, mode: 'insensitive' } },
                { customer: { customerName: { contains: params.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Globally unique (see `Dispatch.dispatchCode` schema comment) — checked without an
   *  `organisationId` filter, same convention as every other auto-numbered code in this
   *  codebase. */
  async existsByCode(dispatchCode: string): Promise<boolean> {
    const count = await this.prisma.dispatch.count({ where: { dispatchCode } });
    return count > 0;
  }

  /** Tenant-scoped conditional status transition — `updateMany` only matches when the
   *  dispatch's current status is one of `fromStatuses`, closing the race against a
   *  concurrent transition, same as `SalesOrderRepository.updateStatus`. Returns `null`
   *  on no match; the service turns that into a specific `BadRequestException`. An
   *  optional `extraData` lets `fail()` write `notes` alongside the status flip in the
   *  same call. */
  async updateStatus(
    organisationId: string,
    id: string,
    fromStatuses: DispatchStatus[],
    toStatus: DispatchStatus,
    actorUserId: string,
    extraData?: { notes?: string },
  ): Promise<DispatchWithRelations | null> {
    const result = await this.prisma.dispatch.updateMany({
      where: { id, organisationId, status: { in: fromStatuses } },
      data: { status: toStatus, updatedById: actorUserId, ...extraData },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.dispatch.findUniqueOrThrow({ where: { id }, include: RELATIONS_INCLUDE });
  }

  /**
   * The one atomic write in this file. Mirrors `SalesFulfilmentRepository.create()`
   * exactly: idempotency check-then-return, an eligibility guard re-reading the
   * referenced `SalesFulfilment` inside the transaction, a per-item read-guard-decrement
   * against `SalesFulfilmentItem.quantityDispatched` (never `InventoryStock`), the
   * nested `Dispatch`+`DispatchItem` create, and the cumulative-column increment — all
   * rolled back together on any failure. `Dispatch` itself has no parent status to
   * recompute (it simply starts `READY`).
   */
  async create(data: CreateDispatchData): Promise<CreateDispatchResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.dispatch.findUnique({
          where: {
            salesFulfilmentId_idempotencyKey: {
              salesFulfilmentId: data.salesFulfilmentId,
              idempotencyKey: data.idempotencyKey,
            },
          },
          include: RELATIONS_INCLUDE,
        });
        if (existing) {
          return { dispatch: existing, wasCreated: false };
        }
      }

      const eligibleFulfilment = await tx.salesFulfilment.findFirst({
        where: { id: data.salesFulfilmentId, organisationId: data.organisationId },
        select: { id: true },
      });
      if (!eligibleFulfilment) {
        throw new DispatchConflictError('Sales fulfilment not found');
      }

      for (const item of data.items) {
        const existingItem = await tx.salesFulfilmentItem.findUniqueOrThrow({
          where: { id: item.salesFulfilmentItemId },
        });
        const newDispatched = roundQuantity(existingItem.quantityDispatched + item.quantity);
        if (newDispatched > existingItem.quantityFulfilled) {
          throw new OverDispatchError(
            `Cannot dispatch ${item.quantity} of product ${item.productId} — only ${roundQuantity(existingItem.quantityFulfilled - existingItem.quantityDispatched)} remains undispatched`,
          );
        }
        await tx.salesFulfilmentItem.update({
          where: { id: item.salesFulfilmentItemId },
          data: { quantityDispatched: newDispatched },
        });
      }

      const dispatch = await tx.dispatch.create({
        data: {
          organisationId: data.organisationId,
          dispatchCode: data.dispatchCode,
          salesFulfilmentId: data.salesFulfilmentId,
          salesOrderId: data.salesOrderId,
          customerId: data.customerId,
          outletId: data.outletId,
          sourceLocationId: data.sourceLocationId,
          dispatchDate: data.dispatchDate,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
          updatedById: data.createdById,
          items: {
            create: data.items.map((item) => ({
              productId: item.productId,
              salesFulfilmentItemId: item.salesFulfilmentItemId,
              quantityDispatched: item.quantity,
            })),
          },
        },
        include: RELATIONS_INCLUDE,
      });

      return { dispatch, wasCreated: true };
    });
  }
}

/** Rounds to 6 decimal places purely to clear floating-point noise — same convention
 *  used throughout Inventory/Production/Sales. */
function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
