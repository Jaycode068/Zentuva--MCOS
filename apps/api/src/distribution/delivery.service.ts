import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DispatchStatus } from '@prisma/client';
import { CreateDeliveryInput } from '@zentuva/validation';

import { FILE_STORAGE, FileStorage } from '../identity/organisation/ports/file-storage.port';
import { DispatchRepository } from './dispatch.repository';
import {
  CreateDeliveryResult,
  DeliveryConflictError,
  DeliveryRepository,
  DeliveryWithItems,
  OverDeliveryError,
} from './delivery.repository';

/**
 * Domain service for the `Delivery` aggregate (Sprint 5, docs/domains/distribution.md) —
 * confirms what actually arrived against an existing `Dispatch`, supporting partial/
 * short delivery. Never touches `InventoryStock`/`InventoryTransaction` — Sales
 * Fulfilment already deducted this stock, once (see
 * `distribution-inventory-independence.spec.ts`).
 */
@Injectable()
export class DeliveryService {
  constructor(
    private readonly deliveryRepository: DeliveryRepository,
    private readonly dispatchRepository: DispatchRepository,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
  ) {}

  listByDispatch(organisationId: string, dispatchId: string): Promise<DeliveryWithItems[]> {
    return this.deliveryRepository.findManyByDispatch(organisationId, dispatchId);
  }

  /** `POST /:id/deliveries` — mirrors `SalesFulfilmentService.fulfil()`'s exact
   *  three-part pre-check shape (dispatch eligibility -> over-delivery), then delegates
   *  to the atomic write. Both checks are UX-only fast-fail 400s; the repository's own
   *  transaction re-validates each authoritatively. `items` need not sum to the
   *  dispatch's full quantity — a short/partial delivery is the expected case, not an
   *  error, and `notes` is where the "why" (damaged/lost/refused) is captured, since this
   *  sprint deliberately builds no reason-code enum. */
  async create(
    organisationId: string,
    dispatchId: string,
    input: CreateDeliveryInput,
    actorUserId: string,
  ): Promise<CreateDeliveryResult> {
    const dispatch = await this.getDispatchOrThrow(organisationId, dispatchId);
    if (
      dispatch.status !== DispatchStatus.DISPATCHED &&
      dispatch.status !== DispatchStatus.IN_TRANSIT &&
      dispatch.status !== DispatchStatus.PARTIALLY_DELIVERED
    ) {
      throw new BadRequestException('This dispatch is not eligible for delivery confirmation');
    }

    const itemsById = new Map(dispatch.items.map((item) => [item.id, item]));
    for (const inputItem of input.items) {
      const dispatchItem = itemsById.get(inputItem.dispatchItemId);
      if (!dispatchItem) {
        throw new BadRequestException('One or more items do not belong to this dispatch');
      }
      const remaining = roundQuantity(
        dispatchItem.quantityDispatched - dispatchItem.quantityDelivered,
      );
      if (roundQuantity(inputItem.quantity) > remaining) {
        throw new BadRequestException(
          `Cannot deliver ${inputItem.quantity} ${dispatchItem.product.unit} of "${dispatchItem.product.name}" — only ${remaining} ${dispatchItem.product.unit} remains undelivered`,
        );
      }
    }

    try {
      return await this.deliveryRepository.create({
        organisationId,
        dispatchId,
        deliveryDate: input.deliveryDate,
        receivedByName: input.receivedByName,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
        createdById: actorUserId,
        items: input.items.map((item) => ({
          productId: itemsById.get(item.dispatchItemId)!.productId,
          dispatchItemId: item.dispatchItemId,
          quantity: item.quantity,
        })),
      });
    } catch (error) {
      if (error instanceof OverDeliveryError || error instanceof DeliveryConflictError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /** `POST /deliveries/:id/photo` — proof-of-delivery capture, mirrors
   *  `ProductService.setImage`'s exact shape: a single optional photo, no new storage
   *  architecture. Signature capture is explicitly deferred to future scope. */
  async setPhoto(
    organisationId: string,
    id: string,
    file: { mimeType: string; buffer: Buffer },
  ): Promise<DeliveryWithItems> {
    const delivery = await this.deliveryRepository.findById(organisationId, id);
    if (!delivery) {
      throw new NotFoundException('Delivery not found');
    }
    const previousKey = delivery.photoKey;

    const uploaded = await this.fileStorage.upload({
      organisationId,
      folder: 'deliveries',
      mimeType: file.mimeType,
      buffer: file.buffer,
    });

    const updated = await this.deliveryRepository.setPhoto(
      organisationId,
      id,
      uploaded.url,
      uploaded.key,
    );
    if (!updated) {
      throw new NotFoundException('Delivery not found');
    }

    if (previousKey) {
      await this.fileStorage.delete(previousKey).catch(() => undefined);
    }
    return updated;
  }

  private async getDispatchOrThrow(organisationId: string, id: string) {
    const dispatch = await this.dispatchRepository.findById(organisationId, id);
    if (!dispatch) {
      throw new NotFoundException('Dispatch not found');
    }
    return dispatch;
  }
}

/** Rounds to 6 decimal places purely to clear floating-point noise — same convention
 *  used throughout Inventory/Production/Sales. */
function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
