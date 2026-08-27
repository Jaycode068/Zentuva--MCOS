import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LocationStatus } from '@prisma/client';
import { CreateSupplierReturnInput } from '@zentuva/validation';

import {
  MissingSystemAccountError,
  NoOpenPeriodError,
} from '../finance/accounting/journal-posting';
import { GoodsReceiptRepository } from './goods-receipt.repository';
import { InventoryLocationRepository } from './inventory-location.repository';
import {
  CreateSupplierReturnResult,
  InsufficientReturnableStockError,
  InvalidGoodsReceiptReferenceError,
  ListSupplierReturnsParams,
  OverReturnError,
  SupplierReturnRepository,
  SupplierReturnWithRelations,
} from './supplier-return.repository';

const SUPPLIER_RETURN_CODE_PREFIX = 'SRET';
const SUPPLIER_RETURN_CODE_SEQUENCE_LENGTH = 6;

/**
 * Domain service for `SupplierReturn` (Sprint 11, docs/domains/procurement.md
 * "Supplier Returns"). A single atomic write — created and posted in one call, unlike
 * `CustomerReturnService`'s two-phase request/receive.
 */
@Injectable()
export class SupplierReturnService {
  constructor(
    private readonly supplierReturnRepository: SupplierReturnRepository,
    private readonly goodsReceiptRepository: GoodsReceiptRepository,
    private readonly inventoryLocationRepository: InventoryLocationRepository,
  ) {}

  list(
    organisationId: string,
    params: ListSupplierReturnsParams = {},
  ): Promise<SupplierReturnWithRelations[]> {
    return this.supplierReturnRepository.findManyByOrganisation(organisationId, params);
  }

  async getById(organisationId: string, id: string): Promise<SupplierReturnWithRelations> {
    const found = await this.supplierReturnRepository.findById(organisationId, id);
    if (!found) {
      throw new NotFoundException('Supplier return not found');
    }
    return found;
  }

  /** `POST /supplier-returns` — the one atomic write (brief §15-19). */
  async create(
    organisationId: string,
    input: CreateSupplierReturnInput,
    actorUserId: string,
  ): Promise<CreateSupplierReturnResult> {
    const goodsReceipt = await this.goodsReceiptRepository.findById(
      organisationId,
      input.goodsReceiptId,
    );
    if (!goodsReceipt) {
      throw new NotFoundException('Goods receipt not found');
    }
    if (goodsReceipt.purchaseOrderId !== input.purchaseOrderId) {
      throw new BadRequestException(
        'This goods receipt does not belong to the given purchase order',
      );
    }

    const location = await this.inventoryLocationRepository.findById(
      organisationId,
      input.locationId,
    );
    if (!location) {
      throw new NotFoundException('Location not found');
    }
    if (location.status !== LocationStatus.ACTIVE) {
      throw new BadRequestException('This location is inactive');
    }

    const returnCode = await this.generateUniqueCode();

    try {
      return await this.supplierReturnRepository.create({
        organisationId,
        returnCode,
        supplierId: goodsReceipt.supplierId,
        purchaseOrderId: goodsReceipt.purchaseOrderId,
        goodsReceiptId: goodsReceipt.id,
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
      if (
        error instanceof OverReturnError ||
        error instanceof InvalidGoodsReceiptReferenceError ||
        error instanceof InsufficientReturnableStockError
      ) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof NoOpenPeriodError) {
        throw new BadRequestException(error.message);
      }
      if (error instanceof MissingSystemAccountError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /** `RET-000001`-style generator, `SRET-` prefix — same collision-avoidance loop as
   *  every other domain's own code generator. */
  private async generateUniqueCode(): Promise<string> {
    let sequence = 1;
    let candidate = formatReturnCode(sequence);
    while (await this.supplierReturnRepository.existsByCode(candidate)) {
      sequence += 1;
      candidate = formatReturnCode(sequence);
    }
    return candidate;
  }
}

function formatReturnCode(sequence: number): string {
  return `${SUPPLIER_RETURN_CODE_PREFIX}-${String(sequence).padStart(
    SUPPLIER_RETURN_CODE_SEQUENCE_LENGTH,
    '0',
  )}`;
}
