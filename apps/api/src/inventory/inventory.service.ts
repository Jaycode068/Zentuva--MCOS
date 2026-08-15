import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AdjustmentReason,
  DiscrepancyStatus,
  LocationStatus,
  ProductStatus,
  ProductType,
  PurchaseOrderStatus,
} from '@prisma/client';
import {
  CreateGoodsReceiptInput,
  CreateInventoryAdjustmentInput,
  CreateInventoryLocationInput,
  UpdateInventoryLocationInput,
} from '@zentuva/validation';

import { ProductRepository } from '../catalogue/product/product.repository';
import { PurchaseOrderRepository } from '../procurement/purchase-order/purchase-order.repository';
import {
  GoodsReceiptConflictError,
  GoodsReceiptRepository,
  GoodsReceiptWithRelations,
  ListGoodsReceiptsParams,
  ReceiveGoodsItemData,
} from './goods-receipt.repository';
import { InventoryLocationRepository } from './inventory-location.repository';
import {
  InventoryStockRepository,
  ListInventoryStockParams,
  NegativeStockError,
} from './inventory-stock.repository';
import {
  InventoryTransactionRepository,
  InventoryTransactionWithProduct,
  ListInventoryTransactionsParams,
} from './inventory-transaction.repository';

const GOODS_RECEIPT_NUMBER_PREFIX = 'GRN';
const GOODS_RECEIPT_NUMBER_SEQUENCE_LENGTH = 6;

/**
 * A Purchase Order is receivable in every status except `DRAFT` (never issued to the
 * supplier — nothing to receive yet) and `CANCELLED` (called off). Sprint 4.4.1
 * deliberately does **not** stop receiving once a PO reaches `RECEIVED`: the brief's own
 * replacement-goods scenario (§6/§7, test #17 "Duplicate/repeated receipt protection
 * must be redesigned around receipt identity rather than blocking all subsequent
 * receipts") requires a supplier's later replacement shipment to still be recordable
 * against an order whose original delivery already fully met its ordered quantity.
 * "Duplicate protection" now means each `POST` always creates its own new, immutable,
 * uniquely-numbered `GoodsReceipt` — never a status gate that blocks legitimate
 * follow-up deliveries.
 */
const NON_RECEIVABLE_PURCHASE_ORDER_STATUSES: PurchaseOrderStatus[] = [
  PurchaseOrderStatus.DRAFT,
  PurchaseOrderStatus.CANCELLED,
];

export interface InventoryStockSummary {
  productId: string;
  product: {
    id: string;
    code: string;
    name: string;
    type: ProductType;
    unit: string;
    status: ProductStatus;
  };
  location: { id: string; name: string };
  quantityOnHand: number;
  quantityReserved: number;
  /** `quantityOnHand - quantityReserved` — Sprint 4.5 brief §1. Reservation itself is
   *  not implemented this sprint, so `quantityReserved` is always `0` today and this
   *  always equals `quantityOnHand`; the column exists so the frontend and future
   *  Sales/Production work don't need a shape change later. */
  quantityAvailable: number;
  lastMovement: Date | null;
  updatedAt: Date | null;
}

export interface ReceiveGoodsResult {
  goodsReceipt: GoodsReceiptWithRelations;
  purchaseOrderStatus: PurchaseOrderStatus;
  /** Whether this is the first `GoodsReceipt` ever recorded against this Purchase Order
   *  — drives the `goods-receipt.replacement-received` audit event (Sprint 4.4.1 brief
   *  §14). */
  isFirstReceipt: boolean;
  /** Whether any item on this receipt was rejected — drives the
   *  `goods-receipt.discrepancy-recorded` audit event. Matches
   *  `discrepancyStatus !== NONE` for this receipt. */
  hasDiscrepancy: boolean;
}

export interface PurchaseOrderItemReceivingSummary {
  purchaseOrderItemId: string;
  product: { id: string; code: string; name: string; unit: string };
  orderedQuantity: number;
  deliveredQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  /** `max(0, ordered - delivered)` — what the supplier still needs to physically
   *  deliver. Deliberately based on *delivered*, not *accepted*: a rejected item is a
   *  quality issue tracked separately via `discrepancyStatus`, not something that
   *  reopens the original delivery commitment on its own — see
   *  docs/domains/inventory.md "Receiving Model". */
  outstandingQuantity: number;
  /** `max(0, delivered - ordered)` — the brief's Scenario E, never silently capped. */
  excessQuantity: number;
}

export interface PurchaseOrderReceivingSummary {
  purchaseOrder: { id: string; purchaseOrderNumber: string; status: PurchaseOrderStatus };
  items: PurchaseOrderItemReceivingSummary[];
  receipts: GoodsReceiptWithRelations[];
}

export interface InventoryLocationSummary {
  id: string;
  name: string;
  status: LocationStatus;
  isDefault: boolean;
  productCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockAdjustmentResult {
  productId: string;
  product: { id: string; code: string; name: string; unit: string };
  location: { id: string; name: string };
  reason: AdjustmentReason;
  quantityDelta: number;
  previousQuantity: number;
  newQuantity: number;
  transactionId: string;
}

/**
 * Domain service for Inventory (Sprint 4.4, refined Sprint 4.4.1, extended Sprint 4.5 for
 * locations and controlled stock adjustments — docs/domains/inventory.md). Owns read
 * access to the live stock balance/transaction ledger, both write operations that move
 * stock (receiving goods against a Purchase Order, and manual adjustments), the
 * lightweight supplier-discrepancy resolution state, and physical location management.
 *
 * `receiveGoods` and `adjustStock` both validate *before* touching the database, then
 * delegate the atomic multi-table write to a repository method
 * (`GoodsReceiptRepository.receive` / `InventoryStockRepository.adjustStock`) — this
 * service itself never writes `InventoryStock`/`InventoryTransaction` rows directly.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly goodsReceiptRepository: GoodsReceiptRepository,
    private readonly inventoryStockRepository: InventoryStockRepository,
    private readonly inventoryTransactionRepository: InventoryTransactionRepository,
    private readonly inventoryLocationRepository: InventoryLocationRepository,
    private readonly purchaseOrderRepository: PurchaseOrderRepository,
    private readonly productRepository: ProductRepository,
  ) {}

  async listStock(
    organisationId: string,
    params?: ListInventoryStockParams,
  ): Promise<InventoryStockSummary[]> {
    const [rows, lastMovements] = await Promise.all([
      this.inventoryStockRepository.findManyByOrganisation(organisationId, params),
      this.inventoryTransactionRepository.getLastMovementByProduct(organisationId),
    ]);
    return rows.map((row) => toStockSummary(row, lastMovements.get(row.productId) ?? null));
  }

  /** Returns a zero-balance view when the product exists but has never been received
   *  (no `InventoryStock` row yet) rather than `404` — a product with no stock history
   *  is a normal, expected state, not a missing resource. Still `404`s when the product
   *  itself doesn't exist in this organisation. Aggregates across every location the
   *  product has stock at — this endpoint predates locations and existing callers
   *  expect one balance per product, not one row per (product, location) pair. */
  async getStockByProduct(
    organisationId: string,
    productId: string,
  ): Promise<InventoryStockSummary> {
    const [rows, product, lastMovement] = await Promise.all([
      this.inventoryStockRepository.findManyByProduct(organisationId, productId),
      this.productRepository.findById(organisationId, productId),
      this.inventoryTransactionRepository.getLastMovementForProduct(organisationId, productId),
    ]);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (rows.length === 0) {
      return {
        productId: product.id,
        product: {
          id: product.id,
          code: product.code,
          name: product.name,
          type: product.type,
          unit: product.unit,
          status: product.status,
        },
        location: { id: '', name: '' },
        quantityOnHand: 0,
        quantityReserved: 0,
        quantityAvailable: 0,
        lastMovement: null,
        updatedAt: null,
      };
    }

    const quantityOnHand = roundQuantity(rows.reduce((sum, row) => sum + row.quantityOnHand, 0));
    const quantityReserved = roundQuantity(
      rows.reduce((sum, row) => sum + row.quantityReserved, 0),
    );
    const updatedAt = rows.reduce<Date | null>(
      (latest, row) => (!latest || row.updatedAt > latest ? row.updatedAt : latest),
      null,
    );
    return {
      productId: product.id,
      product: {
        id: product.id,
        code: product.code,
        name: product.name,
        type: product.type,
        unit: product.unit,
        status: product.status,
      },
      // Aggregated across locations — no single location identifies this view.
      location: { id: '', name: 'All Locations' },
      quantityOnHand,
      quantityReserved,
      quantityAvailable: roundQuantity(quantityOnHand - quantityReserved),
      lastMovement,
      updatedAt,
    };
  }

  listTransactions(
    organisationId: string,
    params?: ListInventoryTransactionsParams,
  ): Promise<InventoryTransactionWithProduct[]> {
    return this.inventoryTransactionRepository.findManyByOrganisation(organisationId, params);
  }

  listGoodsReceipts(
    organisationId: string,
    params?: ListGoodsReceiptsParams,
  ): Promise<GoodsReceiptWithRelations[]> {
    return this.goodsReceiptRepository.findManyByOrganisation(organisationId, params);
  }

  async getGoodsReceiptById(
    organisationId: string,
    id: string,
  ): Promise<GoodsReceiptWithRelations> {
    const goodsReceipt = await this.goodsReceiptRepository.findById(organisationId, id);
    if (!goodsReceipt) {
      throw new NotFoundException('Goods receipt not found');
    }
    return goodsReceipt;
  }

  /** `POST /api/inventory/goods-receipts`. See "Receiving Rules" (brief): a `DRAFT`,
   *  `CANCELLED`, or already-fully-`RECEIVED` order is rejected with a specific `400`
   *  message each; `PENDING`/`PARTIALLY_RECEIVED` are both eligible (Sprint 4.4.1 — a
   *  Purchase Order may now be received more than once). Every submitted item must
   *  reference a `purchaseOrderItemId` that's actually on the order. `acceptedQuantity`
   *  is always computed here (`delivered - rejected`), never accepted from the client.
   *  Sprint 4.5: always received into the organisation's default location — no
   *  location picker on this form yet (brief §17 "without breaking the existing
   *  flow"), so this stays a one-line resolution rather than a new input field. */
  async receiveGoods(
    organisationId: string,
    input: CreateGoodsReceiptInput,
    actorUserId: string,
  ): Promise<ReceiveGoodsResult> {
    const purchaseOrder = await this.purchaseOrderRepository.findById(
      organisationId,
      input.purchaseOrderId,
    );
    if (!purchaseOrder) {
      throw new NotFoundException('Purchase order not found');
    }
    if (purchaseOrder.status === PurchaseOrderStatus.CANCELLED) {
      throw new BadRequestException('Cancelled purchase orders cannot be received');
    }
    if (purchaseOrder.status === PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException(
        'Only purchase orders that have been issued to the supplier can be received',
      );
    }
    if (NON_RECEIVABLE_PURCHASE_ORDER_STATUSES.includes(purchaseOrder.status)) {
      // Unreachable given the two checks above (every enum value is one of DRAFT,
      // CANCELLED, or receivable) — kept as a safety net if the enum ever grows a new
      // non-receivable status without a matching explicit check being added here.
      throw new BadRequestException('This purchase order cannot be received');
    }

    const purchaseOrderItemsById = new Map(purchaseOrder.items.map((item) => [item.id, item]));
    const items: ReceiveGoodsItemData[] = input.items.map((inputItem) => {
      const purchaseOrderItem = purchaseOrderItemsById.get(inputItem.purchaseOrderItemId);
      if (!purchaseOrderItem) {
        throw new BadRequestException('One or more items do not belong to this purchase order');
      }
      return {
        purchaseOrderItemId: inputItem.purchaseOrderItemId,
        productId: purchaseOrderItem.productId,
        deliveredQuantity: inputItem.deliveredQuantity,
        rejectedQuantity: inputItem.rejectedQuantity,
        acceptedQuantity: roundQuantity(inputItem.deliveredQuantity - inputItem.rejectedQuantity),
        rejectionReason: inputItem.rejectionReason,
        rejectionNotes: inputItem.rejectionNotes,
      };
    });

    const hasDiscrepancy = items.some((item) => item.rejectedQuantity > 0);
    const discrepancyStatus = hasDiscrepancy
      ? DiscrepancyStatus.PENDING_SUPPLIER
      : DiscrepancyStatus.NONE;

    const existingTotals = await this.goodsReceiptRepository.getReceivingTotals(
      organisationId,
      input.purchaseOrderId,
    );
    const isFirstReceipt = existingTotals.size === 0;

    const [goodsReceiptNumber, defaultLocation] = await Promise.all([
      this.generateUniqueNumber(),
      this.inventoryLocationRepository.getOrCreateDefault(organisationId, actorUserId),
    ]);

    try {
      const result = await this.goodsReceiptRepository.receive({
        organisationId,
        purchaseOrderId: input.purchaseOrderId,
        purchaseOrderItems: purchaseOrder.items.map((item) => ({
          id: item.id,
          quantity: item.quantity,
        })),
        goodsReceiptNumber,
        supplierId: purchaseOrder.supplierId,
        locationId: defaultLocation.id,
        receivedDate: input.receivedDate,
        receivedById: actorUserId,
        remarks: input.remarks,
        discrepancyStatus,
        items,
      });
      return { ...result, isFirstReceipt, hasDiscrepancy };
    } catch (error) {
      // The transaction's own re-check (a concurrent request already moved this order
      // out of a receivable status between our pre-check above and now) — translate to
      // the same `400` a pre-check failure would have produced.
      if (error instanceof GoodsReceiptConflictError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /** Aggregates every `GoodsReceipt` ever recorded against a Purchase Order into a
   *  per-item Ordered/Delivered/Accepted/Rejected/Outstanding view (brief §8) plus the
   *  full receipt history (brief §13) — one call powers both the Goods Receiving
   *  dialog's "previously delivered" context and Procurement's receiving-summary
   *  display. Purchase Order data comes from the exported `PurchaseOrderRepository`
   *  (read-only, ADR-002-compliant); only this domain's own `GoodsReceiptItem` rows are
   *  queried directly. */
  async getPurchaseOrderReceivingSummary(
    organisationId: string,
    purchaseOrderId: string,
  ): Promise<PurchaseOrderReceivingSummary> {
    const purchaseOrder = await this.purchaseOrderRepository.findById(
      organisationId,
      purchaseOrderId,
    );
    if (!purchaseOrder) {
      throw new NotFoundException('Purchase order not found');
    }

    const totals = await this.goodsReceiptRepository.getReceivingTotals(
      organisationId,
      purchaseOrderId,
    );
    const receipts = await this.goodsReceiptRepository.findManyByOrganisation(organisationId, {
      purchaseOrderId,
    });

    const items: PurchaseOrderItemReceivingSummary[] = purchaseOrder.items.map((item) => {
      const total = totals.get(item.id) ?? {
        deliveredQuantity: 0,
        acceptedQuantity: 0,
        rejectedQuantity: 0,
      };
      return {
        purchaseOrderItemId: item.id,
        product: item.product,
        orderedQuantity: item.quantity,
        deliveredQuantity: total.deliveredQuantity,
        acceptedQuantity: total.acceptedQuantity,
        rejectedQuantity: total.rejectedQuantity,
        outstandingQuantity: Math.max(0, item.quantity - total.deliveredQuantity),
        excessQuantity: Math.max(0, total.deliveredQuantity - item.quantity),
      };
    });

    return {
      purchaseOrder: {
        id: purchaseOrder.id,
        purchaseOrderNumber: purchaseOrder.purchaseOrderNumber,
        status: purchaseOrder.status,
      },
      items,
      receipts,
    };
  }

  /** `PATCH /api/inventory/goods-receipts/:id/discrepancy` — the one mutation ever
   *  applied to an otherwise-immutable `GoodsReceipt` (brief §5). Progresses the
   *  lightweight supplier-resolution state; never touches what was actually received. */
  async updateDiscrepancyStatus(
    organisationId: string,
    id: string,
    status: DiscrepancyStatus,
    notes: string | undefined,
  ): Promise<GoodsReceiptWithRelations> {
    const updated = await this.goodsReceiptRepository.updateDiscrepancyStatus(
      organisationId,
      id,
      status,
      notes,
    );
    if (!updated) {
      throw new NotFoundException('Goods receipt not found');
    }
    return updated;
  }

  /** `POST /api/inventory/adjustments` (Sprint 4.5 brief §4/§8) — the sole manual write
   *  path to stock this sprint. Validates the product exists and resolves the target
   *  location (an explicit, active `locationId`, or the organisation's default) before
   *  delegating the atomic negative-stock-guarded write to
   *  `InventoryStockRepository.adjustStock`. Deliberately does not accept an arbitrary
   *  new balance — only a signed delta — so every correction is traceable to a reason
   *  in the ledger, never a silent overwrite. */
  async adjustStock(
    organisationId: string,
    input: CreateInventoryAdjustmentInput,
    actorUserId: string,
  ): Promise<StockAdjustmentResult> {
    const product = await this.productRepository.findById(organisationId, input.productId);
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const location = input.locationId
      ? await this.requireActiveLocation(organisationId, input.locationId)
      : await this.inventoryLocationRepository.getOrCreateDefault(organisationId, actorUserId);

    const existing = await this.inventoryStockRepository.findByProductAndLocation(
      organisationId,
      input.productId,
      location.id,
    );
    const previousQuantity = existing?.quantityOnHand ?? 0;

    try {
      const result = await this.inventoryStockRepository.adjustStock({
        organisationId,
        productId: input.productId,
        locationId: location.id,
        quantity: input.quantity,
        reason: input.reason,
        notes: input.notes,
        createdById: actorUserId,
      });
      return {
        productId: product.id,
        product: { id: product.id, code: product.code, name: product.name, unit: product.unit },
        location: { id: location.id, name: location.name },
        reason: input.reason,
        quantityDelta: input.quantity,
        previousQuantity,
        newQuantity: result.stock.quantityOnHand,
        transactionId: result.transaction.id,
      };
    } catch (error) {
      if (error instanceof NegativeStockError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async listLocations(organisationId: string): Promise<InventoryLocationSummary[]> {
    const rows = await this.inventoryLocationRepository.findManyByOrganisation(organisationId);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      isDefault: row.isDefault,
      productCount: row.productCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  /** `POST /api/inventory/locations` — Owner/Administrator only (enforced by
   *  `RolesGuard` at the controller). Every organisation's first location is created
   *  lazily as the default on first actual use rather than here; this endpoint is for
   *  additional locations, always starting `ACTIVE`. */
  async createLocation(
    organisationId: string,
    input: CreateInventoryLocationInput,
    actorUserId: string,
  ): Promise<InventoryLocationSummary> {
    // Ensures the organisation already has a default location before it gains a
    // second one — otherwise an org whose first-ever location was created through
    // this endpoint (rather than lazily via Goods Receiving/Adjustments) would end up
    // with two non-default locations and no default at all.
    await this.inventoryLocationRepository.getOrCreateDefault(organisationId, actorUserId);

    const created = await this.inventoryLocationRepository.create({
      organisation: { connect: { id: organisationId } },
      name: input.name,
      status: LocationStatus.ACTIVE,
      isDefault: false,
      createdById: actorUserId,
      updatedById: actorUserId,
    });
    return {
      id: created.id,
      name: created.name,
      status: created.status,
      isDefault: created.isDefault,
      productCount: 0,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  /** `PATCH /api/inventory/locations/:id` — rename and/or activate/deactivate. No
   *  delete (brief §16/§20: locations already carrying inventory history are never
   *  removed, only retired). The default location may be renamed but never
   *  deactivated — Goods Receiving and Adjustments both fall back to it, so taking it
   *  offline would silently strand every caller that doesn't specify a location. */
  async updateLocation(
    organisationId: string,
    id: string,
    input: UpdateInventoryLocationInput,
    actorUserId: string,
  ): Promise<InventoryLocationSummary> {
    const existing = await this.inventoryLocationRepository.findById(organisationId, id);
    if (!existing) {
      throw new NotFoundException('Location not found');
    }
    if (existing.isDefault && input.status === LocationStatus.INACTIVE) {
      throw new BadRequestException('The default location cannot be deactivated');
    }

    const updated = await this.inventoryLocationRepository.update(organisationId, id, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Location not found');
    }

    const rows = await this.inventoryLocationRepository.findManyByOrganisation(organisationId);
    const withCount = rows.find((row) => row.id === updated.id);
    return {
      id: updated.id,
      name: updated.name,
      status: updated.status,
      isDefault: updated.isDefault,
      productCount: withCount?.productCount ?? 0,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  private async requireActiveLocation(organisationId: string, locationId: string) {
    const location = await this.inventoryLocationRepository.findById(organisationId, locationId);
    if (!location) {
      throw new NotFoundException('Location not found');
    }
    if (location.status !== LocationStatus.ACTIVE) {
      throw new BadRequestException('This location is inactive and cannot receive stock movements');
    }
    return location;
  }

  /** `GRN-000001`, `GRN-000002`, ... — globally unique (see `GoodsReceipt.
   *  goodsReceiptNumber` schema comment), same collision-avoidance loop as
   *  `PurchaseOrderService`/`SupplierService`'s number/code generators. */
  private async generateUniqueNumber(): Promise<string> {
    let sequence = 1;
    let candidate = formatGoodsReceiptNumber(sequence);
    while (await this.goodsReceiptRepository.existsByNumber(candidate)) {
      sequence += 1;
      candidate = formatGoodsReceiptNumber(sequence);
    }
    return candidate;
  }
}

function toStockSummary(
  row: Awaited<ReturnType<InventoryStockRepository['findManyByOrganisation']>>[number],
  lastMovement: Date | null,
): InventoryStockSummary {
  return {
    productId: row.productId,
    product: row.product,
    location: row.location,
    quantityOnHand: row.quantityOnHand,
    quantityReserved: row.quantityReserved,
    quantityAvailable: roundQuantity(row.quantityOnHand - row.quantityReserved),
    lastMovement,
    updatedAt: row.updatedAt,
  };
}

/** Rounds to 6 decimal places purely to clear floating-point noise from
 *  `delivered - rejected` (e.g. `450 - 0` style inputs are exact, but this guards the
 *  same class of drift `PurchaseOrderService.roundCurrency` guards for money) — quantities
 *  here are physical counts, not currency, so this is a much smaller correction than that
 *  helper's 2-decimal rounding. */
function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatGoodsReceiptNumber(sequence: number): string {
  return `${GOODS_RECEIPT_NUMBER_PREFIX}-${String(sequence).padStart(GOODS_RECEIPT_NUMBER_SEQUENCE_LENGTH, '0')}`;
}
