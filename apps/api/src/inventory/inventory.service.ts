import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DiscrepancyStatus, ProductType, PurchaseOrderStatus } from '@prisma/client';
import { CreateGoodsReceiptInput } from '@zentuva/validation';

import { ProductRepository } from '../catalogue/product/product.repository';
import { PurchaseOrderRepository } from '../procurement/purchase-order/purchase-order.repository';
import {
  GoodsReceiptConflictError,
  GoodsReceiptRepository,
  GoodsReceiptWithRelations,
  ListGoodsReceiptsParams,
  ReceiveGoodsItemData,
} from './goods-receipt.repository';
import { InventoryStockRepository, ListInventoryStockParams } from './inventory-stock.repository';
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
  product: { id: string; code: string; name: string; type: ProductType; unit: string };
  quantityOnHand: number;
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

/**
 * Domain service for Inventory (Sprint 4.4, refined Sprint 4.4.1,
 * docs/domains/inventory.md). Owns read access to the live stock balance/transaction
 * ledger, the one write operation that moves stock — receiving goods against a Purchase
 * Order — and the lightweight supplier-discrepancy resolution state that goes with it.
 *
 * `receiveGoods` validates *before* touching the database (the Purchase Order exists and
 * is still receivable, and every submitted item's `purchaseOrderItemId` actually belongs
 * to it), computes each item's accepted quantity and this receipt's discrepancy status,
 * then delegates the atomic multi-table write to `GoodsReceiptRepository.receive`.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly goodsReceiptRepository: GoodsReceiptRepository,
    private readonly inventoryStockRepository: InventoryStockRepository,
    private readonly inventoryTransactionRepository: InventoryTransactionRepository,
    private readonly purchaseOrderRepository: PurchaseOrderRepository,
    private readonly productRepository: ProductRepository,
  ) {}

  async listStock(
    organisationId: string,
    params?: ListInventoryStockParams,
  ): Promise<InventoryStockSummary[]> {
    const rows = await this.inventoryStockRepository.findManyByOrganisation(organisationId, params);
    return rows.map((row) => ({
      productId: row.productId,
      product: row.product,
      quantityOnHand: row.quantityOnHand,
      updatedAt: row.updatedAt,
    }));
  }

  /** Returns a zero-balance view when the product exists but has never been received
   *  (no `InventoryStock` row yet) rather than `404` — a product with no stock history
   *  is a normal, expected state, not a missing resource. Still `404`s when the product
   *  itself doesn't exist in this organisation. */
  async getStockByProduct(
    organisationId: string,
    productId: string,
  ): Promise<InventoryStockSummary> {
    const stock = await this.inventoryStockRepository.findByProduct(organisationId, productId);
    if (stock) {
      return {
        productId: stock.productId,
        product: stock.product,
        quantityOnHand: stock.quantityOnHand,
        updatedAt: stock.updatedAt,
      };
    }

    const product = await this.productRepository.findById(organisationId, productId);
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return {
      productId: product.id,
      product: {
        id: product.id,
        code: product.code,
        name: product.name,
        type: product.type,
        unit: product.unit,
      },
      quantityOnHand: 0,
      updatedAt: null,
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
   *  is always computed here (`delivered - rejected`), never accepted from the client. */
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

    const goodsReceiptNumber = await this.generateUniqueNumber();

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
