import { Injectable } from '@nestjs/common';
import { Invoice, InvoiceStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListInvoicesParams {
  status?: InvoiceStatus;
  customerId?: string;
  salesOrderId?: string;
  /** Simple case-insensitive substring match against the invoice code or the customer's
   *  name — same convention as every other domain's `search` filter. */
  search?: string;
}

const CUSTOMER_SELECT = { id: true, customerCode: true, customerName: true };
const OUTLET_SELECT = { id: true, outletCode: true, name: true };

export type InvoiceWithRelations = Invoice & {
  customer: { id: string; customerCode: string; customerName: string };
  outlet: { id: string; outletCode: string; name: string } | null;
  salesOrder: { id: string; orderCode: string } | null;
  items: {
    id: string;
    productId: string | null;
    productCode: string;
    productName: string;
    description: string | null;
    quantity: number;
    unitPrice: number;
    discount: number;
    taxRate: number;
    taxAmount: number;
    lineTotal: number;
  }[];
};

const RELATIONS_INCLUDE = {
  customer: { select: CUSTOMER_SELECT },
  outlet: { select: OUTLET_SELECT },
  salesOrder: { select: { id: true, orderCode: true } },
  items: { orderBy: { createdAt: 'asc' as const } },
};

/** Statuses eligible to receive a `Payment`/`CreditNote` — anything still genuinely
 *  owing money. Never `DRAFT` (not yet a real financial document), `PAID`, or `VOID`. */
export const PAYABLE_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.OVERDUE,
];

/**
 * Thin Prisma access for the `Invoice` aggregate (Sprint 6, docs/domains/finance.md). No
 * business logic beyond the OVERDUE lazy sweep (below) — Sales Order eligibility,
 * commercial-value calculation, and status-transition rules live in `InvoiceService`;
 * this file only knows how to read/write rows.
 *
 * `create()` is a plain Prisma nested `items: { create: [...] }` write — already atomic,
 * no explicit `$transaction` needed — same convention as `SalesOrderRepository.create`
 * (an Invoice's creation doesn't decrement anything else, unlike `PaymentRepository`/
 * `CreditNoteRepository`, which do need `$transaction`).
 */
@Injectable()
export class InvoiceRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.InvoiceCreateInput): Promise<InvoiceWithRelations> {
    return this.prisma.invoice.create({ data, include: RELATIONS_INCLUDE });
  }

  async findById(organisationId: string, id: string): Promise<InvoiceWithRelations | null> {
    await this.sweepOverdue(organisationId);
    return this.prisma.invoice.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  async findManyByOrganisation(
    organisationId: string,
    params: ListInvoicesParams = {},
  ): Promise<InvoiceWithRelations[]> {
    await this.sweepOverdue(organisationId);
    return this.prisma.invoice.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.customerId ? { customerId: params.customerId } : {}),
        ...(params.salesOrderId ? { salesOrderId: params.salesOrderId } : {}),
        ...(params.search
          ? {
              OR: [
                { invoiceCode: { contains: params.search, mode: 'insensitive' } },
                { customer: { customerName: { contains: params.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Non-VOID invoice(s) already raised against this Sales Order — used by
   *  `InvoiceService.create()`'s "no duplicate invoice per order" business-rule guard
   *  (a service-level check, not a schema constraint — see the schema's own doc comment
   *  on `Invoice.idempotencyKey` for why). */
  findManyBySalesOrderExcludingVoid(
    organisationId: string,
    salesOrderId: string,
  ): Promise<InvoiceWithRelations[]> {
    return this.prisma.invoice.findMany({
      where: { organisationId, salesOrderId, status: { not: InvoiceStatus.VOID } },
      include: RELATIONS_INCLUDE,
    });
  }

  /** Globally unique (see `Invoice.invoiceCode` schema comment) — checked without an
   *  `organisationId` filter, same convention as every other auto-numbered code in this
   *  codebase. */
  async existsByCode(invoiceCode: string): Promise<boolean> {
    const count = await this.prisma.invoice.count({ where: { invoiceCode } });
    return count > 0;
  }

  /** Tenant-scoped conditional status transition — `updateMany` only matches when the
   *  invoice's current status is one of `fromStatuses`, closing the race against a
   *  concurrent transition, same as `DispatchRepository.updateStatus`. Returns `null` on
   *  no match; the service turns that into a specific `BadRequestException`. */
  async updateStatus(
    organisationId: string,
    id: string,
    fromStatuses: InvoiceStatus[],
    toStatus: InvoiceStatus,
    actorUserId: string,
  ): Promise<InvoiceWithRelations | null> {
    const result = await this.prisma.invoice.updateMany({
      where: { id, organisationId, status: { in: fromStatuses } },
      data: { status: toStatus, updatedById: actorUserId },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.invoice.findUniqueOrThrow({ where: { id }, include: RELATIONS_INCLUDE });
  }

  /** Org-wide Accounts Receivable aggregate — one row per customer with at least one
   *  non-VOID invoice. Uses `groupBy`, matching this codebase's established idiom for
   *  cross-entity reporting (`InventoryTransactionRepository.getLastMovementByProduct`,
   *  `GoodsReceiptRepository.getReceivingTotals`) rather than `findMany` + JS reduction. */
  async getArByCustomer(organisationId: string) {
    await this.sweepOverdue(organisationId);
    return this.prisma.invoice.groupBy({
      by: ['customerId'],
      where: { organisationId, status: { not: InvoiceStatus.VOID } },
      _sum: { total: true, amountPaid: true, amountCredited: true },
    });
  }

  /** Org-wide summary aggregate powering the Overview cards. */
  async getArSummary(organisationId: string) {
    await this.sweepOverdue(organisationId);
    const [totals, overdue] = await Promise.all([
      this.prisma.invoice.aggregate({
        where: { organisationId, status: { not: InvoiceStatus.VOID } },
        _sum: { total: true, amountPaid: true, amountCredited: true },
      }),
      this.prisma.invoice.aggregate({
        where: { organisationId, status: InvoiceStatus.OVERDUE },
        _sum: { total: true, amountPaid: true, amountCredited: true },
      }),
    ]);
    return { totals, overdue };
  }

  /** Everything invoiced within `[from, to)`, for the "Invoiced This Period" card. */
  async sumInvoicedBetween(organisationId: string, from: Date, to: Date): Promise<number> {
    const result = await this.prisma.invoice.aggregate({
      where: {
        organisationId,
        status: { not: InvoiceStatus.VOID },
        invoiceDate: { gte: from, lt: to },
      },
      _sum: { total: true },
    });
    return result._sum.total ?? 0;
  }

  /** A cheap, tenant-scoped conditional `updateMany` that transitions any invoice past
   *  its `dueDate` and still `ISSUED`/`PARTIALLY_PAID` to `OVERDUE`, run before every
   *  read in this repository. No cron/scheduler infrastructure exists anywhere in this
   *  codebase — this lazy sweep keeps `status` genuinely authoritative in the database
   *  (a real, auditable transition) without needing one. Baked in here rather than at
   *  the service layer so every read path — including the AR aggregates above — gets it
   *  for free. */
  private async sweepOverdue(organisationId: string): Promise<void> {
    await this.prisma.invoice.updateMany({
      where: {
        organisationId,
        status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIALLY_PAID] },
        dueDate: { lt: new Date() },
      },
      data: { status: InvoiceStatus.OVERDUE },
    });
  }
}
