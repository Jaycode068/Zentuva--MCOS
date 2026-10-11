import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AccountsPayableService, ApSummary } from '../../finance/accounts-payable.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface OpenPurchaseOrderRow {
  id: string;
  purchaseOrderNumber: string;
  supplierId: string;
  supplierName: string;
  status: string;
  total: number;
  orderDate: Date;
}

export interface ProcurementSummaryReport {
  openPurchaseOrderCount: number;
  openPurchaseOrderValue: number;
  openPurchaseOrders: OpenPurchaseOrderRow[];
  /** Reused verbatim from Finance's own Accounts Payable summary — never a second
   *  payable calculation (brief §6E "avoid counting the same procurement obligation
   *  twice when summarizing purchase orders, receipts, and supplier invoices"). The
   *  PO figures above are about COMMITMENTS (ordered, not yet fully received/
   *  invoiced); `payables` is about OBLIGATIONS already invoiced — the two are
   *  deliberately distinct, non-overlapping figures, not two views of one number. */
  payables: ApSummary;
  /** Supplier invoices currently flagged with a 3-way-match discrepancy awaiting
   *  resolution — from the same `AccountsPayableService`/`SupplierInvoiceRepository`
   *  primitive the Payables Aging report's own `GRNI_PENDING_APPROVAL` figure uses. */
  discrepancyCount: number;
}

/**
 * Sprint 46 — Executive & Management Dashboards (docs/domains/reporting.md
 * "Procurement Dashboard"). No existing authoritative "open purchase orders" report
 * existed before this sprint (confirmed by the Sprint 45 audit) — genuinely new, but
 * introduces no new calculation for anything that already has one: `payables` and
 * `discrepancyCount` are pass-throughs to the existing, already-authoritative
 * `AccountsPayableService`. Only the open-PO count/value/list is a new, narrow,
 * read-only `PurchaseOrder` read — the same "documented direct-Prisma exception"
 * shape every other new Sprint 45/46 report service already uses for a domain with
 * no existing aggregate query. "Open" = `PENDING` or `PARTIALLY_RECEIVED` (an order
 * still awaiting some or all of its goods) — `APPROVED` is excluded since the audit
 * found it structurally unreachable in this codebase (no approval workflow wired to
 * Purchase Orders yet).
 */
@Injectable()
export class ProcurementSummaryReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountsPayableService: AccountsPayableService,
  ) {}

  async getReport(organisationId: string): Promise<ProcurementSummaryReport> {
    const where: Prisma.PurchaseOrderWhereInput = {
      organisationId,
      status: { in: ['PENDING', 'PARTIALLY_RECEIVED'] },
    };

    const [count, valueAggregate, orders, payables, discrepancyCount] = await Promise.all([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.aggregate({ where, _sum: { total: true } }),
      this.prisma.purchaseOrder.findMany({
        where,
        select: {
          id: true,
          purchaseOrderNumber: true,
          supplierId: true,
          status: true,
          total: true,
          orderDate: true,
          supplier: { select: { supplierName: true } },
        },
        orderBy: { orderDate: 'asc' },
        take: 25,
      }),
      this.accountsPayableService.getSummary(organisationId),
      this.prisma.supplierInvoice.count({ where: { organisationId, matchStatus: 'DISCREPANCY' } }),
    ]);

    return {
      openPurchaseOrderCount: count,
      openPurchaseOrderValue: valueAggregate._sum?.total ?? 0,
      openPurchaseOrders: orders.map((order) => ({
        id: order.id,
        purchaseOrderNumber: order.purchaseOrderNumber,
        supplierId: order.supplierId,
        supplierName: order.supplier?.supplierName ?? '—',
        status: order.status,
        total: order.total,
        orderDate: order.orderDate,
      })),
      payables,
      discrepancyCount,
    };
  }
}
