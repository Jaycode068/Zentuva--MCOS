import { Injectable } from '@nestjs/common';

import { CustomerRepository } from '../retail/customer/customer.repository';
import { InvoiceRepository } from './invoice.repository';
import { PaymentRepository } from './payment.repository';

export interface CustomerArRow {
  customerId: string;
  customerCode: string;
  customerName: string;
  totalInvoiced: number;
  totalPaid: number;
  totalCredited: number;
  totalOutstanding: number;
}

export interface ArSummary {
  totalOutstanding: number;
  totalOverdue: number;
  invoicedThisPeriod: number;
  paymentsReceivedThisPeriod: number;
}

/** One customer's outstanding balance split into standard aging buckets (Sprint 13,
 *  docs/domains/finance.md "Accounts Receivable Aging"). Bucketed by
 *  `asOf − dueDate` in days — `<= 0` is `current`, not yet due. */
export interface CustomerAgingRow {
  customerId: string;
  customerCode: string;
  customerName: string;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  totalOutstanding: number;
}

export interface AgingReport {
  asOf: Date;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  totalOutstanding: number;
  byCustomer: CustomerAgingRow[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Read-only Accounts Receivable reporting (Sprint 6, docs/domains/finance.md) — derives
 * every figure from `Invoice`/`Payment` rows via `groupBy`/`aggregate`, never a
 * materialized/cached balance table. "Do not store redundant balances unless there is a
 * strong architectural reason" — there isn't one here.
 */
@Injectable()
export class AccountsReceivableService {
  constructor(
    private readonly invoiceRepository: InvoiceRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly customerRepository: CustomerRepository,
  ) {}

  /** One row per customer with at least one non-VOID invoice. */
  async listByCustomer(organisationId: string): Promise<CustomerArRow[]> {
    const groups = await this.invoiceRepository.getArByCustomer(organisationId);
    const rows: CustomerArRow[] = [];
    for (const group of groups) {
      const customer = await this.customerRepository.findById(organisationId, group.customerId);
      const totalInvoiced = roundCurrency(group._sum.total ?? 0);
      const totalPaid = roundCurrency(group._sum.amountPaid ?? 0);
      const totalCredited = roundCurrency(group._sum.amountCredited ?? 0);
      rows.push({
        customerId: group.customerId,
        customerCode: customer?.customerCode ?? '',
        customerName: customer?.customerName ?? '',
        totalInvoiced,
        totalPaid,
        totalCredited,
        totalOutstanding: roundCurrency(totalInvoiced - totalPaid - totalCredited),
      });
    }
    return rows.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  }

  /** Single customer's balance — same figures as one `listByCustomer` row, computed
   *  directly rather than filtering the org-wide list. */
  async getCustomerBalance(organisationId: string, customerId: string): Promise<CustomerArRow> {
    const rows = await this.listByCustomer(organisationId);
    const row = rows.find((r) => r.customerId === customerId);
    if (row) {
      return row;
    }
    const customer = await this.customerRepository.findById(organisationId, customerId);
    return {
      customerId,
      customerCode: customer?.customerCode ?? '',
      customerName: customer?.customerName ?? '',
      totalInvoiced: 0,
      totalPaid: 0,
      totalCredited: 0,
      totalOutstanding: 0,
    };
  }

  /** Org-wide summary powering the Finance Overview cards. "This period" = the current
   *  calendar month. */
  async getSummary(organisationId: string): Promise<ArSummary> {
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [{ totals, overdue }, invoicedThisPeriod, paymentsReceivedThisPeriod] = await Promise.all(
      [
        this.invoiceRepository.getArSummary(organisationId),
        this.invoiceRepository.sumInvoicedBetween(organisationId, periodStart, periodEnd),
        this.paymentRepository.sumRecordedBetween(organisationId, periodStart, periodEnd),
      ],
    );

    const totalOutstanding = roundCurrency(
      (totals._sum.total ?? 0) - (totals._sum.amountPaid ?? 0) - (totals._sum.amountCredited ?? 0),
    );
    const totalOverdue = roundCurrency(
      (overdue._sum.total ?? 0) -
        (overdue._sum.amountPaid ?? 0) -
        (overdue._sum.amountCredited ?? 0),
    );

    return {
      totalOutstanding,
      totalOverdue,
      invoicedThisPeriod: roundCurrency(invoicedThisPeriod),
      paymentsReceivedThisPeriod: roundCurrency(paymentsReceivedThisPeriod),
    };
  }

  /** Standard Current/1-30/31-60/61-90/90+ aging (Sprint 13, docs/domains/finance.md
   *  "Accounts Receivable Aging") — bucketed by days past `dueDate` as of `asOf`
   *  (defaults to now). Every figure derived from `Invoice.dueDate`/`amountPaid`/
   *  `amountCredited` directly, never a second stored balance. */
  async getAgingReport(organisationId: string, asOf: Date = new Date()): Promise<AgingReport> {
    const rows = await this.invoiceRepository.getOutstandingForAging(organisationId);

    let current = 0;
    let days1To30 = 0;
    let days31To60 = 0;
    let days61To90 = 0;
    let days90Plus = 0;
    const byCustomer = new Map<string, CustomerAgingRow>();

    for (const row of rows) {
      const daysPastDue = Math.floor((asOf.getTime() - row.dueDate.getTime()) / DAY_MS);
      let customerRow = byCustomer.get(row.customerId);
      if (!customerRow) {
        customerRow = {
          customerId: row.customerId,
          customerCode: row.customerCode,
          customerName: row.customerName,
          current: 0,
          days1To30: 0,
          days31To60: 0,
          days61To90: 0,
          days90Plus: 0,
          totalOutstanding: 0,
        };
        byCustomer.set(row.customerId, customerRow);
      }

      if (daysPastDue <= 0) {
        current = roundCurrency(current + row.amountOutstanding);
        customerRow.current = roundCurrency(customerRow.current + row.amountOutstanding);
      } else if (daysPastDue <= 30) {
        days1To30 = roundCurrency(days1To30 + row.amountOutstanding);
        customerRow.days1To30 = roundCurrency(customerRow.days1To30 + row.amountOutstanding);
      } else if (daysPastDue <= 60) {
        days31To60 = roundCurrency(days31To60 + row.amountOutstanding);
        customerRow.days31To60 = roundCurrency(customerRow.days31To60 + row.amountOutstanding);
      } else if (daysPastDue <= 90) {
        days61To90 = roundCurrency(days61To90 + row.amountOutstanding);
        customerRow.days61To90 = roundCurrency(customerRow.days61To90 + row.amountOutstanding);
      } else {
        days90Plus = roundCurrency(days90Plus + row.amountOutstanding);
        customerRow.days90Plus = roundCurrency(customerRow.days90Plus + row.amountOutstanding);
      }
      customerRow.totalOutstanding = roundCurrency(
        customerRow.totalOutstanding + row.amountOutstanding,
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
      byCustomer: [...byCustomer.values()].sort((a, b) => b.totalOutstanding - a.totalOutstanding),
    };
  }
}

/** Rounds to 2 decimal places for currency figures — same convention used throughout
 *  this domain. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
