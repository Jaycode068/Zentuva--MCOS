import { Injectable } from '@nestjs/common';
import { InvoiceStatus, PaymentStatus, SalesOrderStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AccountsReceivableService } from '../../finance/accounts-receivable.service';
import { CreditNoteRepository } from '../../finance/credit-note.repository';
import { InvoiceRepository, PAYABLE_INVOICE_STATUSES } from '../../finance/invoice.repository';
import { PaymentRepository } from '../../finance/payment.repository';

/**
 * Phase 1 — Customer Account Management (docs/customer-account-inventory-audit.md
 * §5.2 "Customer Account View — reuses the Reporting module, not a new engine").
 * Follows the exact `ExecutiveDashboardService` composition pattern: every figure
 * comes from an already-authoritative domain service or a narrow, direct,
 * read-only `PrismaService` query (the same documented exception
 * `SalesPerformanceReportService` already established for reading `SalesOrder`
 * without importing `SalesModule`) — never a second accounting/balance-calculation
 * engine. `InvoiceRepository`/`PaymentRepository`/`CreditNoteRepository` were newly
 * exported from `FinanceModule` this phase (see its own doc comment) so this
 * service can read invoice/payment/credit-note detail directly.
 *
 * Every section below is independently gated against its OWN existing domain
 * permission and simply omitted (`null`) when the caller lacks it — the base
 * `sales.customer.view` check (enforced one level up, in `ReportingService
 * .getCustomerAccount`) only means "you may open this customer's account page at
 * all," never "you may see its financial data."
 */
@Injectable()
export class CustomerAccountReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountsReceivableService: AccountsReceivableService,
    private readonly invoiceRepository: InvoiceRepository,
    private readonly paymentRepository: PaymentRepository,
    private readonly creditNoteRepository: CreditNoteRepository,
  ) {}

  /**
   * Below this fraction of a configured credit limit, exposure is "within limit";
   * at/above it (but under 100%), "approaching"; at/over 100%, "at or over limit."
   * A documented initial default — Phase 1 brief §5C: "use a clearly documented
   * threshold... make it configurable only if that fits the architecture without
   * unnecessary complexity; otherwise use a documented initial default." No
   * per-organisation configuration exists yet; this is a single, hardcoded 80%.
   */
  static readonly APPROACHING_LIMIT_THRESHOLD_RATIO = 0.8;

  async getOverview(
    organisationId: string,
    customerId: string,
    access: {
      canViewFinance: boolean;
      canViewSalesOrders: boolean;
      canManageCredit: boolean;
    },
    period: { from: Date; to: Date },
  ) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organisationId },
    });
    if (!customer) {
      return null;
    }

    const outlets = await this.prisma.outlet.findMany({
      where: { organisationId, customerId },
      select: { id: true, outletCode: true, name: true, outletType: true, status: true },
      orderBy: { createdAt: 'asc' },
    });

    const profile = {
      id: customer.id,
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      customerType: customer.customerType,
      status: customer.status,
      contactPersonName: customer.contactPersonName,
      phoneNumber: customer.phoneNumber,
      alternatePhoneNumber: customer.alternatePhoneNumber,
      email: customer.email,
      address: customer.address,
      city: customer.city,
      state: customer.state,
      country: customer.country,
      territoryId: customer.territoryId,
      notes: customer.notes,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
      outlets,
    };

    let summary: Awaited<ReturnType<CustomerAccountReportService['buildSummary']>> | null = null;
    let credit: Awaited<ReturnType<CustomerAccountReportService['buildCreditExposure']>> | null =
      null;
    if (access.canViewFinance) {
      const [balance, aging] = await Promise.all([
        this.accountsReceivableService.getCustomerBalance(organisationId, customerId),
        this.accountsReceivableService.getAgingReport(organisationId),
      ]);
      const customerAging = aging.byCustomer.find((row) => row.customerId === customerId);
      const overdueReceivable = customerAging
        ? roundCurrency(
            customerAging.days1To30 +
              customerAging.days31To60 +
              customerAging.days61To90 +
              customerAging.days90Plus,
          )
        : 0;

      const [invoicedInPeriod, paidInPeriod, invoiceCounts] = await Promise.all([
        this.sumInvoicedInPeriod(organisationId, customerId, period),
        this.sumPaymentsAllocatedInPeriod(organisationId, customerId, period),
        this.countOutstandingInvoices(organisationId, customerId),
      ]);

      summary = await this.buildSummary({
        organisationId,
        customerId,
        period,
        totalOutstanding: balance.totalOutstanding,
        overdueReceivable,
        invoicedInPeriod,
        paidInPeriod,
        outstandingInvoiceCount: invoiceCounts.outstanding,
        overdueInvoiceCount: invoiceCounts.overdue,
        canViewSalesOrders: access.canViewSalesOrders,
      });

      credit = this.buildCreditExposure(
        customer.creditLimit,
        balance.totalOutstanding,
        access.canManageCredit,
      );
    }

    return { profile, summary, credit };
  }

  private async buildSummary(params: {
    organisationId: string;
    customerId: string;
    period: { from: Date; to: Date };
    totalOutstanding: number;
    overdueReceivable: number;
    invoicedInPeriod: number;
    paidInPeriod: number;
    outstandingInvoiceCount: number;
    overdueInvoiceCount: number;
    canViewSalesOrders: boolean;
  }) {
    let pendingSalesOrderCount = 0;
    let unfulfilledSalesOrderValue = 0;
    if (params.canViewSalesOrders) {
      const pendingOrders = await this.prisma.salesOrder.findMany({
        where: {
          organisationId: params.organisationId,
          customerId: params.customerId,
          status: { in: [SalesOrderStatus.CONFIRMED, SalesOrderStatus.PARTIALLY_FULFILLED] },
        },
        select: { total: true },
      });
      pendingSalesOrderCount = pendingOrders.length;
      unfulfilledSalesOrderValue = roundCurrency(
        pendingOrders.reduce((sum, order) => sum + order.total, 0),
      );
    }

    return {
      totalInvoicedInPeriod: params.invoicedInPeriod,
      totalPaymentsReceivedInPeriod: params.paidInPeriod,
      currentOutstandingReceivable: params.totalOutstanding,
      overdueReceivable: params.overdueReceivable,
      outstandingInvoiceCount: params.outstandingInvoiceCount,
      overdueInvoiceCount: params.overdueInvoiceCount,
      // Deliberately a SEPARATE figure from `currentOutstandingReceivable` — brief §5B:
      // "unfulfilled sales-order value must not be silently included in receivables."
      // Only populated when the caller can also view Sales Orders; `null` (not `0`)
      // otherwise, so the frontend never mistakes "no permission" for "no pending orders."
      pendingSalesOrderCount: params.canViewSalesOrders ? pendingSalesOrderCount : null,
      unfulfilledSalesOrderValue: params.canViewSalesOrders ? unfulfilledSalesOrderValue : null,
    };
  }

  private buildCreditExposure(
    creditLimit: number | null,
    totalOutstanding: number,
    canManageCredit: boolean,
  ) {
    if (creditLimit === null) {
      return {
        creditLimit: null,
        totalOutstanding,
        availableCredit: null,
        status: 'NO_LIMIT' as const,
        approachingThresholdRatio: CustomerAccountReportService.APPROACHING_LIMIT_THRESHOLD_RATIO,
        canManageCredit,
      };
    }

    const availableCredit = roundCurrency(creditLimit - totalOutstanding);
    const threshold = creditLimit * CustomerAccountReportService.APPROACHING_LIMIT_THRESHOLD_RATIO;
    let status: 'WITHIN_LIMIT' | 'APPROACHING_LIMIT' | 'AT_OR_OVER_LIMIT';
    if (totalOutstanding >= creditLimit) {
      status = 'AT_OR_OVER_LIMIT';
    } else if (totalOutstanding >= threshold) {
      status = 'APPROACHING_LIMIT';
    } else {
      status = 'WITHIN_LIMIT';
    }

    return {
      creditLimit,
      totalOutstanding,
      availableCredit,
      status,
      approachingThresholdRatio: CustomerAccountReportService.APPROACHING_LIMIT_THRESHOLD_RATIO,
      canManageCredit,
    };
  }

  private async sumInvoicedInPeriod(
    organisationId: string,
    customerId: string,
    period: { from: Date; to: Date },
  ): Promise<number> {
    const result = await this.prisma.invoice.aggregate({
      where: {
        organisationId,
        customerId,
        status: { not: InvoiceStatus.VOID },
        invoiceDate: { gte: period.from, lt: period.to },
      },
      _sum: { total: true },
    });
    return roundCurrency(result._sum.total ?? 0);
  }

  /** "Payments received" — the actual amount ALLOCATED against this customer's
   *  invoices with a `paymentDate` in the period, from non-voided payments. Brief
   *  §5B: "do not confuse payment allocations with the actual receipt of funds" —
   *  this deliberately sums allocations (what was actually applied), not raw
   *  `Payment.amount` (which, if a future phase allows partial allocation, could
   *  include a not-yet-applied remainder). Under Phase 1's "always fully allocated
   *  at creation" invariant the two totals are identical, but this is the
   *  conceptually-correct one to keep computing even after that invariant changes. */
  private async sumPaymentsAllocatedInPeriod(
    organisationId: string,
    customerId: string,
    period: { from: Date; to: Date },
  ): Promise<number> {
    const result = await this.prisma.paymentAllocation.aggregate({
      where: {
        invoice: { organisationId, customerId },
        payment: {
          status: { not: PaymentStatus.VOIDED },
          paymentDate: { gte: period.from, lt: period.to },
        },
      },
      _sum: { amount: true },
    });
    return roundCurrency(result._sum.amount ?? 0);
  }

  private async countOutstandingInvoices(
    organisationId: string,
    customerId: string,
  ): Promise<{ outstanding: number; overdue: number }> {
    const [outstanding, overdue] = await Promise.all([
      this.prisma.invoice.count({
        where: { organisationId, customerId, status: { in: PAYABLE_INVOICE_STATUSES } },
      }),
      this.prisma.invoice.count({
        where: { organisationId, customerId, status: InvoiceStatus.OVERDUE },
      }),
    ]);
    return { outstanding, overdue };
  }

  /** Outstanding invoices, Feature D — reuses `InvoiceRepository.findManyByOrganisation`
   *  (the exact same authoritative lookup/overdue-sweep `InvoiceController` uses)
   *  filtered to this customer and the payable statuses. */
  async getOutstandingInvoices(organisationId: string, customerId: string) {
    const invoices = await this.invoiceRepository.findManyByOrganisation(organisationId, {
      customerId,
    });
    return invoices
      .filter((invoice) => PAYABLE_INVOICE_STATUSES.includes(invoice.status))
      .map((invoice) => ({
        id: invoice.id,
        invoiceCode: invoice.invoiceCode,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        total: invoice.total,
        amountPaid: invoice.amountPaid,
        amountCredited: invoice.amountCredited,
        amountOutstanding: roundCurrency(
          invoice.total - invoice.amountPaid - invoice.amountCredited,
        ),
        status: invoice.status,
        isOverdue: invoice.status === InvoiceStatus.OVERDUE,
      }));
  }

  /** Payment history, Feature E — reuses `PaymentRepository.findManyByOrganisation`.
   *  `unallocatedAmount` is computed generically (see `toPaymentResponse`'s own doc
   *  comment in `payment.controller.ts` for why this is always `0` today but kept
   *  general). */
  async getPaymentHistory(organisationId: string, customerId: string) {
    const payments = await this.paymentRepository.findManyByOrganisation(organisationId, {
      customerId,
    });
    return payments.map((payment) => {
      const allocatedTotal = roundCurrency(
        payment.allocations.reduce((sum, allocation) => sum + allocation.amount, 0),
      );
      return {
        id: payment.id,
        paymentDate: payment.paymentDate,
        amount: payment.amount,
        method: payment.method,
        reference: payment.reference,
        status: payment.status,
        allocations: payment.allocations.map((allocation) => ({
          invoiceId: allocation.invoiceId,
          amount: allocation.amount,
        })),
        allocatedAmount: allocatedTotal,
        unallocatedAmount: roundCurrency(payment.amount - allocatedTotal),
        isFullyAllocated: roundCurrency(payment.amount - allocatedTotal) === 0,
      };
    });
  }

  /** Credit notes, for the transaction-history composition below. */
  private async getCreditNotes(organisationId: string, customerId: string) {
    const creditNotes = await this.creditNoteRepository.findManyByOrganisation(organisationId, {
      customerId,
    });
    return creditNotes.map((creditNote) => ({
      id: creditNote.id,
      creditNoteCode: creditNote.creditNoteCode,
      creditNoteDate: creditNote.creditNoteDate,
      amount: creditNote.amount,
      status: creditNote.status,
      invoiceId: creditNote.invoiceId,
      reason: creditNote.reason,
    }));
  }

  /**
   * Transaction history, Feature C — merges Sales Orders, Invoices, Payments,
   * Credit Notes, and Returns for ONE customer into one chronological, filterable,
   * paginated list. Per-customer row counts are bounded by nature (a single
   * customer's lifetime history, not an organisation-wide scan), so this fetches
   * each source capped at `PER_SOURCE_FETCH_CAP` rows (far more than any real
   * customer accumulates), merges, filters, sorts, and paginates in memory — a
   * deliberately different approach from an org-wide report, which would need true
   * SQL-level pagination. Each source section is simply omitted from the merge
   * when the caller lacks that source's own existing permission (never a
   * fabricated row, never a 403 for the whole history).
   */
  async getTransactionHistory(
    organisationId: string,
    customerId: string,
    access: {
      canViewSalesOrders: boolean;
      canViewInvoices: boolean;
      canViewPayments: boolean;
      canViewCreditNotes: boolean;
      canViewReturns: boolean;
    },
    filters: {
      type?: string;
      status?: string;
      from?: Date;
      to?: Date;
      page: number;
      pageSize: number;
    },
  ) {
    const PER_SOURCE_FETCH_CAP = 500;
    const rows: {
      type: string;
      id: string;
      reference: string;
      date: Date;
      description: string;
      status: string;
      amount: number | null;
    }[] = [];

    if (access.canViewSalesOrders) {
      const orders = await this.prisma.salesOrder.findMany({
        where: { organisationId, customerId },
        orderBy: { orderDate: 'desc' },
        take: PER_SOURCE_FETCH_CAP,
        select: { id: true, orderCode: true, orderDate: true, status: true, total: true },
      });
      for (const order of orders) {
        rows.push({
          type: 'SALES_ORDER',
          id: order.id,
          reference: order.orderCode,
          date: order.orderDate,
          description: `Sales order ${order.orderCode}`,
          status: order.status,
          amount: order.total,
        });
      }
    }

    if (access.canViewInvoices) {
      const invoices = await this.invoiceRepository.findManyByOrganisation(organisationId, {
        customerId,
      });
      for (const invoice of invoices.slice(0, PER_SOURCE_FETCH_CAP)) {
        rows.push({
          type: 'INVOICE',
          id: invoice.id,
          reference: invoice.invoiceCode,
          date: invoice.invoiceDate,
          description: `Invoice ${invoice.invoiceCode}`,
          status: invoice.status,
          amount: invoice.total,
        });
      }
    }

    if (access.canViewPayments) {
      const payments = await this.paymentRepository.findManyByOrganisation(organisationId, {
        customerId,
      });
      for (const payment of payments.slice(0, PER_SOURCE_FETCH_CAP)) {
        rows.push({
          type: 'PAYMENT',
          id: payment.id,
          reference: payment.reference ?? payment.id,
          date: payment.paymentDate,
          description: `Payment received${payment.reference ? ` (${payment.reference})` : ''}`,
          status: payment.status,
          amount: payment.amount,
        });
      }
    }

    if (access.canViewCreditNotes) {
      const creditNotes = await this.getCreditNotes(organisationId, customerId);
      for (const creditNote of creditNotes.slice(0, PER_SOURCE_FETCH_CAP)) {
        rows.push({
          type: 'CREDIT_NOTE',
          id: creditNote.id,
          reference: creditNote.creditNoteCode,
          date: creditNote.creditNoteDate,
          description: `Credit note ${creditNote.creditNoteCode}`,
          status: creditNote.status,
          amount: creditNote.amount,
        });
      }
    }

    if (access.canViewReturns) {
      const returns = await this.prisma.customerReturn.findMany({
        where: { organisationId, customerId },
        orderBy: { returnDate: 'desc' },
        take: PER_SOURCE_FETCH_CAP,
        select: { id: true, returnCode: true, returnDate: true, status: true },
      });
      for (const ret of returns) {
        rows.push({
          type: 'RETURN',
          id: ret.id,
          reference: ret.returnCode,
          date: ret.returnDate,
          description: `Return ${ret.returnCode}`,
          status: ret.status,
          amount: null,
        });
      }
    }

    const filtered = rows.filter((row) => {
      if (filters.type && row.type !== filters.type) return false;
      if (filters.status && row.status !== filters.status) return false;
      if (filters.from && row.date < filters.from) return false;
      if (filters.to && row.date >= filters.to) return false;
      return true;
    });
    filtered.sort((a, b) => b.date.getTime() - a.date.getTime());

    const total = filtered.length;
    const start = (filters.page - 1) * filters.pageSize;
    const page = filtered.slice(start, start + filters.pageSize);

    return { rows: page, total, page: filters.page, pageSize: filters.pageSize };
  }
}

/** Rounds to 2 decimal places for currency figures — same convention used throughout
 *  the Finance domain. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
