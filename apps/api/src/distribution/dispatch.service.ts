import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DispatchStatus } from '@prisma/client';
import { CreateDispatchInput, FailDispatchInput } from '@zentuva/validation';

import { InventoryLocationRepository } from '../inventory/inventory-location.repository';
import { OutletRepository } from '../retail/outlet/outlet.repository';
import { SalesFulfilmentRepository } from '../sales/sales-fulfilment.repository';
import {
  CreateDispatchResult,
  DispatchConflictError,
  DispatchRepository,
  DispatchWithRelations,
  ListDispatchesParams,
  OverDispatchError,
} from './dispatch.repository';

const DISPATCH_CODE_PREFIX = 'DSP';
const DISPATCH_CODE_SEQUENCE_LENGTH = 6;

export interface DispatchAvailabilityRow {
  salesFulfilmentItemId: string;
  productId: string;
  product: { id: string; code: string; name: string; unit: string };
  fulfilled: number;
  dispatched: number;
  remaining: number;
}

/**
 * Domain service for the `Dispatch` aggregate (Sprint 5, docs/domains/distribution.md) —
 * the physical release of already-fulfilled goods toward a destination.
 *
 * CRITICAL, non-negotiable: this file never injects `InventoryStockRepository`/
 * `InventoryTransactionRepository`, and never injects `NetworkRelationshipRepository`/
 * `TerritoryRepository` — a Dispatch never re-deducts inventory (Sales Fulfilment
 * already did, once) and is never gated by the distribution network. See
 * `distribution-inventory-independence.spec.ts`.
 */
@Injectable()
export class DispatchService {
  constructor(
    private readonly dispatchRepository: DispatchRepository,
    private readonly salesFulfilmentRepository: SalesFulfilmentRepository,
    private readonly outletRepository: OutletRepository,
    private readonly inventoryLocationRepository: InventoryLocationRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<DispatchWithRelations> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListDispatchesParams): Promise<DispatchWithRelations[]> {
    return this.dispatchRepository.findManyByOrganisation(organisationId, params);
  }

  /** `GET /fulfilments/:salesFulfilmentId/dispatch-availability` — read-only, never
   *  gates `create()`; purely informational, same role as
   *  `SalesFulfilmentService.getAvailability`. */
  async getDispatchAvailability(
    organisationId: string,
    salesFulfilmentId: string,
  ): Promise<DispatchAvailabilityRow[]> {
    const fulfilment = await this.getFulfilmentOrThrow(organisationId, salesFulfilmentId);
    return fulfilment.items.map((item) => ({
      salesFulfilmentItemId: item.id,
      productId: item.productId,
      product: item.product,
      fulfilled: item.quantityFulfilled,
      dispatched: item.quantityDispatched,
      remaining: roundQuantity(item.quantityFulfilled - item.quantityDispatched),
    }));
  }

  /** `POST /` — creates a Dispatch from an existing `SalesFulfilment`. `customerId` is
   *  always resolved from the fulfilment's own Sales Order, never trusted from the
   *  client; an overridden `outletId` must belong to that same customer. */
  async create(
    organisationId: string,
    input: CreateDispatchInput,
    actorUserId: string,
  ): Promise<CreateDispatchResult> {
    const fulfilment = await this.getFulfilmentOrThrow(organisationId, input.salesFulfilmentId);
    const customerId = fulfilment.salesOrder.customerId;
    /** Only an explicit override needs validating — the order's own default outlet is
     *  provably already this customer's, since it came from the same order. */
    if (input.outletId) {
      await this.assertOutletBelongsToCustomer(organisationId, customerId, input.outletId);
    }
    const outletId = input.outletId ?? fulfilment.salesOrder.outletId ?? undefined;

    const sourceLocation = await this.inventoryLocationRepository.findById(
      organisationId,
      input.sourceLocationId,
    );
    if (!sourceLocation) {
      throw new BadRequestException('Source location not found');
    }

    const itemsById = new Map(fulfilment.items.map((item) => [item.id, item]));
    for (const inputItem of input.items) {
      const fulfilmentItem = itemsById.get(inputItem.salesFulfilmentItemId);
      if (!fulfilmentItem) {
        throw new BadRequestException('One or more items do not belong to this sales fulfilment');
      }
      const remaining = roundQuantity(
        fulfilmentItem.quantityFulfilled - fulfilmentItem.quantityDispatched,
      );
      if (roundQuantity(inputItem.quantity) > remaining) {
        throw new BadRequestException(
          `Cannot dispatch ${inputItem.quantity} ${fulfilmentItem.product.unit} of "${fulfilmentItem.product.name}" — only ${remaining} ${fulfilmentItem.product.unit} remains undispatched`,
        );
      }
    }

    const dispatchCode = await this.generateUniqueCode();
    try {
      return await this.dispatchRepository.create({
        organisationId,
        salesFulfilmentId: input.salesFulfilmentId,
        salesOrderId: fulfilment.salesOrder.id,
        customerId,
        outletId,
        sourceLocationId: input.sourceLocationId,
        dispatchCode,
        dispatchDate: input.dispatchDate,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
        createdById: actorUserId,
        items: input.items.map((item) => ({
          productId: itemsById.get(item.salesFulfilmentItemId)!.productId,
          salesFulfilmentItemId: item.salesFulfilmentItemId,
          quantity: item.quantity,
        })),
      });
    } catch (error) {
      if (error instanceof OverDispatchError || error instanceof DispatchConflictError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /** `POST /:id/dispatch` — `READY -> DISPATCHED`, the moment goods physically leave. */
  async dispatch(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<DispatchWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    this.assertNotTerminal(existing);
    if (existing.status !== DispatchStatus.READY) {
      throw new BadRequestException('This dispatch has already left the source location');
    }

    const updated = await this.dispatchRepository.updateStatus(
      organisationId,
      id,
      [DispatchStatus.READY],
      DispatchStatus.DISPATCHED,
      actorUserId,
    );
    if (!updated) {
      throw new NotFoundException('Dispatch not found');
    }
    return updated;
  }

  /** `POST /:id/in-transit` — `DISPATCHED -> IN_TRANSIT`. */
  async markInTransit(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<DispatchWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    this.assertNotTerminal(existing);
    if (existing.status !== DispatchStatus.DISPATCHED) {
      throw new BadRequestException('Only a dispatched shipment can be marked in transit');
    }

    const updated = await this.dispatchRepository.updateStatus(
      organisationId,
      id,
      [DispatchStatus.DISPATCHED],
      DispatchStatus.IN_TRANSIT,
      actorUserId,
    );
    if (!updated) {
      throw new NotFoundException('Dispatch not found');
    }
    return updated;
  }

  /** `POST /:id/cancel` — reachable from `READY`/`DISPATCHED`/`IN_TRANSIT`. Once any
   *  delivery has been recorded, cancellation is blocked outright — reversing partially-
   *  delivered goods is a future "Sales Returns" capability, not this one (mirrors
   *  `SalesOrderService.cancel()`'s exact guard shape). Never reverses
   *  `quantityDispatched`/`quantityDelivered` — there is nothing to reverse since neither
   *  ever touched inventory. */
  async cancel(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<DispatchWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (
      existing.status === DispatchStatus.PARTIALLY_DELIVERED ||
      existing.status === DispatchStatus.DELIVERED
    ) {
      throw new BadRequestException('Cannot cancel a dispatch once delivery has started');
    }
    if (existing.status === DispatchStatus.FAILED) {
      throw new BadRequestException('This dispatch has already failed');
    }
    if (existing.status === DispatchStatus.CANCELLED) {
      throw new BadRequestException('This dispatch has already been cancelled');
    }

    const updated = await this.dispatchRepository.updateStatus(
      organisationId,
      id,
      [DispatchStatus.READY, DispatchStatus.DISPATCHED, DispatchStatus.IN_TRANSIT],
      DispatchStatus.CANCELLED,
      actorUserId,
    );
    if (!updated) {
      throw new NotFoundException('Dispatch not found');
    }
    return updated;
  }

  /** `POST /:id/fail` — reachable only from `DISPATCHED`/`IN_TRANSIT` ("goods left but
   *  never arrived"); terminal. Requires a non-empty explanation — the minimal auditable
   *  foundation this sprint builds in place of a full Returns/Claims system. */
  async fail(
    organisationId: string,
    id: string,
    input: FailDispatchInput,
    actorUserId: string,
  ): Promise<DispatchWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (
      existing.status !== DispatchStatus.DISPATCHED &&
      existing.status !== DispatchStatus.IN_TRANSIT
    ) {
      throw new BadRequestException(
        'Only a dispatched or in-transit shipment can be marked failed',
      );
    }

    const updated = await this.dispatchRepository.updateStatus(
      organisationId,
      id,
      [DispatchStatus.DISPATCHED, DispatchStatus.IN_TRANSIT],
      DispatchStatus.FAILED,
      actorUserId,
      { notes: input.notes },
    );
    if (!updated) {
      throw new NotFoundException('Dispatch not found');
    }
    return updated;
  }

  private assertNotTerminal(dispatch: DispatchWithRelations): void {
    if (dispatch.status === DispatchStatus.CANCELLED) {
      throw new BadRequestException('This dispatch has already been cancelled');
    }
    if (dispatch.status === DispatchStatus.FAILED) {
      throw new BadRequestException('This dispatch has already failed');
    }
  }

  /** An outlet override is optional, but when supplied it must genuinely belong to the
   *  dispatch's own customer and be active — same rule and rationale as
   *  `SalesOrderService.assertOutletBelongsToCustomer`. */
  private async assertOutletBelongsToCustomer(
    organisationId: string,
    customerId: string,
    outletId: string,
  ): Promise<void> {
    const outlet = await this.outletRepository.findById(organisationId, outletId);
    if (!outlet) {
      throw new BadRequestException('Outlet not found');
    }
    if (outlet.customerId !== customerId) {
      throw new BadRequestException('The selected outlet does not belong to this customer');
    }
  }

  private async getFulfilmentOrThrow(organisationId: string, id: string) {
    const fulfilment = await this.salesFulfilmentRepository.findById(organisationId, id);
    if (!fulfilment) {
      throw new NotFoundException('Sales fulfilment not found');
    }
    return fulfilment;
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<DispatchWithRelations> {
    const dispatch = await this.dispatchRepository.findById(organisationId, id);
    if (!dispatch) {
      throw new NotFoundException('Dispatch not found');
    }
    return dispatch;
  }

  /** `DSP-000001`, `DSP-000002`, ... — globally unique, same collision-avoidance loop as
   *  `SalesOrderService.generateUniqueCode`. */
  private async generateUniqueCode(): Promise<string> {
    let sequence = 1;
    let candidate = formatDispatchCode(sequence);
    while (await this.dispatchRepository.existsByCode(candidate)) {
      sequence += 1;
      candidate = formatDispatchCode(sequence);
    }
    return candidate;
  }
}

/** Rounds to 6 decimal places purely to clear floating-point noise — same convention
 *  used throughout Inventory/Production/Sales. */
function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatDispatchCode(sequence: number): string {
  return `${DISPATCH_CODE_PREFIX}-${String(sequence).padStart(DISPATCH_CODE_SEQUENCE_LENGTH, '0')}`;
}
