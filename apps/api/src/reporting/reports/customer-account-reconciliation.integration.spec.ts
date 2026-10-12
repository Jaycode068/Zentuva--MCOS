import { PrismaClient } from '@prisma/client';

import { AccountsReceivableService } from '../../finance/accounts-receivable.service';
import { CustomerRepository } from '../../retail/customer/customer.repository';
import { InvoiceRepository } from '../../finance/invoice.repository';
import { PaymentRepository } from '../../finance/payment.repository';
import { CreditNoteRepository } from '../../finance/credit-note.repository';
import { CustomerAccountReportService } from './customer-account-report.service';
import { CustomerStatementReportService } from './customer-statement-report.service';

/**
 * Phase 1 — Customer Account Management (docs/customer-account-inventory-audit.md
 * §11 "Reconciliation and Reporting Design", §12 "Testing Requirements — Statement
 * tests: closing balance reconciles with authoritative AR"). Against REAL
 * PostgreSQL, using the real seeded "Boby Bites" organisation's real
 * Invoice/Payment/CreditNote rows (never fixtures/mocks) — proves the Customer
 * Statement's closing balance and the Customer Account Overview's receivable
 * figure both agree with `AccountsReceivableService.getCustomerBalance()`, the
 * one pre-existing authoritative calculation, and that neither new report leaks
 * across the organisation boundary.
 *
 * Deliberately NOT part of the default `pnpm test` run — run via
 * `pnpm run test:integration`.
 */
describe('Customer Account & Statement — reconciliation + tenant isolation (real PostgreSQL)', () => {
  const prisma = new PrismaClient();

  const invoiceRepository = new InvoiceRepository(prisma as never);
  const paymentRepository = new PaymentRepository(prisma as never);
  const creditNoteRepository = new CreditNoteRepository(prisma as never);
  const customerRepository = new CustomerRepository(prisma as never);
  const accountsReceivableService = new AccountsReceivableService(
    invoiceRepository,
    paymentRepository,
    customerRepository,
    prisma as never,
  );
  const customerAccountReportService = new CustomerAccountReportService(
    prisma as never,
    accountsReceivableService,
    invoiceRepository,
    paymentRepository,
    creditNoteRepository,
  );
  const customerStatementReportService = new CustomerStatementReportService(
    prisma as never,
    accountsReceivableService,
  );

  const fullAccess = { canViewFinance: true, canViewSalesOrders: true, canManageCredit: true };
  // Wide enough to cover every real seeded invoice/payment/credit note regardless of
  // when this test happens to run.
  const wholeHistoryPeriod = { from: new Date('2000-01-01'), to: new Date('2100-01-01') };

  let orgA: string;
  let customerWithInvoicesId: string;
  let orgB: string | null = null;

  beforeAll(async () => {
    const bobyBites = await prisma.organisation.findFirst({
      where: { name: 'Boby Bites' },
      select: { id: true },
    });
    if (!bobyBites) throw new Error('This test requires the seeded "Boby Bites" organisation.');
    orgA = bobyBites.id;

    const invoice = await prisma.invoice.findFirst({
      where: { organisationId: orgA },
      select: { customerId: true },
    });
    if (!invoice) {
      throw new Error('This test requires at least one seeded Invoice in "Boby Bites".');
    }
    customerWithInvoicesId = invoice.customerId;

    const otherOrg = await prisma.organisation.findFirst({ where: { id: { not: orgA } } });
    orgB = otherOrg?.id ?? null;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('Customer Statement closing balance reconciles exactly with AccountsReceivableService.getCustomerBalance()', async () => {
    const [statement, authoritativeBalance] = await Promise.all([
      customerStatementReportService.getStatement(orgA, customerWithInvoicesId, wholeHistoryPeriod),
      accountsReceivableService.getCustomerBalance(orgA, customerWithInvoicesId),
    ]);

    expect(statement).not.toBeNull();
    expect(statement!.closingBalance).toBe(authoritativeBalance.totalOutstanding);
    expect(statement!.reconciliation.lineBasedClosingBalance).toBe(
      statement!.reconciliation.authoritativeClosingBalance,
    );
  });

  it('Customer Statement opening balance (asOf 2000-01-01, before any real seed data) is zero', async () => {
    const statement = await customerStatementReportService.getStatement(
      orgA,
      customerWithInvoicesId,
      wholeHistoryPeriod,
    );
    expect(statement!.openingBalance).toBe(0);
  });

  it('Customer Account Overview receivable figure matches the same authoritative AR balance', async () => {
    const [overview, authoritativeBalance] = await Promise.all([
      customerAccountReportService.getOverview(
        orgA,
        customerWithInvoicesId,
        fullAccess,
        wholeHistoryPeriod,
      ),
      accountsReceivableService.getCustomerBalance(orgA, customerWithInvoicesId),
    ]);

    expect(overview).not.toBeNull();
    expect(overview!.summary!.currentOutstandingReceivable).toBe(
      authoritativeBalance.totalOutstanding,
    );
  });

  it('Outstanding invoices list total matches the authoritative outstanding balance', async () => {
    const invoices = await customerAccountReportService.getOutstandingInvoices(
      orgA,
      customerWithInvoicesId,
    );
    const authoritativeBalance = await accountsReceivableService.getCustomerBalance(
      orgA,
      customerWithInvoicesId,
    );

    const sumOutstanding =
      Math.round(invoices.reduce((sum, invoice) => sum + invoice.amountOutstanding, 0) * 100) / 100;
    expect(sumOutstanding).toBe(authoritativeBalance.totalOutstanding);
  });

  it('a cross-tenant customerId never leaks data — getOverview returns null', async () => {
    if (!orgB) {
      console.warn('Skipping cross-tenant assertion — only one organisation is seeded.');
      return;
    }
    const result = await customerAccountReportService.getOverview(
      orgB,
      customerWithInvoicesId, // belongs to orgA, not orgB
      fullAccess,
      wholeHistoryPeriod,
    );
    expect(result).toBeNull();
  });

  it('a cross-tenant customerId never leaks data — getStatement returns null', async () => {
    if (!orgB) {
      console.warn('Skipping cross-tenant assertion — only one organisation is seeded.');
      return;
    }
    const result = await customerStatementReportService.getStatement(
      orgB,
      customerWithInvoicesId,
      wholeHistoryPeriod,
    );
    expect(result).toBeNull();
  });
});
