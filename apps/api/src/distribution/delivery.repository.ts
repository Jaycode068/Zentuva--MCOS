import { Injectable } from '@nestjs/common';
import { Delivery, DispatchStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { DispatchWithRelations } from './dispatch.repository';

const PRODUCT_SELECT = { id: true, code: true, name: true, unit: true };

export type DeliveryWithItems = Delivery & {
  items: {
    id: string;
    productId: string;
    dispatchItemId: string;
    quantityDelivered: number;
    product: { id: string; code: string; name: string; unit: string };
  }[];
};

const RELATIONS_INCLUDE = {
  items: { include: { product: { select: PRODUCT_SELECT } } },
};

const DISPATCH_RELATIONS_INCLUDE = {
  salesFulfilment: { select: { id: true, fulfilmentDate: true } },
  salesOrder: { select: { id: true, orderCode: true } },
  customer: { select: { id: true, customerCode: true, customerName: true, territoryId: true } },
  outlet: { select: { id: true, outletCode: true, name: true, territoryId: true } },
  sourceLocation: { select: { id: true, name: true } },
  items: {
    include: { product: { select: PRODUCT_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
};

export interface DeliverItemData {
  dispatchItemId: string;
  productId: string;
  quantity: number;
}

export interface CreateDeliveryData {
  organisationId: string;
  dispatchId: string;
  deliveryDate: Date;
  receivedByName?: string;
  notes?: string;
  idempotencyKey?: string;
  createdById: string;
  items: DeliverItemData[];
}

export interface CreateDeliveryResult {
  delivery: DeliveryWithItems;
  dispatch: DispatchWithRelations;
  /** `true` only when THIS call created a new row; `false` when an existing
   *  `idempotencyKey` match was returned instead — lets the controller skip re-emitting
   *  the audit event on a replay. */
  wasCreated: boolean;
}

/** Thrown when a dispatch line's current `quantityDelivered` plus the requested quantity
 *  would exceed `quantityDispatched`. Its own `Error` subclass (not
 *  `BadRequestException`) because this file has no Nest HTTP context — same convention
 *  as `InsufficientStockError`/`OverDispatchError`. */
export class OverDeliveryError extends Error {}

/** Thrown when the dispatch isn't in an eligible status
 *  (`DISPATCHED`/`IN_TRANSIT`/`PARTIALLY_DELIVERED`) at the moment the transaction
 *  actually runs — re-checked here to close the race against a concurrent status change
 *  between `DeliveryService`'s pre-check and this transaction, same role as
 *  `SalesFulfilmentConflictError`. */
export class DeliveryConflictError extends Error {}

/**
 * Thin Prisma access for the `Delivery` aggregate (Sprint 5, docs/domains/
 * distribution.md) — confirms what actually arrived against an existing `Dispatch`.
 * Never touches `InventoryStock`/`InventoryTransaction` — a delivery confirms receipt of
 * goods whose stock was already deducted at Fulfilment (see
 * `distribution-inventory-independence.spec.ts`).
 *
 * `create()` mirrors `SalesFulfilmentRepository.create()`'s shape directly: idempotency
 * check-then-return, an eligibility guard re-reading `Dispatch.status` inside the
 * transaction, a per-item read-guard-increment against `DispatchItem.quantityDelivered`,
 * the nested `Delivery`+`DeliveryItem` create, and the dispatch's own status
 * recomputation — all rolled back together on any failure.
 */
@Injectable()
export class DeliveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByDispatch(organisationId: string, dispatchId: string): Promise<DeliveryWithItems[]> {
    return this.prisma.delivery.findMany({
      where: { organisationId, dispatchId },
      include: RELATIONS_INCLUDE,
      orderBy: { deliveryDate: 'desc' },
    });
  }

  async setPhoto(
    organisationId: string,
    id: string,
    photoUrl: string,
    photoKey: string,
  ): Promise<DeliveryWithItems | null> {
    const result = await this.prisma.delivery.updateMany({
      where: { id, organisationId },
      data: { photoUrl, photoKey },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.delivery.findUniqueOrThrow({ where: { id }, include: RELATIONS_INCLUDE });
  }

  findById(organisationId: string, id: string): Promise<DeliveryWithItems | null> {
    return this.prisma.delivery.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  async create(data: CreateDeliveryData): Promise<CreateDeliveryResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.delivery.findUnique({
          where: {
            dispatchId_idempotencyKey: {
              dispatchId: data.dispatchId,
              idempotencyKey: data.idempotencyKey,
            },
          },
          include: RELATIONS_INCLUDE,
        });
        if (existing) {
          const dispatch = await tx.dispatch.findUniqueOrThrow({
            where: { id: data.dispatchId },
            include: DISPATCH_RELATIONS_INCLUDE,
          });
          return { delivery: existing, dispatch, wasCreated: false };
        }
      }

      const eligibleDispatch = await tx.dispatch.findFirst({
        where: {
          id: data.dispatchId,
          organisationId: data.organisationId,
          status: {
            in: [
              DispatchStatus.DISPATCHED,
              DispatchStatus.IN_TRANSIT,
              DispatchStatus.PARTIALLY_DELIVERED,
            ],
          },
        },
        select: { id: true },
      });
      if (!eligibleDispatch) {
        throw new DeliveryConflictError('Dispatch is not eligible for delivery confirmation');
      }

      for (const item of data.items) {
        const existingItem = await tx.dispatchItem.findUniqueOrThrow({
          where: { id: item.dispatchItemId },
        });
        const newDelivered = roundQuantity(existingItem.quantityDelivered + item.quantity);
        if (newDelivered > existingItem.quantityDispatched) {
          throw new OverDeliveryError(
            `Cannot deliver ${item.quantity} of product ${item.productId} — only ${roundQuantity(existingItem.quantityDispatched - existingItem.quantityDelivered)} remains undelivered`,
          );
        }
        await tx.dispatchItem.update({
          where: { id: item.dispatchItemId },
          data: { quantityDelivered: newDelivered },
        });
      }

      const delivery = await tx.delivery.create({
        data: {
          organisationId: data.organisationId,
          dispatchId: data.dispatchId,
          deliveryDate: data.deliveryDate,
          receivedByName: data.receivedByName,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
          items: {
            create: data.items.map((item) => ({
              productId: item.productId,
              dispatchItemId: item.dispatchItemId,
              quantityDelivered: item.quantity,
            })),
          },
        },
        include: RELATIONS_INCLUDE,
      });

      const updatedItems = await tx.dispatchItem.findMany({
        where: { dispatchId: data.dispatchId },
      });
      const totalDispatched = updatedItems.reduce((sum, item) => sum + item.quantityDispatched, 0);
      const totalDelivered = updatedItems.reduce((sum, item) => sum + item.quantityDelivered, 0);
      const newStatus =
        totalDelivered >= totalDispatched
          ? DispatchStatus.DELIVERED
          : DispatchStatus.PARTIALLY_DELIVERED;

      const dispatch = await tx.dispatch.update({
        where: { id: data.dispatchId },
        data: { status: newStatus, updatedById: data.createdById },
        include: DISPATCH_RELATIONS_INCLUDE,
      });

      return { delivery, dispatch, wasCreated: true };
    });
  }
}

/** Rounds to 6 decimal places purely to clear floating-point noise — same convention
 *  used throughout Inventory/Production/Sales. */
function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
