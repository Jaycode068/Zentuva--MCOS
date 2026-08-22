import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CustomerStatus, OutletStatus, ProductType, SalesOrderStatus } from '@prisma/client';
import { CreateSalesOrderInput, UpdateSalesOrderInput } from '@zentuva/validation';

import { ProductRepository } from '../catalogue/product/product.repository';
import { CustomerRepository } from '../retail/customer/customer.repository';
import { OutletRepository } from '../retail/outlet/outlet.repository';
import {
  ListSalesOrdersParams,
  SalesOrderRepository,
  SalesOrderWithRelations,
} from './sales-order.repository';

const SALES_ORDER_CODE_PREFIX = 'SO';
const SALES_ORDER_CODE_SEQUENCE_LENGTH = 6;

interface BuiltItem {
  productId: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

/**
 * Domain service for the `SalesOrder` aggregate (Sprint 4.8, docs/domains/sales.md) — a
 * record of demand, never an inventory-moving write.
 *
 * CRITICAL, non-negotiable: this file never injects `NetworkRelationshipRepository`, and
 * `SalesModule` never imports `NetworkRelationshipModule` — there is structurally no way
 * for anything here to check "does this customer have a distributor" before allowing an
 * order. The only customer-eligibility check is `status === ACTIVE`; `customerType` is
 * never inspected. There is also no `InventoryStockRepository`/`InventoryTransactionRepository`
 * dependency anywhere in this file — creating or confirming an order never touches stock.
 */
@Injectable()
export class SalesOrderService {
  constructor(
    private readonly salesOrderRepository: SalesOrderRepository,
    private readonly customerRepository: CustomerRepository,
    private readonly outletRepository: OutletRepository,
    private readonly productRepository: ProductRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<SalesOrderWithRelations> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListSalesOrdersParams): Promise<SalesOrderWithRelations[]> {
    return this.salesOrderRepository.findManyByOrganisation(organisationId, params);
  }

  /** New sales orders always start `DRAFT`. */
  async create(
    organisationId: string,
    input: CreateSalesOrderInput,
    salesAgentId: string,
  ): Promise<SalesOrderWithRelations> {
    await this.assertCustomerEligible(organisationId, input.customerId);
    if (input.outletId) {
      await this.assertOutletBelongsToCustomer(organisationId, input.customerId, input.outletId);
    }
    const items = await this.buildItems(organisationId, input.items);
    const { subtotal, total } = this.calculateTotals(items, input.discount);
    const orderCode = await this.generateUniqueCode();

    return this.salesOrderRepository.create({
      organisation: { connect: { id: organisationId } },
      orderCode,
      customer: { connect: { id: input.customerId } },
      salesAgentId,
      status: SalesOrderStatus.DRAFT,
      orderDate: input.orderDate,
      notes: input.notes,
      subtotal,
      discount: input.discount,
      total,
      createdById: salesAgentId,
      updatedById: salesAgentId,
      items: { create: items },
      ...(input.outletId ? { outlet: { connect: { id: input.outletId } } } : {}),
    });
  }

  /** Only reachable while `status === DRAFT`. Recomputes totals from the new item list
   *  when `items` is supplied — never trusts a client-submitted total either way. */
  async update(
    organisationId: string,
    id: string,
    input: UpdateSalesOrderInput,
    actorUserId: string,
  ): Promise<SalesOrderWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (existing.status !== SalesOrderStatus.DRAFT) {
      throw new BadRequestException('Only draft sales orders can be edited');
    }
    if (input.outletId) {
      await this.assertOutletBelongsToCustomer(organisationId, existing.customerId, input.outletId);
    }

    let items: BuiltItem[] | undefined;
    let subtotal: number | undefined;
    let total: number | undefined;
    if (input.items) {
      items = await this.buildItems(organisationId, input.items);
      const discount = input.discount ?? existing.discount;
      ({ subtotal, total } = this.calculateTotals(items, discount));
    } else if (input.discount !== undefined) {
      ({ subtotal, total } = this.calculateTotals(existing.items, input.discount));
    }

    const updated = await this.salesOrderRepository.update(
      organisationId,
      id,
      {
        orderDate: input.orderDate,
        discount: input.discount,
        notes: input.notes,
        subtotal,
        total,
        updatedById: actorUserId,
        ...(input.outletId !== undefined ? { outletId: input.outletId } : {}),
      },
      items,
    );
    if (!updated) {
      throw new NotFoundException('Sales order not found');
    }
    return updated;
  }

  /** `POST /:id/confirm` — the only path from `DRAFT` to `CONFIRMED`. Never deducts or
   *  reserves inventory (brief §19/§39: "Inventory is not silently deducted"). */
  async confirm(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<SalesOrderWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (existing.status === SalesOrderStatus.CONFIRMED) {
      throw new BadRequestException('Sales order is already confirmed');
    }
    if (existing.status === SalesOrderStatus.CANCELLED) {
      throw new BadRequestException('This sales order has been cancelled');
    }

    const updated = await this.salesOrderRepository.updateStatus(
      organisationId,
      id,
      [SalesOrderStatus.DRAFT],
      SalesOrderStatus.CONFIRMED,
      actorUserId,
    );
    if (!updated) {
      throw new NotFoundException('Sales order not found');
    }
    return updated;
  }

  /** `POST /:id/cancel` — reachable from `DRAFT` or `CONFIRMED`. Since confirming never
   *  moved any stock, cancelling never needs to reverse anything. */
  async cancel(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<SalesOrderWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (existing.status === SalesOrderStatus.CANCELLED) {
      throw new BadRequestException('Sales order is already cancelled');
    }

    const updated = await this.salesOrderRepository.updateStatus(
      organisationId,
      id,
      [SalesOrderStatus.DRAFT, SalesOrderStatus.CONFIRMED],
      SalesOrderStatus.CANCELLED,
      actorUserId,
    );
    if (!updated) {
      throw new NotFoundException('Sales order not found');
    }
    return updated;
  }

  /** The only customer-eligibility check for placing an order: the customer must exist
   *  (tenant-scoped) and be `ACTIVE`. `customerType` is never inspected — a Distributor,
   *  Wholesaler, Retailer, and Supermarket are all equally eligible to buy direct. */
  private async assertCustomerEligible(organisationId: string, customerId: string): Promise<void> {
    const customer = await this.customerRepository.findById(organisationId, customerId);
    if (!customer) {
      throw new BadRequestException('Customer not found');
    }
    if (customer.status !== CustomerStatus.ACTIVE) {
      throw new BadRequestException('This customer is inactive and cannot place orders');
    }
  }

  /** An outlet is optional, but when supplied it must genuinely belong to the order's own
   *  customer and be active — a mismatched pair would poison every future outlet-level
   *  Retail Intelligence report (docs/domains/sales.md "Outlet Attribution"). */
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
    if (outlet.status !== OutletStatus.ACTIVE) {
      throw new BadRequestException('This outlet is inactive and cannot receive orders');
    }
  }

  /** Validates every `productId` resolves tenant-scoped and is a `FINISHED_PRODUCT` SKU
   *  — never a `ProductFamily`/`ProductVariant`, which were never transactional targets
   *  (mirrors `BillOfMaterialService.assertFinishedProduct`). Computes `lineTotal`
   *  server-side; the client cannot supply one (schema-enforced). */
  private async buildItems(
    organisationId: string,
    items: { productId: string; quantity: number; unitPrice: number }[],
  ): Promise<BuiltItem[]> {
    const built: BuiltItem[] = [];
    for (const item of items) {
      const product = await this.productRepository.findById(organisationId, item.productId);
      if (!product) {
        throw new BadRequestException('Product not found');
      }
      if (product.type !== ProductType.FINISHED_PRODUCT) {
        throw new BadRequestException(
          `"${product.name}" is not a finished product and cannot be sold`,
        );
      }
      built.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        lineTotal: roundCurrency(item.quantity * item.unitPrice),
      });
    }
    return built;
  }

  private calculateTotals(
    items: { lineTotal: number }[],
    discount: number,
  ): { subtotal: number; total: number } {
    const subtotal = roundCurrency(items.reduce((sum, item) => sum + item.lineTotal, 0));
    if (discount > subtotal) {
      throw new BadRequestException('Discount cannot exceed the order subtotal');
    }
    return { subtotal, total: roundCurrency(subtotal - discount) };
  }

  private async getByIdOrThrow(
    organisationId: string,
    id: string,
  ): Promise<SalesOrderWithRelations> {
    const order = await this.salesOrderRepository.findById(organisationId, id);
    if (!order) {
      throw new NotFoundException('Sales order not found');
    }
    return order;
  }

  /** `SO-000001`, `SO-000002`, ... — globally unique. `PO-` is already
   *  `PurchaseOrder`'s prefix, hence `SO-` here. */
  private async generateUniqueCode(): Promise<string> {
    let sequence = 1;
    let candidate = formatSalesOrderCode(sequence);
    while (await this.salesOrderRepository.existsByCode(candidate)) {
      sequence += 1;
      candidate = formatSalesOrderCode(sequence);
    }
    return candidate;
  }
}

/** Rounds to 2 decimal places for currency figures — same convention as
 *  `PurchaseOrderService`'s own `roundCurrency`. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatSalesOrderCode(sequence: number): string {
  return `${SALES_ORDER_CODE_PREFIX}-${String(sequence).padStart(SALES_ORDER_CODE_SEQUENCE_LENGTH, '0')}`;
}
