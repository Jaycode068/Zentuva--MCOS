import { Injectable } from '@nestjs/common';
import { InventoryTransactionType, SalesFulfilment, SalesOrderStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { SalesOrderWithRelations } from './sales-order.repository';

const PRODUCT_SELECT = { id: true, code: true, name: true, unit: true };
const LOCATION_SELECT = { id: true, name: true };

export type SalesFulfilmentWithItems = SalesFulfilment & {
  location: { id: string; name: string };
  items: {
    id: string;
    productId: string;
    salesOrderItemId: string;
    quantityFulfilled: number;
    /** Cumulative quantity dispatched so far (Sprint 5) — see
     *  `SalesFulfilmentItem.quantityDispatched`'s schema doc comment. */
    quantityDispatched: number;
    product: { id: string; code: string; name: string; unit: string };
  }[];
};

/** Adds the parent Sales Order's own identity fields (Sprint 5) — `DispatchService`
 *  needs `customerId`/`outletId` to resolve a Dispatch's destination without a second
 *  round trip through `SalesOrderRepository`. */
export type SalesFulfilmentWithOrder = SalesFulfilmentWithItems & {
  salesOrder: { id: string; customerId: string; outletId: string | null };
};

const RELATIONS_INCLUDE = {
  location: { select: LOCATION_SELECT },
  items: { include: { product: { select: PRODUCT_SELECT } } },
};

const ORDER_RELATIONS_INCLUDE = {
  customer: { select: { id: true, customerCode: true, customerName: true } },
  outlet: { select: { id: true, outletCode: true, name: true } },
  items: {
    include: { product: { select: PRODUCT_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
};

export interface FulfilItemData {
  salesOrderItemId: string;
  productId: string;
  quantity: number;
}

export interface FulfilSalesOrderData {
  organisationId: string;
  salesOrderId: string;
  locationId: string;
  fulfilmentDate: Date;
  fulfilledById: string;
  notes?: string;
  idempotencyKey?: string;
  items: FulfilItemData[];
}

export interface FulfilSalesOrderResult {
  fulfilment: SalesFulfilmentWithItems;
  order: SalesOrderWithRelations;
  /** `true` only when THIS call created a new row; `false` when an existing
   *  `idempotencyKey` match was returned instead — lets the controller skip re-emitting
   *  the audit event on a replay. */
  wasCreated: boolean;
}

/** Thrown when a product's current `quantityOnHand` at the fulfilment location can't
 *  cover the requested quantity. Its own `Error` subclass (not `BadRequestException`)
 *  because this file has no Nest HTTP context — same convention as
 *  `ProductionMaterialIssueRepository`'s `InsufficientStockError`. */
export class InsufficientStockError extends Error {}

/** Thrown when the Sales Order isn't `CONFIRMED`/`PARTIALLY_FULFILLED` at the moment the
 *  transaction actually runs — re-checked here to close the race against a concurrent
 *  status change between `SalesFulfilmentService`'s pre-check and this transaction, same
 *  role as `ProductionMaterialIssueConflictError`. */
export class SalesFulfilmentConflictError extends Error {}

/**
 * Thin Prisma access for the `SalesFulfilment` aggregate (Sprint 4.9,
 * docs/domains/sales.md "Fulfilment") — THE one place a Sales Order's inventory is ever
 * deducted.
 *
 * `create()` runs the entire "physically supply this order" operation inside a single
 * `$transaction`, mirroring `ProductionMaterialIssueRepository.issue()`'s shape exactly:
 * an idempotency check-then-return, a conditional read re-validating the order is still
 * eligible, a per-item read-guard-write against `InventoryStock` (evaluated *inside* the
 * transaction, not from a pre-check the caller already did — closing the race between two
 * concurrent fulfilments a stale pre-check couldn't), the paired `InventoryTransaction`
 * `ISSUE` rows, and the order's own status recomputation — all rolled back together on any
 * failure.
 *
 * Writing directly to `inventory_stock`/`inventory_transactions` here is the same
 * deliberate, narrow exception to ADR-002's domain-ownership convention that
 * `ProductionMaterialIssueRepository`/`GoodsReceiptRepository` already establish, made for
 * atomicity. See docs/domains/sales.md "Fulfilment".
 */
@Injectable()
export class SalesFulfilmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: FulfilSalesOrderData): Promise<FulfilSalesOrderResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.salesFulfilment.findUnique({
          where: {
            salesOrderId_idempotencyKey: {
              salesOrderId: data.salesOrderId,
              idempotencyKey: data.idempotencyKey,
            },
          },
          include: RELATIONS_INCLUDE,
        });
        if (existing) {
          const order = await tx.salesOrder.findUniqueOrThrow({
            where: { id: data.salesOrderId },
            include: ORDER_RELATIONS_INCLUDE,
          });
          return { fulfilment: existing, order, wasCreated: false };
        }
      }

      const eligibleOrder = await tx.salesOrder.findFirst({
        where: {
          id: data.salesOrderId,
          organisationId: data.organisationId,
          status: { in: [SalesOrderStatus.CONFIRMED, SalesOrderStatus.PARTIALLY_FULFILLED] },
        },
        select: { id: true },
      });
      if (!eligibleOrder) {
        throw new SalesFulfilmentConflictError('Sales order is not eligible for fulfilment');
      }

      for (const item of data.items) {
        const existingStock = await tx.inventoryStock.findUnique({
          where: {
            organisationId_productId_locationId: {
              organisationId: data.organisationId,
              productId: item.productId,
              locationId: data.locationId,
            },
          },
        });
        const currentQuantity = existingStock?.quantityOnHand ?? 0;
        const newQuantity = roundQuantity(currentQuantity - item.quantity);
        if (newQuantity < 0) {
          throw new InsufficientStockError(
            `Insufficient stock for product ${item.productId} (available: ${currentQuantity}, requested: ${item.quantity})`,
          );
        }
        await tx.inventoryStock.upsert({
          where: {
            organisationId_productId_locationId: {
              organisationId: data.organisationId,
              productId: item.productId,
              locationId: data.locationId,
            },
          },
          create: {
            organisationId: data.organisationId,
            productId: item.productId,
            locationId: data.locationId,
            quantityOnHand: newQuantity,
          },
          update: { quantityOnHand: newQuantity },
        });
      }

      const fulfilment = await tx.salesFulfilment.create({
        data: {
          organisationId: data.organisationId,
          salesOrderId: data.salesOrderId,
          locationId: data.locationId,
          fulfilmentDate: data.fulfilmentDate,
          fulfilledById: data.fulfilledById,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          items: {
            create: data.items.map((item) => ({
              productId: item.productId,
              salesOrderItemId: item.salesOrderItemId,
              quantityFulfilled: item.quantity,
            })),
          },
        },
        include: RELATIONS_INCLUDE,
      });

      await tx.inventoryTransaction.createMany({
        data: data.items.map((item) => ({
          organisationId: data.organisationId,
          productId: item.productId,
          locationId: data.locationId,
          transactionType: InventoryTransactionType.ISSUE,
          quantity: item.quantity,
          referenceType: 'SalesFulfilment',
          referenceId: fulfilment.id,
        })),
      });

      for (const item of data.items) {
        await tx.salesOrderItem.update({
          where: { id: item.salesOrderItemId },
          data: { quantityFulfilled: { increment: item.quantity } },
        });
      }

      const updatedItems = await tx.salesOrderItem.findMany({
        where: { salesOrderId: data.salesOrderId },
      });
      const totalOrdered = updatedItems.reduce((sum, item) => sum + item.quantity, 0);
      const totalFulfilled = updatedItems.reduce((sum, item) => sum + item.quantityFulfilled, 0);
      const newStatus =
        totalFulfilled >= totalOrdered
          ? SalesOrderStatus.FULFILLED
          : SalesOrderStatus.PARTIALLY_FULFILLED;

      const order = await tx.salesOrder.update({
        where: { id: data.salesOrderId },
        data: { status: newStatus, updatedById: data.fulfilledById },
        include: ORDER_RELATIONS_INCLUDE,
      });

      return { fulfilment, order, wasCreated: true };
    });
  }

  findManyBySalesOrder(
    organisationId: string,
    salesOrderId: string,
  ): Promise<SalesFulfilmentWithItems[]> {
    return this.prisma.salesFulfilment.findMany({
      where: { organisationId, salesOrderId },
      include: RELATIONS_INCLUDE,
      orderBy: { fulfilmentDate: 'desc' },
    });
  }

  /** Single-fulfilment lookup with its parent order's identity fields (Sprint 5) — used
   *  read-only by `DistributionModule` via `SalesModule`'s export, to resolve a
   *  Dispatch's destination and to compute per-line dispatch availability. */
  findById(organisationId: string, id: string): Promise<SalesFulfilmentWithOrder | null> {
    return this.prisma.salesFulfilment.findFirst({
      where: { id, organisationId },
      include: {
        ...RELATIONS_INCLUDE,
        salesOrder: { select: { id: true, customerId: true, outletId: true } },
      },
    });
  }
}

/** Rounds to 6 decimal places purely to clear floating-point noise — same convention as
 *  `InventoryStockRepository.adjustStock`'s own rounding helper. */
function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
