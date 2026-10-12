import { Injectable } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, CreditNoteStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
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
    private readonly prisma: PrismaService,
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

  /**
   * A customer's receivable balance AS OF a given instant (Phase 1 — Customer Account
   * Management, docs/customer-account-inventory-audit.md §5.4 "Customer Statement").
   * Unlike `getCustomerBalance()` above (always "right now," using `Invoice`'s own
   * running `amountPaid`/`amountCredited` aggregates), this re-derives the balance
   * from the underlying dated transactions themselves — `Invoice.invoiceDate`,
   * `Payment.paymentDate` (via its `PaymentAllocation` rows), `CreditNote
   * .creditNoteDate` — so it can answer "what did this customer owe immediately
   * before a given date," the statement's opening-balance requirement. Excludes
   * `VOID` invoices, `VOIDED` payments, and non-`ISSUED` credit notes entirely, same
   * "never happened" treatment `getCustomerBalance()` already gives them via the
   * stored aggregates — this is NOT a true point-in-time snapshot (a payment voided
   * AFTER `asOf` is excluded here too, since this schema has no event log to replay
   * "what its status was back then") — see the Customer Statement's own
   * documentation for this explicitly-accepted limitation.
   */
  async getCustomerBalanceAsOf(
    organisationId: string,
    customerId: string,
    asOf: Date,
  ): Promise<CustomerArRow> {
    const customer = await this.customerRepository.findById(organisationId, customerId);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        organisationId,
        customerId,
        status: { not: InvoiceStatus.VOID },
        invoiceDate: { lt: asOf },
      },
      select: { id: true, total: true },
    });
    const invoiceIds = invoices.map((invoice) => invoice.id);
    const totalInvoiced = roundCurrency(invoices.reduce((sum, invoice) => sum + invoice.total, 0));

    const [paidAgg, creditedAgg] =
      invoiceIds.length === 0
        ? [{ _sum: { amount: null } }, { _sum: { amount: null } }]
        : await Promise.all([
            this.prisma.paymentAllocation.aggregate({
              where: {
                invoiceId: { in: invoiceIds },
                payment: { status: { not: PaymentStatus.VOIDED }, paymentDate: { lt: asOf } },
              },
              _sum: { amount: true },
            }),
            this.prisma.creditNote.aggregate({
              where: {
                invoiceId: { in: invoiceIds },
                status: CreditNoteStatus.ISSUED,
                creditNoteDate: { lt: asOf },
              },
              _sum: { amount: true },
            }),
          ]);

    const totalPaid = roundCurrency(paidAgg._sum.amount ?? 0);
    const totalCredited = roundCurrency(creditedAgg._sum.amount ?? 0);

    return {
      customerId,
      customerCode: customer?.customerCode ?? '',
      customerName: customer?.customerName ?? '',
      totalInvoiced,
      totalPaid,
      totalCredited,
      totalOutstanding: roundCurrency(totalInvoiced - totalPaid - totalCredited),
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
