import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ProductType, PurchaseOrderStatus } from '@prisma/client';
import { CreatePurchaseOrderInput, UpdatePurchaseOrderInput } from '@zentuva/validation';

import { ProductRepository } from '../../catalogue/product/product.repository';
import { SupplierRepository } from '../../suppliers/supplier/supplier.repository';
import {
  ListPurchaseOrdersParams,
  PurchaseOrderRepository,
  PurchaseOrderWithRelations,
} from './purchase-order.repository';

const PURCHASE_ORDER_NUMBER_PREFIX = 'PO';
const PURCHASE_ORDER_NUMBER_SEQUENCE_LENGTH = 6;

/** Only these Product types may be purchased — a manufacturer buys inputs, not its own
 *  output (Sprint 4.3 brief: "Only Products whose type is: Raw Material, Packaging
 *  Material, Consumable. Finished Products must be rejected."). */
const PURCHASABLE_PRODUCT_TYPES: ProductType[] = [
  ProductType.RAW_MATERIAL,
  ProductType.PACKAGING_MATERIAL,
  ProductType.CONSUMABLE,
];

interface BuiltItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/**
 * Domain service for the PurchaseOrder aggregate (Sprint 4.3, docs/domains/procurement.md).
 * Mirrors `SupplierService`'s shape: repository access + business rules (PO number
 * generation, line/subtotal/total calculation, product-type validation, status
 * transitions) live here, not in `PurchaseOrderController`.
 *
 * Totals are always recomputed server-side from the submitted items — the brief's "Never
 * trust frontend calculations" — so `lineTotal`/`subtotal`/`total` are never accepted on
 * input, only ever returned in responses.
 */
@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly purchaseOrderRepository: PurchaseOrderRepository,
    private readonly productRepository: ProductRepository,
    private readonly supplierRepository: SupplierRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<PurchaseOrderWithRelations | null> {
    return this.purchaseOrderRepository.findById(organisationId, id);
  }

  list(
    organisationId: string,
    params?: ListPurchaseOrdersParams,
  ): Promise<PurchaseOrderWithRelations[]> {
    return this.purchaseOrderRepository.findManyByOrganisation(organisationId, params);
  }

  /** New purchase orders always start `DRAFT` — the brief's Create dialog has no Status
   *  field; a PO reaches `PENDING` ("issued to a supplier," this sprint's finish line)
   *  through a later `PATCH` with `status: "PENDING"`, and `CANCELLED` only through
   *  {@link cancel}. */
  async create(
    organisationId: string,
    input: CreatePurchaseOrderInput,
    actorUserId: string,
  ): Promise<PurchaseOrderWithRelations> {
    await this.assertSupplierExists(organisationId, input.supplierId);
    const items = await this.buildItems(organisationId, input.items);
    const { subtotal, total } = calculateTotals(items);
    const purchaseOrderNumber = await this.generateUniqueNumber();

    return this.purchaseOrderRepository.create({
      organisation: { connect: { id: organisationId } },
      purchaseOrderNumber,
      supplier: { connect: { id: input.supplierId } },
      orderDate: input.orderDate,
      expectedDeliveryDate: input.expectedDeliveryDate,
      remarks: input.remarks,
      status: PurchaseOrderStatus.DRAFT,
      subtotal,
      total,
      createdById: actorUserId,
      updatedById: actorUserId,
      items: {
        create: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
        })),
      },
    });
  }

  /** Partial update — `purchaseOrderNumber` is never accepted (brief: "Immutable").
   *  Rejects editing a `CANCELLED` order (brief: "Cancelled POs become read-only").
   *  `status` here is restricted by the validation schema to `DRAFT`/`PENDING` only —
   *  reaching `CANCELLED` requires {@link cancel}. Submitting `items` replaces the whole
   *  line list and recalculates totals; omitting it leaves the existing items untouched. */
  async update(
    organisationId: string,
    id: string,
    input: UpdatePurchaseOrderInput,
    actorUserId: string,
  ): Promise<PurchaseOrderWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (existing.status === PurchaseOrderStatus.CANCELLED) {
      throw new BadRequestException('Cancelled purchase orders cannot be edited');
    }
    if (input.supplierId) {
      await this.assertSupplierExists(organisationId, input.supplierId);
    }

    let totals: { subtotal: number; total: number } | undefined;
    let items: BuiltItem[] | undefined;
    if (input.items) {
      items = await this.buildItems(organisationId, input.items);
      totals = calculateTotals(items);
    }

    const updated = await this.purchaseOrderRepository.update(
      organisationId,
      id,
      {
        // Plain scalar FK, not a relation `connect` — `updateMany` (unlike `update`)
        // only accepts scalar field updates, no nested relation syntax.
        supplierId: input.supplierId,
        orderDate: input.orderDate,
        expectedDeliveryDate: input.expectedDeliveryDate,
        remarks: input.remarks,
        status: input.status,
        ...(totals ? { subtotal: totals.subtotal, total: totals.total } : {}),
        updatedById: actorUserId,
      },
      items,
    );
    if (!updated) {
      throw new NotFoundException('Purchase order not found');
    }
    return updated;
  }

  /** `POST /:id/cancel` — the only path to `CANCELLED`. Rejects an already-cancelled
   *  order rather than silently no-opping, same convention as
   *  `ProductService.activate`/`archive`. */
  async cancel(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<PurchaseOrderWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (existing.status === PurchaseOrderStatus.CANCELLED) {
      throw new BadRequestException('Purchase order is already cancelled');
    }

    const updated = await this.purchaseOrderRepository.update(organisationId, id, {
      status: PurchaseOrderStatus.CANCELLED,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Purchase order not found');
    }
    return updated;
  }

  private async getByIdOrThrow(
    organisationId: string,
    id: string,
  ): Promise<PurchaseOrderWithRelations> {
    const purchaseOrder = await this.purchaseOrderRepository.findById(organisationId, id);
    if (!purchaseOrder) {
      throw new NotFoundException('Purchase order not found');
    }
    return purchaseOrder;
  }

  private async assertSupplierExists(organisationId: string, supplierId: string): Promise<void> {
    const supplier = await this.supplierRepository.findById(organisationId, supplierId);
    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }
  }

  /** Validates every line's product exists in this organisation and is a purchasable
   *  type (brief: "Only Products whose type is: Raw Material, Packaging Material,
   *  Consumable. Finished Products must be rejected. This validation belongs inside the
   *  service layer."), then computes each line's total — the second line of defense
   *  behind the frontend's type-filtered product picker. */
  private async buildItems(
    organisationId: string,
    itemsInput: CreatePurchaseOrderInput['items'],
  ): Promise<BuiltItem[]> {
    const items: BuiltItem[] = [];
    for (const item of itemsInput) {
      const product = await this.productRepository.findById(organisationId, item.productId);
      if (!product) {
        throw new NotFoundException(`Product not found: ${item.productId}`);
      }
      if (!PURCHASABLE_PRODUCT_TYPES.includes(product.type)) {
        throw new BadRequestException(
          `"${product.name}" cannot be added to a purchase order — only Raw Material, ` +
            'Packaging Material, or Consumable products may be purchased',
        );
      }
      items.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: roundCurrency(item.quantity * item.unitPrice),
      });
    }
    return items;
  }

  /** `PO-000001`, `PO-000002`, ... — globally unique (see `PurchaseOrder.
   *  purchaseOrderNumber` schema comment), same collision-avoidance loop as
   *  `SupplierService`'s code generator. */
  private async generateUniqueNumber(): Promise<string> {
    let sequence = 1;
    let candidate = formatPurchaseOrderNumber(sequence);
    while (await this.purchaseOrderRepository.existsByNumber(candidate)) {
      sequence += 1;
      candidate = formatPurchaseOrderNumber(sequence);
    }
    return candidate;
  }
}

function calculateTotals(items: BuiltItem[]): { subtotal: number; total: number } {
  const subtotal = roundCurrency(items.reduce((sum, item) => sum + item.lineTotal, 0));
  // No taxes or discounts in MVP (brief) — total always equals subtotal.
  return { subtotal, total: subtotal };
}

/** Rounds to 2 decimal places to avoid floating-point drift accumulating across line
 *  items (e.g. `2000 * 350.005` style inputs) — Float storage (no Decimal type in this
 *  schema, matching the codebase's existing "simplicity over precision" convention, see
 *  docs/domains/procurement.md "Known Limitations") still benefits from rounding at each
 *  calculation step rather than only at display time. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatPurchaseOrderNumber(sequence: number): string {
  return `${PURCHASE_ORDER_NUMBER_PREFIX}-${String(sequence).padStart(PURCHASE_ORDER_NUMBER_SEQUENCE_LENGTH, '0')}`;
}
