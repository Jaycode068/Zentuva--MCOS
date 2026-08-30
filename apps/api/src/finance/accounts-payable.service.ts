import { Injectable } from '@nestjs/common';

import { SupplierRepository } from '../suppliers/supplier/supplier.repository';
import { SYSTEM_ACCOUNT_KEYS } from './accounting/chart-of-account-keys';
import { LedgerService } from './accounting/ledger.service';
import { SupplierInvoiceRepository } from './supplier-invoice.repository';
import { SupplierPaymentRepository } from './supplier-payment.repository';

const DAY_MS = 24 * 60 * 60 * 1000;

/** One supplier's outstanding balance split into standard aging buckets (Sprint 13,
 *  docs/domains/finance.md "Accounts Payable Aging") — direct structural mirror of
 *  AR's own `CustomerAgingRow`. Bucketed by `asOf − dueDate` in days. */
export interface SupplierAgingRow {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  totalOutstanding: number;
}

export interface ApAgingReport {
  asOf: Date;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  totalOutstanding: number;
  bySupplier: SupplierAgingRow[];
  /** Brief §13 — the excess-over-ordered value sitting in the GRNI clearing account,
   *  never automatically reclassified into `AP` (docs/domains/accounting.md §13.4). */
  grniPendingApprovalBalance: number;
  /** Count of non-VOID `DISCREPANCY`-matchStatus supplier invoices — invoices whose
   *  billed amount exceeds what was actually recognised as payable. */
  discrepancyInvoiceCount: number;
}

export interface SupplierApRow {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  totalInvoiced: number;
  totalRecognized: number;
  totalPaid: number;
  totalCredited: number;
  totalOutstanding: number;
}

export interface ApSummary {
  totalOutstanding: number;
  totalOverdue: number;
  totalPartiallyPaid: number;
  invoicedThisPeriod: number;
  paymentsMadeThisPeriod: number;
}

/** Read-only "how much are we invoiced for on this Purchase Order, and how much of
 *  it is paid" — deliberately does NOT read `GoodsReceiptItem`/`InventoryStock` at
 *  all (Finance never imports `InventoryModule`, see `accounts-payable-independence.
 *  spec.ts`); `purchase-order-dialog.tsx` combines this with its own existing
 *  `getPurchaseOrderReceivingSummary` call (Inventory-owned) to show the full
 *  received/payable/invoiced/outstanding picture without either domain reading the
 *  other's tables. */
export interface PurchaseOrderApSummary {
  purchaseOrderId: string;
  invoiceCount: number;
  totalInvoiced: number;
  totalRecognized: number;
  totalPaid: number;
  totalCredited: number;
  totalOutstanding: number;
  discrepancyCount: number;
}

/**
 * Read-only Accounts Payable reporting (Sprint 12, docs/domains/finance.md "Accounts
 * Payable") — direct structural mirror of `AccountsReceivableService`. Derives every
 * figure from `SupplierInvoice`/`SupplierPayment` rows via `groupBy`/`aggregate`,
 * never a materialized/cached balance table — same "do not store redundant
 * balances" rule as AR. `recognizedAmount` (never `total`) is always the payable
 * basis, so a discrepancy can never inflate what these figures report as owed.
 */
@Injectable()
export class AccountsPayableService {
  constructor(
    private readonly supplierInvoiceRepository: SupplierInvoiceRepository,
    private readonly supplierPaymentRepository: SupplierPaymentRepository,
    private readonly supplierRepository: SupplierRepository,
    private readonly ledgerService: LedgerService,
  ) {}

  /** One row per supplier with at least one non-VOID supplier invoice. */
  async listBySupplier(organisationId: string): Promise<SupplierApRow[]> {
    const groups = await this.supplierInvoiceRepository.getApBySupplier(organisationId);
    const rows: SupplierApRow[] = [];
    for (const group of groups) {
      const supplier = await this.supplierRepository.findById(organisationId, group.supplierId);
      const totalInvoiced = roundCurrency(group._sum.total ?? 0);
      const totalRecognized = roundCurrency(group._sum.recognizedAmount ?? 0);
      const totalPaid = roundCurrency(group._sum.amountPaid ?? 0);
      const totalCredited = roundCurrency(group._sum.amountCredited ?? 0);
      rows.push({
        supplierId: group.supplierId,
        supplierCode: supplier?.supplierCode ?? '',
        supplierName: supplier?.supplierName ?? '',
        totalInvoiced,
        totalRecognized,
        totalPaid,
        totalCredited,
        totalOutstanding: roundCurrency(totalRecognized - totalPaid - totalCredited),
      });
    }
    return rows.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  }

  /** Single supplier's balance — same figures as one `listBySupplier` row, computed
   *  directly rather than filtering the org-wide list. */
  async getSupplierBalance(organisationId: string, supplierId: string): Promise<SupplierApRow> {
    const rows = await this.listBySupplier(organisationId);
    const row = rows.find((r) => r.supplierId === supplierId);
    if (row) {
      return row;
    }
    const supplier = await this.supplierRepository.findById(organisationId, supplierId);
    return {
      supplierId,
      supplierCode: supplier?.supplierCode ?? '',
      supplierName: supplier?.supplierName ?? '',
      totalInvoiced: 0,
      totalRecognized: 0,
      totalPaid: 0,
      totalCredited: 0,
      totalOutstanding: 0,
    };
  }

  /** Org-wide summary powering the Payables Overview cards. "This period" = the
   *  current calendar month. */
  async getSummary(organisationId: string): Promise<ApSummary> {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [{ totals, overdue, partiallyPaid }, invoicedThisPeriod, paymentsMadeThisPeriod] =
      await Promise.all([
        this.supplierInvoiceRepository.getApSummary(organisationId),
        this.supplierInvoiceRepository.sumInvoicedBetween(organisationId, periodStart, periodEnd),
        this.supplierPaymentRepository.sumRecordedBetween(organisationId, periodStart, periodEnd),
      ]);

    const outstandingOf = (sums: {
      recognizedAmount: number | null;
      amountPaid: number | null;
      amountCredited: number | null;
    }) =>
      roundCurrency(
        (sums.recognizedAmount ?? 0) - (sums.amountPaid ?? 0) - (sums.amountCredited ?? 0),
      );

    return {
      totalOutstanding: outstandingOf(totals._sum),
      totalOverdue: outstandingOf(overdue._sum),
      totalPartiallyPaid: outstandingOf(partiallyPaid._sum),
      invoicedThisPeriod: roundCurrency(invoicedThisPeriod),
      paymentsMadeThisPeriod: roundCurrency(paymentsMadeThisPeriod),
    };
  }

  /** Supplier detail page financial summary (brief §12) — same figures as
   *  `getSupplierBalance`, plus a small "recent activity" slice. */
  async getSupplierFinancialSummary(
    organisationId: string,
    supplierId: string,
  ): Promise<
    SupplierApRow & {
      recentInvoiceCount: number;
      recentPaymentCount: number;
    }
  > {
    const balance = await this.getSupplierBalance(organisationId, supplierId);
    const [recentInvoiceCount, recentPaymentCount] = await Promise.all([
      this.supplierInvoiceRepository.countBySupplier(organisationId, supplierId),
      this.supplierPaymentRepository.countBySupplier(organisationId, supplierId),
    ]);
    return { ...balance, recentInvoiceCount, recentPaymentCount };
  }

  /** Purchase Order financial summary (brief §13) — see the exported interface's own
   *  doc comment for why this deliberately never reads `GoodsReceiptItem`. */
  async getPurchaseOrderFinancialSummary(
    organisationId: string,
    purchaseOrderId: string,
  ): Promise<PurchaseOrderApSummary> {
    const { aggregate, discrepancyCount } =
      await this.supplierInvoiceRepository.getApByPurchaseOrder(organisationId, purchaseOrderId);
    const totalRecognized = roundCurrency(aggregate._sum.recognizedAmount ?? 0);
    const totalPaid = roundCurrency(aggregate._sum.amountPaid ?? 0);
    const totalCredited = roundCurrency(aggregate._sum.amountCredited ?? 0);
    return {
      purchaseOrderId,
      invoiceCount: aggregate._count,
      totalInvoiced: roundCurrency(aggregate._sum.total ?? 0),
      totalRecognized,
      totalPaid,
      totalCredited,
      totalOutstanding: roundCurrency(totalRecognized - totalPaid - totalCredited),
      discrepancyCount,
    };
  }

  /** Standard Current/1-30/31-60/61-90/90+ aging (Sprint 13, docs/domains/finance.md
   *  "Accounts Payable Aging") — direct structural mirror of `AccountsReceivableService
   *  .getAgingReport()`, plus GRNI/discrepancy surfacing (brief §13). Basis is
   *  `recognizedAmount`, never `total`. */
  async getAgingReport(organisationId: string, asOf: Date = new Date()): Promise<ApAgingReport> {
    const [rows, grniPendingApprovalBalance, discrepancyInvoiceCount] = await Promise.all([
      this.supplierInvoiceRepository.getOutstandingForAging(organisationId),
      this.ledgerService.getSystemAccountBalance(
        organisationId,
        SYSTEM_ACCOUNT_KEYS.GRNI_PENDING_APPROVAL,
      ),
      this.supplierInvoiceRepository.countDiscrepancies(organisationId),
    ]);

    let current = 0;
    let days1To30 = 0;
    let days31To60 = 0;
    let days61To90 = 0;
    let days90Plus = 0;
    const bySupplier = new Map<string, SupplierAgingRow>();

    for (const row of rows) {
      const daysPastDue = Math.floor((asOf.getTime() - row.dueDate.getTime()) / DAY_MS);
      let supplierRow = bySupplier.get(row.supplierId);
      if (!supplierRow) {
        supplierRow = {
          supplierId: row.supplierId,
          supplierCode: row.supplierCode,
          supplierName: row.supplierName,
          current: 0,
          days1To30: 0,
          days31To60: 0,
          days61To90: 0,
          days90Plus: 0,
          totalOutstanding: 0,
        };
        bySupplier.set(row.supplierId, supplierRow);
      }

      if (daysPastDue <= 0) {
        current = roundCurrency(current + row.amountOutstanding);
        supplierRow.current = roundCurrency(supplierRow.current + row.amountOutstanding);
      } else if (daysPastDue <= 30) {
        days1To30 = roundCurrency(days1To30 + row.amountOutstanding);
        supplierRow.days1To30 = roundCurrency(supplierRow.days1To30 + row.amountOutstanding);
      } else if (daysPastDue <= 60) {
        days31To60 = roundCurrency(days31To60 + row.amountOutstanding);
        supplierRow.days31To60 = roundCurrency(supplierRow.days31To60 + row.amountOutstanding);
      } else if (daysPastDue <= 90) {
        days61To90 = roundCurrency(days61To90 + row.amountOutstanding);
        supplierRow.days61To90 = roundCurrency(supplierRow.days61To90 + row.amountOutstanding);
      } else {
        days90Plus = roundCurrency(days90Plus + row.amountOutstanding);
        supplierRow.days90Plus = roundCurrency(supplierRow.days90Plus + row.amountOutstanding);
      }
      supplierRow.totalOutstanding = roundCurrency(
        supplierRow.totalOutstanding + row.amountOutstanding,
      );
    }

    return {
      asOf,
      current,
      days1To30,
      days31To60,
      days61To90,
      days90Plus,
      totalOutstanding: roundCurrency(current + days1To30 + days31To60 + days61To90 + days90Plus),
      bySupplier: [...bySupplier.values()].sort((a, b) => b.totalOutstanding - a.totalOutstanding),
      grniPendingApprovalBalance,
      discrepancyInvoiceCount,
    };
  }
}

/** Rounds to 2 decimal places for currency figures — same convention used throughout
 *  this domain. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
