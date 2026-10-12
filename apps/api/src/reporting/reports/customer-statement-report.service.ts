import { Injectable } from '@nestjs/common';
import { CreditNoteStatus, InvoiceStatus, PaymentStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AccountsReceivableService } from '../../finance/accounts-receivable.service';

export type StatementLineType = 'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE';

export interface StatementLine {
  type: StatementLineType;
  id: string;
  date: Date;
  reference: string;
  description: string;
  /** Increases the balance the customer owes (an invoice). */
  debit: number;
  /** Decreases the balance the customer owes (a payment allocation or an issued
   *  credit note). */
  credit: number;
  /** Cumulative balance immediately AFTER this line, computed by walking the lines
   *  in order starting from `openingBalance`. */
  runningBalance: number;
  /** Present only for an `INVOICE` line — lets the statement also show whether
   *  that specific invoice is overdue, without a second round trip. */
  dueDate?: Date;
}

export interface CustomerStatement {
  customerId: string;
  customerCode: string;
  customerName: string;
  periodFrom: Date;
  /** Exclusive upper bound — matches this codebase's established `[from, to)`
   *  reporting-period convention (`reporting-period.util.ts`). */
  periodTo: Date;
  openingBalance: number;
  lines: StatementLine[];
  closingBalance: number;
  /** Always true by construction — `closingBalance` is computed via
   *  `AccountsReceivableService.getCustomerBalanceAsOf(periodTo)`, the SAME
   *  authoritative method `openingBalance` uses, never by summing the displayed
   *  lines. Exposed so a caller (or a test) can independently re-derive the
   *  closing balance from `openingBalance` + lines and assert it matches — see
   *  `customer-statement-report.service.spec.ts`. */
  reconciliation: { lineBasedClosingBalance: number; authoritativeClosingBalance: number };
}

/**
 * Phase 1 — Customer Account Management, Feature B (docs/customer-account-
 * inventory-audit.md §5.4 "Customer Statement"). Opening and closing balances both
 * come from `AccountsReceivableService.getCustomerBalanceAsOf()` — a genuinely
 * historical, date-bounded re-derivation from `Invoice`/`PaymentAllocation`/
 * `CreditNote` rows (never the always-current `Invoice.amountPaid`/
 * `amountCredited` aggregates `getCustomerBalance()` uses). The displayed line
 * items are a SEPARATE, independent read of the same underlying rows, included
 * purely for the chronological narrative — the authoritative numbers are always
 * the two `getCustomerBalanceAsOf()` calls, never a sum of the displayed lines.
 * This method creates no journal entries and mutates nothing — purely a read.
 *
 * Known, accepted limitation (documented, not silently papered over, per the
 * brief's own "if a reliable opening balance is impossible for a historical
 * scenario, document it rather than fabricate a number"): a payment or credit
 * note later VOIDED is excluded from both the opening and closing balance
 * entirely, regardless of which side of the cutoff the void happened on — this
 * schema has no event log to answer "what was its status AT that date," so a
 * statement generated today for a past period reflects today's void/non-void
 * state, not a true point-in-time snapshot.
 */
@Injectable()
export class CustomerStatementReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountsReceivableService: AccountsReceivableService,
  ) {}

  async getStatement(
    organisationId: string,
    customerId: string,
    period: { from: Date; to: Date },
  ): Promise<CustomerStatement | null> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organisationId },
      select: { customerCode: true, customerName: true },
    });
    if (!customer) {
      return null;
    }

    const [openingBalanceRow, closingBalanceRow] = await Promise.all([
      this.accountsReceivableService.getCustomerBalanceAsOf(
        organisationId,
        customerId,
        period.from,
      ),
      this.accountsReceivableService.getCustomerBalanceAsOf(organisationId, customerId, period.to),
    ]);

    const [invoices, paymentAllocations, creditNotes] = await Promise.all([
      this.prisma.invoice.findMany({
        where: {
          organisationId,
          customerId,
          status: { not: InvoiceStatus.VOID },
          invoiceDate: { gte: period.from, lt: period.to },
        },
        select: { id: true, invoiceCode: true, invoiceDate: true, dueDate: true, total: true },
      }),
      this.prisma.paymentAllocation.findMany({
        where: {
          invoice: { organisationId, customerId },
          payment: {
            status: { not: PaymentStatus.VOIDED },
            paymentDate: { gte: period.from, lt: period.to },
          },
        },
        select: {
          id: true,
          amount: true,
          invoice: { select: { invoiceCode: true } },
          payment: { select: { id: true, paymentDate: true, reference: true } },
        },
      }),
      this.prisma.creditNote.findMany({
        where: {
          organisationId,
          customerId,
          status: CreditNoteStatus.ISSUED,
          creditNoteDate: { gte: period.from, lt: period.to },
        },
        select: { id: true, creditNoteCode: true, creditNoteDate: true, amount: true },
      }),
    ]);

    const unsorted: Omit<StatementLine, 'runningBalance'>[] = [
      ...invoices.map((invoice) => ({
        type: 'INVOICE' as const,
        id: invoice.id,
        date: invoice.invoiceDate,
        reference: invoice.invoiceCode,
        description: `Invoice ${invoice.invoiceCode}`,
        debit: invoice.total,
        credit: 0,
        dueDate: invoice.dueDate,
      })),
      ...paymentAllocations.map((allocation) => ({
        type: 'PAYMENT' as const,
        id: allocation.id,
        date: allocation.payment.paymentDate,
        reference: allocation.payment.reference ?? allocation.payment.id,
        description: `Payment applied to ${allocation.invoice.invoiceCode}`,
        debit: 0,
        credit: allocation.amount,
      })),
      ...creditNotes.map((creditNote) => ({
        type: 'CREDIT_NOTE' as const,
        id: creditNote.id,
        date: creditNote.creditNoteDate,
        reference: creditNote.creditNoteCode,
        description: `Credit note ${creditNote.creditNoteCode}`,
        debit: 0,
        credit: creditNote.amount,
      })),
    ];
    // Chronological order; same-day ties are stable-sorted by the order they were
    // pushed above (invoices, then payments, then credit notes) — a reasonable,
    // documented tie-break, not a meaningful accounting rule.
    unsorted.sort((a, b) => a.date.getTime() - b.date.getTime());

    let runningBalance = openingBalanceRow.totalOutstanding;
    const lines: StatementLine[] = unsorted.map((line) => {
      runningBalance = roundCurrency(runningBalance + line.debit - line.credit);
      return { ...line, runningBalance };
    });

    return {
      customerId,
      customerCode: customer.customerCode,
      customerName: customer.customerName,
      periodFrom: period.from,
      periodTo: period.to,
      openingBalance: openingBalanceRow.totalOutstanding,
      lines,
      closingBalance: closingBalanceRow.totalOutstanding,
      reconciliation: {
        lineBasedClosingBalance: runningBalance,
        authoritativeClosingBalance: closingBalanceRow.totalOutstanding,
      },
    };
  }
}

/** Rounds to 2 decimal places for currency figures — same convention used throughout
 *  the Finance domain. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
