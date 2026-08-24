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
}

/** Rounds to 2 decimal places for currency figures — same convention used throughout
 *  this domain. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
