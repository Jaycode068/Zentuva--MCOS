import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerReturnStatus, LocationStatus } from '@prisma/client';
import { CreateCustomerReturnInput, ReceiveCustomerReturnInput } from '@zentuva/validation';

import {
  MissingSystemAccountError,
  NoOpenPeriodError,
} from '../finance/accounting/journal-posting';
import { InventoryLocationRepository } from '../inventory/inventory-location.repository';
import { FILE_STORAGE, FileStorage } from '../identity/organisation/ports/file-storage.port';
import {
  CustomerReturnConflictError,
  CustomerReturnRepository,
  CustomerReturnWithRelations,
  DispositionMismatchError,
  InvalidFulfilmentReferenceError,
  NoEligibleInvoiceError,
  OverReturnError,
  CreateCustomerReturnResult,
  ReceiveCustomerReturnResult,
} from './customer-return.repository';
import { SalesOrderRepository } from './sales-order.repository';

const CUSTOMER_RETURN_CODE_PREFIX = 'RET';
const CUSTOMER_RETURN_CODE_SEQUENCE_LENGTH = 6;

export interface ListCustomerReturnsFilters {
  status?: CustomerReturnStatus;
  customerId?: string;
  salesOrderId?: string;
  search?: string;
}

/**
 * Domain service for `CustomerReturn` (Sprint 11, docs/domains/sales.md "Customer
 * Returns"). Two-phase, mirroring `SalesFulfilmentService`'s own pre-check-then-
 * delegate shape: `request()` is the *request* step (no inventory/accounting effect);
 * `receive()` is the one atomic physical+financial event. Both apply the Sprint 9→10
 * idempotency-before-precheck lesson — `receive()`'s own idempotency short-circuit
 * lives inside `CustomerReturnRepository.receive()` itself, checked before the
 * `REQUESTED`-status precheck, exactly like `SalesFulfilmentRepository.create()`.
 */
@Injectable()
export class CustomerReturnService {
  constructor(
    private readonly customerReturnRepository: CustomerReturnRepository,
    private readonly salesOrderRepository: SalesOrderRepository,
    private readonly inventoryLocationRepository: InventoryLocationRepository,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
  ) {}

  list(
    organisationId: string,
    params: ListCustomerReturnsFilters = {},
  ): Promise<CustomerReturnWithRelations[]> {
    return this.customerReturnRepository.findManyByOrganisation(organisationId, params);
  }

  async getById(organisationId: string, id: string): Promise<CustomerReturnWithRelations> {
    return this.getByIdOrThrow(organisationId, id);
  }

  /** `POST /customer-returns` — the request step. */
  async request(
    organisationId: string,
    input: CreateCustomerReturnInput,
    actorUserId: string,
  ): Promise<CreateCustomerReturnResult> {
    // Idempotency short-circuit — checked first, before any business-rule pre-check
    // (Sprint 9→10 lesson), so a genuine retry (arriving after the order's own
    // `SalesFulfilmentItem.quantityReturned` has already moved) never gets rejected by
    // the over-return check below.
    if (input.idempotencyKey) {
      const existing = await this.customerReturnRepository.findByIdempotencyKey(
        organisationId,
        input.salesOrderId,
        input.idempotencyKey,
      );
      if (existing) {
        return { customerReturn: existing, wasCreated: false };
      }
    }

    const order = await this.salesOrderRepository.findById(organisationId, input.salesOrderId);
    if (!order) {
      throw new NotFoundException('Sales order not found');
    }

    const location = await this.inventoryLocationRepository.findById(
      organisationId,
      input.locationId,
    );
    if (!location) {
      throw new NotFoundException('Location not found');
    }
    if (location.status !== LocationStatus.ACTIVE) {
      throw new BadRequestException('This location is inactive and cannot receive returned stock');
    }

    const returnCode = await this.generateUniqueCode();

    try {
      return await this.customerReturnRepository.create({
        organisationId,
        returnCode,
        customerId: order.customerId,
        outletId: order.outletId ?? undefined,
        salesOrderId: order.id,
        locationId: input.locationId,
        returnDate: input.returnDate,
        reason: input.reason,
        reasonNotes: input.reasonNotes,
        notes: input.notes,
        createdById: actorUserId,
        idempotencyKey: input.idempotencyKey,
        items: input.items,
      });
    } catch (error) {
      if (error instanceof OverReturnError || error instanceof InvalidFulfilmentReferenceError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /** `POST /:id/receive` — the one atomic physical+financial event (brief §31/§32). */
  async receive(
    organisationId: string,
    id: string,
    input: ReceiveCustomerReturnInput,
    actorUserId: string,
  ): Promise<ReceiveCustomerReturnResult> {
    try {
      return await this.customerReturnRepository.receive({
        organisationId,
        customerReturnId: id,
        receivedById: actorUserId,
        idempotencyKey: input.idempotencyKey,
        items: input.items,
      });
    } catch (error) {
      if (
        error instanceof CustomerReturnConflictError ||
        error instanceof DispositionMismatchError ||
        error instanceof NoEligibleInvoiceError
      ) {
        throw new BadRequestException(error.message);
      }
      // The accounting posting's own guards, propagated from inside the same
      // transaction — the whole receive() rolls back with it.
      if (error instanceof NoOpenPeriodError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof MissingSystemAccountError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /** `POST /:id/cancel` — `REQUESTED` only. */
  async cancel(organisationId: string, id: string): Promise<CustomerReturnWithRelations> {
    try {
      const cancelled = await this.customerReturnRepository.cancel(organisationId, id);
      if (!cancelled) {
        throw new NotFoundException('Customer return not found');
      }
      return cancelled;
    } catch (error) {
      if (error instanceof CustomerReturnConflictError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /** `POST /:id/photo` — mirrors `DeliveryService.setPhoto`'s exact shape: a single
   *  optional photo, no new storage architecture. */
  async setPhoto(
    organisationId: string,
    id: string,
    file: { mimeType: string; buffer: Buffer },
  ): Promise<CustomerReturnWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    const previousKey = existing.photoKey;

    const uploaded = await this.fileStorage.upload({
      organisationId,
      folder: 'customer-returns',
      mimeType: file.mimeType,
      buffer: file.buffer,
    });

    const updated = await this.customerReturnRepository.setPhoto(
      organisationId,
      id,
      uploaded.url,
      uploaded.key,
    );
    if (!updated) {
      throw new NotFoundException('Customer return not found');
    }

    if (previousKey) {
      await this.fileStorage.delete(previousKey).catch(() => undefined);
    }
    return updated;
  }

  private async getByIdOrThrow(
    organisationId: string,
    id: string,
  ): Promise<CustomerReturnWithRelations> {
    const found = await this.customerReturnRepository.findById(organisationId, id);
    if (!found) {
      throw new NotFoundException('Customer return not found');
    }
    return found;
  }

  /** `RET-000001`, `RET-000002`, ... — same collision-avoidance loop as
   *  `SalesOrderService`'s own generator. */
  private async generateUniqueCode(): Promise<string> {
    let sequence = 1;
    let candidate = formatReturnCode(sequence);
    while (await this.customerReturnRepository.existsByCode(candidate)) {
      sequence += 1;
      candidate = formatReturnCode(sequence);
    }
    return candidate;
  }
}

function formatReturnCode(sequence: number): string {
  return `${CUSTOMER_RETURN_CODE_PREFIX}-${String(sequence).padStart(
    CUSTOMER_RETURN_CODE_SEQUENCE_LENGTH,
    '0',
  )}`;
}
