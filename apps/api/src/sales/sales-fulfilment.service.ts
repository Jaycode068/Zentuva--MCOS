import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SalesOrderStatus } from '@prisma/client';
import { CreateSalesFulfilmentInput } from '@zentuva/validation';

import { InventoryLocationRepository } from '../inventory/inventory-location.repository';
import { InventoryStockRepository } from '../inventory/inventory-stock.repository';
import {
  FulfilSalesOrderResult,
  InsufficientStockError,
  SalesFulfilmentConflictError,
  SalesFulfilmentRepository,
  SalesFulfilmentWithItems,
} from './sales-fulfilment.repository';
import { SalesOrderRepository } from './sales-order.repository';

export interface SalesOrderAvailabilityRow {
  salesOrderItemId: string;
  productId: string;
  product: { id: string; code: string; name: string; unit: string };
  ordered: number;
  fulfilled: number;
  remaining: number;
  availableStock: number;
  shortfall: number;
}

/**
 * Domain service for `SalesFulfilment` (Sprint 4.9, docs/domains/sales.md
 * "Fulfilment") — the one place a Sales Order's inventory is actually deducted.
 * `SalesOrderService` (order create/update/confirm/cancel) has no knowledge of this file
 * or of Inventory at all; only this service and its repository cross that boundary.
 */
@Injectable()
export class SalesFulfilmentService {
  constructor(
    private readonly salesFulfilmentRepository: SalesFulfilmentRepository,
    private readonly salesOrderRepository: SalesOrderRepository,
    private readonly inventoryStockRepository: InventoryStockRepository,
    private readonly inventoryLocationRepository: InventoryLocationRepository,
  ) {}

  /** `GET /:id/availability` — read-only, never gates `fulfil()`. Defaults to the
   *  organisation's default location when `locationId` is omitted. */
  async getAvailability(
    organisationId: string,
    salesOrderId: string,
    locationId?: string,
  ): Promise<SalesOrderAvailabilityRow[]> {
    const order = await this.getOrderOrThrow(organisationId, salesOrderId);
    const resolvedLocationId =
      locationId ?? (await this.inventoryLocationRepository.getOrCreateDefault(organisationId)).id;
    const productIds = order.items.map((item) => item.productId);
    const stockRows = await this.inventoryStockRepository.findManyByProductsAndLocation(
      organisationId,
      productIds,
      resolvedLocationId,
    );
    const stockByProduct = new Map(stockRows.map((row) => [row.productId, row]));

    return order.items.map((item) => {
      const remaining = roundQuantity(item.quantity - item.quantityFulfilled);
      const availableStock = stockByProduct.get(item.productId)?.quantityOnHand ?? 0;
      return {
        salesOrderItemId: item.id,
        productId: item.productId,
        product: item.product,
        ordered: item.quantity,
        fulfilled: item.quantityFulfilled,
        remaining,
        availableStock,
        shortfall: Math.max(0, roundQuantity(remaining - availableStock)),
      };
    });
  }

  listFulfilments(
    organisationId: string,
    salesOrderId: string,
  ): Promise<SalesFulfilmentWithItems[]> {
    return this.salesFulfilmentRepository.findManyBySalesOrder(organisationId, salesOrderId);
  }

  /** `POST /:id/fulfil` — mirrors `ProductionOrderService.issueMaterial`'s exact
   *  three-part pre-check shape (order eligibility -> over-fulfilment -> stock), then
   *  delegates to the atomic write. All three checks are UX-only fast-fail 400s; the
   *  repository's own transaction re-validates every one of them authoritatively. */
  async fulfil(
    organisationId: string,
    salesOrderId: string,
    input: CreateSalesFulfilmentInput,
    actorUserId: string,
  ): Promise<FulfilSalesOrderResult> {
    const order = await this.getOrderOrThrow(organisationId, salesOrderId);
    if (order.status === SalesOrderStatus.DRAFT) {
      throw new BadRequestException('Sales order must be confirmed before it can be fulfilled');
    }
    if (order.status === SalesOrderStatus.CANCELLED) {
      throw new BadRequestException('This sales order has been cancelled');
    }
    if (order.status === SalesOrderStatus.FULFILLED) {
      throw new BadRequestException('This sales order has already been fully fulfilled');
    }

    const itemsById = new Map(order.items.map((item) => [item.id, item]));
    for (const inputItem of input.items) {
      const orderItem = itemsById.get(inputItem.salesOrderItemId);
      if (!orderItem) {
        throw new BadRequestException('One or more items do not belong to this sales order');
      }
      const remaining = roundQuantity(orderItem.quantity - orderItem.quantityFulfilled);
      if (roundQuantity(inputItem.quantity) > remaining) {
        throw new BadRequestException(
          `Cannot fulfil ${inputItem.quantity} ${orderItem.product.unit} of "${orderItem.product.name}" — only ${remaining} ${orderItem.product.unit} remains outstanding`,
        );
      }
    }

    const productIds = input.items.map((item) => itemsById.get(item.salesOrderItemId)!.productId);
    const stockRows = await this.inventoryStockRepository.findManyByProductsAndLocation(
      organisationId,
      productIds,
      input.locationId,
    );
    const stockByProduct = new Map(stockRows.map((row) => [row.productId, row]));
    for (const inputItem of input.items) {
      const orderItem = itemsById.get(inputItem.salesOrderItemId)!;
      const available = stockByProduct.get(orderItem.productId)?.quantityOnHand ?? 0;
      if (inputItem.quantity > available) {
        throw new BadRequestException(
          `Insufficient stock for "${orderItem.product.name}" (available: ${available}, requested: ${inputItem.quantity})`,
        );
      }
    }

    try {
      return await this.salesFulfilmentRepository.create({
        organisationId,
        salesOrderId,
        locationId: input.locationId,
        fulfilmentDate: input.fulfilmentDate,
        fulfilledById: actorUserId,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
        items: input.items.map((item) => ({
          salesOrderItemId: item.salesOrderItemId,
          productId: itemsById.get(item.salesOrderItemId)!.productId,
          quantity: item.quantity,
        })),
      });
    } catch (error) {
      if (
        error instanceof InsufficientStockError ||
        error instanceof SalesFulfilmentConflictError
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private async getOrderOrThrow(organisationId: string, id: string) {
    const order = await this.salesOrderRepository.findById(organisationId, id);
    if (!order) {
      throw new NotFoundException('Sales order not found');
    }
    return order;
  }
}

/** Rounds to 6 decimal places purely to clear floating-point noise — same convention used
 *  throughout Inventory/Production/Sales. */
function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
