import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LocationStatus, ProductionOrderStatus, ProductionRun } from '@prisma/client';
import {
  CompleteProductionOrderInput,
  CreateMaterialIssueInput,
  CreateProductionOrderInput,
  UpdateProductionOrderInput,
} from '@zentuva/validation';

import { InventoryLocationRepository } from '../inventory/inventory-location.repository';
import { InventoryStockRepository } from '../inventory/inventory-stock.repository';
import { BillOfMaterialRepository } from './bill-of-material.repository';
import {
  InsufficientStockError,
  IssueMaterialResult,
  ProductionMaterialIssueConflictError,
  ProductionMaterialIssueRepository,
  ProductionMaterialIssueWithItems,
} from './production-material-issue.repository';
import {
  ListProductionOrdersParams,
  ProductionOrderRepository,
  ProductionOrderWithRelations,
} from './production-order.repository';
import {
  ProductionCompletionConflictError,
  ProductionRunRepository,
} from './production-run.repository';

const PRODUCTION_ORDER_NUMBER_PREFIX = 'PROD';
const PRODUCTION_ORDER_NUMBER_SEQUENCE_LENGTH = 6;

export interface MaterialAvailabilityRow {
  componentProductId: string;
  product: { id: string; code: string; name: string; unit: string };
  requiredQuantity: number;
  unitOfMeasure: string;
  availableQuantity: number;
  /** `max(0, requiredQuantity - availableQuantity)` — brief §9: informational only, this
   *  never blocks any status transition. */
  shortfall: number;
}

export interface CompleteProductionResult {
  productionOrder: ProductionOrderWithRelations;
  productionRun: ProductionRun;
}

/**
 * Domain service for Production (Sprint 4.6, docs/domains/production.md). Owns
 * requirement-calculation (the BOM snapshot taken at order-creation time), the material-
 * availability check, status-transition rules, and delegates the two atomic
 * stock-moving operations — material issue and finished-goods completion — to
 * `ProductionMaterialIssueRepository`/`ProductionRunRepository`.
 *
 * Every write validates *before* touching the database (existence, BOM/location
 * eligibility, status, over-issue/insufficient-stock), then delegates the actual atomic
 * multi-table write to a repository method — this service itself never writes
 * `InventoryStock`/`InventoryTransaction` rows directly, same convention as
 * `InventoryService.receiveGoods`/`adjustStock`.
 */
@Injectable()
export class ProductionOrderService {
  constructor(
    private readonly productionOrderRepository: ProductionOrderRepository,
    private readonly productionMaterialIssueRepository: ProductionMaterialIssueRepository,
    private readonly productionRunRepository: ProductionRunRepository,
    private readonly billOfMaterialRepository: BillOfMaterialRepository,
    private readonly inventoryStockRepository: InventoryStockRepository,
    private readonly inventoryLocationRepository: InventoryLocationRepository,
  ) {}

  list(
    organisationId: string,
    params?: ListProductionOrdersParams,
  ): Promise<ProductionOrderWithRelations[]> {
    return this.productionOrderRepository.findManyByOrganisation(organisationId, params);
  }

  getById(organisationId: string, id: string): Promise<ProductionOrderWithRelations> {
    return this.getByIdOrThrow(organisationId, id);
  }

  /** New production orders always start `DRAFT`. Requires an `ACTIVE` bill of materials
   *  (brief §6: "Only an active bill of material can be used for a production order" —
   *  implied by "BOM: Plantain Chips v1" always being the currently-active recipe) and
   *  an `ACTIVE` production location. Computes the material-requirement snapshot once,
   *  here — never recalculated later even if the BOM subsequently changes (brief §7). */
  async create(
    organisationId: string,
    input: CreateProductionOrderInput,
    actorUserId: string,
  ): Promise<ProductionOrderWithRelations> {
    const bom = await this.billOfMaterialRepository.findById(
      organisationId,
      input.billOfMaterialId,
    );
    if (!bom) {
      throw new NotFoundException('Bill of material not found');
    }
    if (bom.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Only an active bill of material can be used for a production order',
      );
    }
    await this.assertActiveLocation(organisationId, input.locationId);

    const items = bom.items.map((bomItem) => ({
      componentProductId: bomItem.componentProductId,
      requiredQuantity: roundQuantity(
        (bomItem.quantity * input.plannedQuantity) / bom.yieldQuantity,
      ),
      unitOfMeasure: bomItem.unitOfMeasure,
    }));

    const productionOrderNumber = await this.generateUniqueNumber();

    return this.productionOrderRepository.create({
      organisation: { connect: { id: organisationId } },
      productionOrderNumber,
      product: { connect: { id: bom.productId } },
      billOfMaterial: { connect: { id: bom.id } },
      plannedQuantity: input.plannedQuantity,
      location: { connect: { id: input.locationId } },
      status: ProductionOrderStatus.DRAFT,
      notes: input.notes,
      createdById: actorUserId,
      updatedById: actorUserId,
      items: { create: items },
    });
  }

  /** Only reachable while `status === DRAFT`. If `plannedQuantity` changes, the
   *  requirement snapshot is recomputed from the order's own pinned
   *  `billOfMaterial` — never "the current active BOM," which may have changed since
   *  this order was created. */
  async update(
    organisationId: string,
    id: string,
    input: UpdateProductionOrderInput,
    actorUserId: string,
  ): Promise<ProductionOrderWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (existing.status !== ProductionOrderStatus.DRAFT) {
      throw new BadRequestException('Only draft production orders can be edited');
    }
    if (input.locationId) {
      await this.assertActiveLocation(organisationId, input.locationId);
    }

    let items:
      { componentProductId: string; requiredQuantity: number; unitOfMeasure: string }[] | undefined;
    if (input.plannedQuantity !== undefined) {
      const bom = await this.billOfMaterialRepository.findById(
        organisationId,
        existing.billOfMaterialId,
      );
      if (!bom) {
        throw new NotFoundException('Bill of material not found');
      }
      items = bom.items.map((bomItem) => ({
        componentProductId: bomItem.componentProductId,
        requiredQuantity: roundQuantity(
          (bomItem.quantity * input.plannedQuantity!) / bom.yieldQuantity,
        ),
        unitOfMeasure: bomItem.unitOfMeasure,
      }));
    }

    const updated = await this.productionOrderRepository.update(
      organisationId,
      id,
      {
        plannedQuantity: input.plannedQuantity,
        locationId: input.locationId,
        notes: input.notes,
        updatedById: actorUserId,
      },
      items,
    );
    if (!updated) {
      throw new NotFoundException('Production order not found');
    }
    return updated;
  }

  /** `POST /:id/plan` — the only path from `DRAFT` to `PLANNED`. */
  async plan(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<ProductionOrderWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (existing.status !== ProductionOrderStatus.DRAFT) {
      throw new BadRequestException('Only draft production orders can be planned');
    }

    const updated = await this.productionOrderRepository.updateStatus(
      organisationId,
      id,
      [ProductionOrderStatus.DRAFT],
      ProductionOrderStatus.PLANNED,
      actorUserId,
    );
    if (!updated) {
      throw new NotFoundException('Production order not found');
    }
    return updated;
  }

  /** `POST /:id/cancel` — only reachable from `DRAFT`/`PLANNED`. Once `IN_PROGRESS`
   *  (i.e. once any material has been issued), cancellation is deliberately blocked
   *  rather than triggering a silent inventory reversal (brief §13/§36: "do not create
   *  silent inventory reversals"). */
  async cancel(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<ProductionOrderWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (existing.status === ProductionOrderStatus.CANCELLED) {
      throw new BadRequestException('Production order is already cancelled');
    }
    if (existing.status === ProductionOrderStatus.COMPLETED) {
      throw new BadRequestException('Completed production orders cannot be cancelled');
    }
    if (existing.status === ProductionOrderStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'Production orders that have already started (material issued) cannot be cancelled',
      );
    }

    const updated = await this.productionOrderRepository.updateStatus(
      organisationId,
      id,
      [ProductionOrderStatus.DRAFT, ProductionOrderStatus.PLANNED],
      ProductionOrderStatus.CANCELLED,
      actorUserId,
    );
    if (!updated) {
      throw new NotFoundException('Production order not found');
    }
    return updated;
  }

  /** `GET /:id/availability` — required vs. available at the order's own location, per
   *  component. Informational only (brief §9): never gates `plan()` or any other
   *  transition, never auto-reserves stock, never auto-creates a Purchase Order. */
  async getAvailability(organisationId: string, id: string): Promise<MaterialAvailabilityRow[]> {
    const order = await this.getByIdOrThrow(organisationId, id);
    const productIds = order.items.map((item) => item.componentProductId);
    const stockRows = await this.inventoryStockRepository.findManyByProductsAndLocation(
      organisationId,
      productIds,
      order.locationId,
    );
    const stockByProduct = new Map(stockRows.map((row) => [row.productId, row]));

    return order.items.map((item) => {
      const stock = stockByProduct.get(item.componentProductId);
      const availableQuantity = stock
        ? roundQuantity(stock.quantityOnHand - stock.quantityReserved)
        : 0;
      return {
        componentProductId: item.componentProductId,
        product: item.componentProduct,
        requiredQuantity: item.requiredQuantity,
        unitOfMeasure: item.unitOfMeasure,
        availableQuantity,
        shortfall: Math.max(0, roundQuantity(item.requiredQuantity - availableQuantity)),
      };
    });
  }

  listMaterialIssues(
    organisationId: string,
    id: string,
  ): Promise<ProductionMaterialIssueWithItems[]> {
    return this.productionMaterialIssueRepository.findManyByProductionOrder(organisationId, id);
  }

  /** `POST /:id/material-issues` (brief §12/§13/§14). Validates every submitted
   *  component belongs to the order's own requirement snapshot, rejects over-issue
   *  (`already issued + this request > required`), pre-checks stock availability for a
   *  fast, clear `400` (the repository's own transaction re-validates authoritatively —
   *  this pre-check is UX only, not the real guard), then delegates the atomic write. */
  async issueMaterial(
    organisationId: string,
    id: string,
    input: CreateMaterialIssueInput,
    actorUserId: string,
  ): Promise<IssueMaterialResult> {
    const order = await this.getByIdOrThrow(organisationId, id);
    if (order.status === ProductionOrderStatus.DRAFT) {
      throw new BadRequestException(
        'Production order must be planned before material can be issued',
      );
    }
    if (order.status === ProductionOrderStatus.COMPLETED) {
      throw new BadRequestException('This production order has already been completed');
    }
    if (order.status === ProductionOrderStatus.CANCELLED) {
      throw new BadRequestException('This production order has been cancelled');
    }

    const requirementsByProduct = new Map(
      order.items.map((item) => [item.componentProductId, item]),
    );
    for (const inputItem of input.items) {
      if (!requirementsByProduct.has(inputItem.componentProductId)) {
        throw new BadRequestException(
          "One or more items do not belong to this production order's material requirements",
        );
      }
    }

    const issuedTotals = await this.productionMaterialIssueRepository.getIssuedTotals(
      organisationId,
      id,
    );
    for (const inputItem of input.items) {
      const requirement = requirementsByProduct.get(inputItem.componentProductId)!;
      const alreadyIssued = issuedTotals.get(inputItem.componentProductId) ?? 0;
      if (roundQuantity(alreadyIssued + inputItem.quantity) > requirement.requiredQuantity) {
        throw new BadRequestException(
          `Cannot issue ${inputItem.quantity} ${requirement.unitOfMeasure} of "${requirement.componentProduct.name}" — only ${roundQuantity(requirement.requiredQuantity - alreadyIssued)} ${requirement.unitOfMeasure} remains outstanding`,
        );
      }
    }

    const productIds = input.items.map((item) => item.componentProductId);
    const stockRows = await this.inventoryStockRepository.findManyByProductsAndLocation(
      organisationId,
      productIds,
      order.locationId,
    );
    const stockByProduct = new Map(stockRows.map((row) => [row.productId, row]));
    for (const inputItem of input.items) {
      const available = stockByProduct.get(inputItem.componentProductId)?.quantityOnHand ?? 0;
      if (inputItem.quantity > available) {
        const productName = requirementsByProduct.get(inputItem.componentProductId)!
          .componentProduct.name;
        throw new BadRequestException(
          `Insufficient stock for "${productName}" (available: ${available}, requested: ${inputItem.quantity})`,
        );
      }
    }

    try {
      return await this.productionMaterialIssueRepository.issue({
        organisationId,
        productionOrderId: id,
        locationId: order.locationId,
        issuedDate: input.issuedDate,
        issuedById: actorUserId,
        notes: input.notes,
        items: input.items,
      });
    } catch (error) {
      if (
        error instanceof InsufficientStockError ||
        error instanceof ProductionMaterialIssueConflictError
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  getProductionRun(organisationId: string, id: string): Promise<ProductionRun | null> {
    return this.productionRunRepository.findByProductionOrder(organisationId, id);
  }

  /** `POST /:id/complete` (brief §15/§16/§19) — only reachable from `IN_PROGRESS`.
   *  `acceptedQuantity` is always computed here (`produced - rejected`), never accepted
   *  from the client. */
  async completeProduction(
    organisationId: string,
    id: string,
    input: CompleteProductionOrderInput,
    actorUserId: string,
  ): Promise<CompleteProductionResult> {
    const order = await this.getByIdOrThrow(organisationId, id);
    if (order.status !== ProductionOrderStatus.IN_PROGRESS) {
      throw new BadRequestException('Only production orders that are in progress can be completed');
    }

    const acceptedQuantity = roundQuantity(input.producedQuantity - input.rejectedQuantity);

    try {
      const { productionRun } = await this.productionRunRepository.complete({
        organisationId,
        productionOrderId: id,
        productId: order.productId,
        locationId: order.locationId,
        producedQuantity: input.producedQuantity,
        rejectedQuantity: input.rejectedQuantity,
        acceptedQuantity,
        rejectionReason: input.rejectionReason,
        rejectionNotes: input.rejectionNotes,
        completedById: actorUserId,
      });
      const productionOrder = await this.getByIdOrThrow(organisationId, id);
      return { productionOrder, productionRun };
    } catch (error) {
      if (error instanceof ProductionCompletionConflictError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private async getByIdOrThrow(
    organisationId: string,
    id: string,
  ): Promise<ProductionOrderWithRelations> {
    const order = await this.productionOrderRepository.findById(organisationId, id);
    if (!order) {
      throw new NotFoundException('Production order not found');
    }
    return order;
  }

  private async assertActiveLocation(organisationId: string, locationId: string): Promise<void> {
    const location = await this.inventoryLocationRepository.findById(organisationId, locationId);
    if (!location) {
      throw new NotFoundException('Location not found');
    }
    if (location.status !== LocationStatus.ACTIVE) {
      throw new BadRequestException('This location is inactive and cannot be used for production');
    }
  }

  /** `PROD-000001`, `PROD-000002`, ... — globally unique (see `ProductionOrder.
   *  productionOrderNumber` schema comment). `PO-` is already `PurchaseOrder`'s prefix,
   *  hence `PROD-` here. */
  private async generateUniqueNumber(): Promise<string> {
    let sequence = 1;
    let candidate = formatProductionOrderNumber(sequence);
    while (await this.productionOrderRepository.existsByNumber(candidate)) {
      sequence += 1;
      candidate = formatProductionOrderNumber(sequence);
    }
    return candidate;
  }
}

/** Rounds to 6 decimal places purely to clear floating-point noise from
 *  quantity-scaling arithmetic — same convention as `InventoryService`'s own quantity
 *  rounding. */
function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatProductionOrderNumber(sequence: number): string {
  return `${PRODUCTION_ORDER_NUMBER_PREFIX}-${String(sequence).padStart(PRODUCTION_ORDER_NUMBER_SEQUENCE_LENGTH, '0')}`;
}
