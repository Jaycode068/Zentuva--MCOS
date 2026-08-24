import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvoiceStatus, PaymentTermType, SalesOrderStatus } from '@prisma/client';
import { CreateInvoiceInput, VoidInvoiceInput } from '@zentuva/validation';

import { OrganisationService } from '../identity/organisation/organisation.service';
import { SalesOrderRepository, SalesOrderWithRelations } from '../sales/sales-order.repository';
import { InvoiceRepository, InvoiceWithRelations, ListInvoicesParams } from './invoice.repository';

const INVOICE_CODE_PREFIX = 'INV';
const INVOICE_CODE_SEQUENCE_LENGTH = 6;

/** Whole calendar days added to `invoiceDate` to compute `dueDate`, per payment term.
 *  `CASH`/`DUE_ON_RECEIPT` both mean "due immediately" (0 days) — kept as two distinct
 *  enum values because they're conceptually different payment *methods of settlement*,
 *  even though they compute the same due date today; see docs/domains/finance.md. */
const PAYMENT_TERM_DAYS: Record<PaymentTermType, number> = {
  CASH: 0,
  DUE_ON_RECEIPT: 0,
  NET_7: 7,
  NET_14: 14,
  NET_30: 30,
};

/**
 * Domain service for the `Invoice` aggregate (Sprint 6, docs/domains/finance.md) — the
 * financial consequence of a fulfilled Sales Order, created explicitly by Finance, never
 * automatically on order creation/confirmation.
 *
 * CRITICAL, non-negotiable: this file never injects `InventoryStockRepository`/
 * `InventoryTransactionRepository`/`DispatchRepository`/`DeliveryRepository`, and never
 * writes to `SalesOrder`/`SalesOrderItem` — it only *reads* Sales Order data, read-only,
 * via the exported `SalesOrderRepository`. See `finance-independence.spec.ts`.
 */
@Injectable()
export class InvoiceService {
  constructor(
    private readonly invoiceRepository: InvoiceRepository,
    private readonly salesOrderRepository: SalesOrderRepository,
    private readonly organisationService: OrganisationService,
    private readonly config: ConfigService,
  ) {}

  getById(organisationId: string, id: string): Promise<InvoiceWithRelations> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListInvoicesParams): Promise<InvoiceWithRelations[]> {
    return this.invoiceRepository.findManyByOrganisation(organisationId, params);
  }

  /** `GET /eligible-sales-orders` — Sales Orders this organisation could invoice right
   *  now: `status === FULFILLED` (the only eligibility signal Finance can see — it
   *  structurally cannot read Dispatch/Delivery status, see docs/domains/finance.md §2)
   *  and no non-VOID invoice already raised against them. */
  async listEligibleSalesOrders(organisationId: string): Promise<SalesOrderWithRelations[]> {
    const fulfilled = await this.salesOrderRepository.findManyByOrganisation(organisationId, {
      status: SalesOrderStatus.FULFILLED,
    });
    const eligible: SalesOrderWithRelations[] = [];
    for (const order of fulfilled) {
      const existing = await this.invoiceRepository.findManyBySalesOrderExcludingVoid(
        organisationId,
        order.id,
      );
      if (existing.length === 0) {
        eligible.push(order);
      }
    }
    return eligible;
  }

  /** `POST /` — creates a DRAFT Invoice from an eligible Sales Order. Snapshots every
   *  commercial value from the order's own items (never the live Product catalog, which
   *  has no price field at all); the client can only override per-line `discount`/
   *  `taxRate`, never any computed total. */
  async create(
    organisationId: string,
    input: CreateInvoiceInput,
    actorUserId: string,
  ): Promise<InvoiceWithRelations> {
    const order = await this.getOrderOrThrow(organisationId, input.salesOrderId);
    if (order.status !== SalesOrderStatus.FULFILLED) {
      throw new BadRequestException('Sales order must be fulfilled before it can be invoiced');
    }

    const existing = await this.invoiceRepository.findManyBySalesOrderExcludingVoid(
      organisationId,
      order.id,
    );
    if (existing.length > 0) {
      throw new BadRequestException(
        `This sales order has already been invoiced (${existing[0]!.invoiceCode})`,
      );
    }

    const orderItemsById = new Map(order.items.map((item) => [item.id, item]));
    const defaultTaxRatePercent = this.config.get<number>('finance.defaultTaxRatePercent', 7.5);

    let subtotal = 0;
    let discount = 0;
    let taxAmount = 0;
    const items = input.items.map((inputItem) => {
      const orderItem = orderItemsById.get(inputItem.salesOrderItemId);
      if (!orderItem) {
        throw new BadRequestException('One or more items do not belong to this sales order');
      }
      const lineDiscount = roundCurrency(inputItem.discount ?? 0);
      const lineSubtotal = roundCurrency(orderItem.quantity * orderItem.unitPrice);
      if (lineDiscount > lineSubtotal) {
        throw new BadRequestException(
          `Discount cannot exceed the line subtotal for "${orderItem.product.name}"`,
        );
      }
      const taxRate = inputItem.taxRate ?? defaultTaxRatePercent;
      const lineTaxAmount = roundCurrency(((lineSubtotal - lineDiscount) * taxRate) / 100);
      const lineTotal = roundCurrency(lineSubtotal - lineDiscount + lineTaxAmount);

      subtotal = roundCurrency(subtotal + lineSubtotal);
      discount = roundCurrency(discount + lineDiscount);
      taxAmount = roundCurrency(taxAmount + lineTaxAmount);

      return {
        productId: orderItem.productId,
        productCode: orderItem.product.code,
        productName: orderItem.product.name,
        quantity: orderItem.quantity,
        unitPrice: orderItem.unitPrice,
        discount: lineDiscount,
        taxRate,
        taxAmount: lineTaxAmount,
        lineTotal,
        salesOrderItemId: orderItem.id,
      };
    });

    const total = roundCurrency(subtotal - discount + taxAmount);
    const invoiceCode = await this.generateUniqueCode();
    const currency = await this.getOrganisationCurrency(organisationId);

    return this.invoiceRepository.create({
      organisation: { connect: { id: organisationId } },
      invoiceCode,
      customer: { connect: { id: order.customerId } },
      ...(order.outletId ? { outlet: { connect: { id: order.outletId } } } : {}),
      salesOrder: { connect: { id: order.id } },
      invoiceDate: input.invoiceDate,
      dueDate: computeDueDate(input.invoiceDate, input.paymentTerms),
      paymentTerms: input.paymentTerms,
      status: InvoiceStatus.DRAFT,
      currency,
      subtotal,
      discount,
      taxAmount,
      total,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
      updatedById: actorUserId,
      items: { create: items },
    });
  }

  /** `POST /:id/issue` — the only path from `DRAFT` to `ISSUED`. */
  async issue(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<InvoiceWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (existing.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException('Only a draft invoice can be issued');
    }

    const updated = await this.invoiceRepository.updateStatus(
      organisationId,
      id,
      [InvoiceStatus.DRAFT],
      InvoiceStatus.ISSUED,
      actorUserId,
    );
    if (!updated) {
      throw new NotFoundException('Invoice not found');
    }
    return updated;
  }

  /** `POST /:id/void` — from `DRAFT` freely; from `ISSUED` only while nothing has been
   *  paid or credited yet. Once any money has been applied, the corrective path is a
   *  Credit Note, not voiding the invoice out from under it. */
  async void(
    organisationId: string,
    id: string,
    _input: VoidInvoiceInput,
    actorUserId: string,
  ): Promise<InvoiceWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (existing.status === InvoiceStatus.VOID) {
      throw new BadRequestException('This invoice has already been voided');
    }
    if (existing.status === InvoiceStatus.PAID) {
      throw new BadRequestException('A fully paid invoice cannot be voided');
    }
    if (
      existing.status !== InvoiceStatus.DRAFT &&
      (existing.amountPaid > 0 || existing.amountCredited > 0)
    ) {
      throw new BadRequestException(
        'Cannot void an invoice once a payment or credit note has been applied — issue a credit note instead',
      );
    }

    const updated = await this.invoiceRepository.updateStatus(
      organisationId,
      id,
      [InvoiceStatus.DRAFT, InvoiceStatus.ISSUED, InvoiceStatus.OVERDUE],
      InvoiceStatus.VOID,
      actorUserId,
    );
    if (!updated) {
      throw new NotFoundException('Invoice not found');
    }
    return updated;
  }

  /** Snapshotted onto every new financial record at creation time — never re-read from
   *  the organisation later, same "snapshot, don't re-derive" rule as every other
   *  commercial value in this domain. Falls back to `'NGN'` only in the (untestable in
   *  practice, since tenant registration always creates the row) case of a missing
   *  organisation — `Organisation.currency` itself defaults to `'USD'` at the schema
   *  level, but every real Zentuva tenant has a concrete value by the time Finance is
   *  ever used. */
  private async getOrganisationCurrency(organisationId: string): Promise<string> {
    const organisation = await this.organisationService.getById(organisationId);
    return organisation?.currency ?? 'NGN';
  }

  private async getOrderOrThrow(
    organisationId: string,
    id: string,
  ): Promise<SalesOrderWithRelations> {
    const order = await this.salesOrderRepository.findById(organisationId, id);
    if (!order) {
      throw new NotFoundException('Sales order not found');
    }
    return order;
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<InvoiceWithRelations> {
    const invoice = await this.invoiceRepository.findById(organisationId, id);
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  /** `INV-000001`, `INV-000002`, ... — globally unique, same collision-avoidance loop as
   *  `SalesOrderService.generateUniqueCode`. */
  private async generateUniqueCode(): Promise<string> {
    let sequence = 1;
    let candidate = formatInvoiceCode(sequence);
    while (await this.invoiceRepository.existsByCode(candidate)) {
      sequence += 1;
      candidate = formatInvoiceCode(sequence);
    }
    return candidate;
  }
}

function computeDueDate(invoiceDate: Date, paymentTerms: PaymentTermType): Date {
  const due = new Date(invoiceDate);
  due.setDate(due.getDate() + PAYMENT_TERM_DAYS[paymentTerms]);
  return due;
}

/** Rounds to 2 decimal places for currency figures — same convention as
 *  `SalesOrderService`/`PurchaseOrderService`'s own `roundCurrency`. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatInvoiceCode(sequence: number): string {
  return `${INVOICE_CODE_PREFIX}-${String(sequence).padStart(INVOICE_CODE_SEQUENCE_LENGTH, '0')}`;
}
