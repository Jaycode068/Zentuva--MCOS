import { CustomerStatementReportService } from './customer-statement-report.service';

describe('CustomerStatementReportService', () => {
  function makeService(
    options: {
      customer?: Record<string, unknown> | null;
      openingBalance?: number;
      closingBalance?: number;
      invoices?: Record<string, unknown>[];
      paymentAllocations?: Record<string, unknown>[];
      creditNotes?: Record<string, unknown>[];
    } = {},
  ) {
    const prisma = {
      customer: {
        findFirst: jest
          .fn()
          .mockResolvedValue(
            options.customer !== undefined
              ? options.customer
              : { customerCode: 'CUS-0001', customerName: 'ABC Supermarket' },
          ),
      },
      invoice: { findMany: jest.fn().mockResolvedValue(options.invoices ?? []) },
      paymentAllocation: {
        findMany: jest.fn().mockResolvedValue(options.paymentAllocations ?? []),
      },
      creditNote: { findMany: jest.fn().mockResolvedValue(options.creditNotes ?? []) },
    };

    const getCustomerBalanceAsOf = jest
      .fn()
      .mockResolvedValueOnce({ totalOutstanding: options.openingBalance ?? 0 })
      .mockResolvedValueOnce({ totalOutstanding: options.closingBalance ?? 0 });
    const accountsReceivableService = { getCustomerBalanceAsOf };

    const service = new CustomerStatementReportService(
      prisma as never,
      accountsReceivableService as never,
    );
    return { service, prisma, getCustomerBalanceAsOf };
  }

  const period = { from: new Date('2026-08-01'), to: new Date('2026-09-01') };

  it('returns null for a customer belonging to another organisation', async () => {
    const { service } = makeService({ customer: null });
    const result = await service.getStatement('org-1', 'missing', period);
    expect(result).toBeNull();
  });

  it('uses getCustomerBalanceAsOf for BOTH the opening (at `from`) and closing (at `to`) balance', async () => {
    const { service, getCustomerBalanceAsOf } = makeService({
      openingBalance: 100_000,
      closingBalance: 100_000,
    });

    const statement = await service.getStatement('org-1', 'customer-1', period);

    expect(getCustomerBalanceAsOf).toHaveBeenNthCalledWith(1, 'org-1', 'customer-1', period.from);
    expect(getCustomerBalanceAsOf).toHaveBeenNthCalledWith(2, 'org-1', 'customer-1', period.to);
    expect(statement!.openingBalance).toBe(100_000);
    expect(statement!.closingBalance).toBe(100_000);
  });

  it('running balance walks opening -> +invoice -> -payment -> -credit note, reconciling to the authoritative closing balance', async () => {
    const { service } = makeService({
      openingBalance: 50_000,
      closingBalance: 70_000, // 50,000 + 100,000 (invoice) - 60,000 (payment) - 20,000 (credit note)
      invoices: [
        {
          id: 'inv-1',
          invoiceCode: 'INV-000001',
          invoiceDate: new Date('2026-08-05'),
          dueDate: new Date('2026-09-05'),
          total: 100_000,
        },
      ],
      paymentAllocations: [
        {
          id: 'alloc-1',
          amount: 60_000,
          invoice: { invoiceCode: 'INV-000001' },
          payment: { id: 'pay-1', paymentDate: new Date('2026-08-10'), reference: 'TXN-1' },
        },
      ],
      creditNotes: [
        {
          id: 'cn-1',
          creditNoteCode: 'CN-000001',
          creditNoteDate: new Date('2026-08-15'),
          amount: 20_000,
        },
      ],
    });

    const statement = await service.getStatement('org-1', 'customer-1', period);

    expect(statement!.lines.map((l) => l.type)).toEqual(['INVOICE', 'PAYMENT', 'CREDIT_NOTE']);
    expect(statement!.lines[0]!.runningBalance).toBe(150_000); // 50,000 + 100,000
    expect(statement!.lines[1]!.runningBalance).toBe(90_000); // -60,000
    expect(statement!.lines[2]!.runningBalance).toBe(70_000); // -20,000
    expect(statement!.closingBalance).toBe(70_000);
    // The line-walk and the authoritative AR calculation must agree — this IS the
    // statement's own correctness test (brief §4 accounting requirement 6).
    expect(statement!.reconciliation.lineBasedClosingBalance).toBe(
      statement!.reconciliation.authoritativeClosingBalance,
    );
  });

  it('never creates a journal entry or mutates anything — a pure read', async () => {
    const { service, prisma } = makeService();
    await service.getStatement('org-1', 'customer-1', period);
    // No write method exists on any mocked model — asserting this here documents the
    // invariant explicitly, even though a missing `.create`/`.update` would also just
    // throw if accidentally called.
    expect(Object.keys(prisma.invoice)).toEqual(['findMany']);
    expect(Object.keys(prisma.paymentAllocation)).toEqual(['findMany']);
    expect(Object.keys(prisma.creditNote)).toEqual(['findMany']);
  });

  it('sorts same-day lines by type (invoice, then payment, then credit note)', async () => {
    const sameDay = new Date('2026-08-10');
    const { service } = makeService({
      invoices: [
        { id: 'inv-1', invoiceCode: 'INV-1', invoiceDate: sameDay, dueDate: sameDay, total: 10 },
      ],
      paymentAllocations: [
        {
          id: 'alloc-1',
          amount: 5,
          invoice: { invoiceCode: 'INV-1' },
          payment: { id: 'pay-1', paymentDate: sameDay, reference: null },
        },
      ],
      creditNotes: [{ id: 'cn-1', creditNoteCode: 'CN-1', creditNoteDate: sameDay, amount: 2 }],
    });

    const statement = await service.getStatement('org-1', 'customer-1', period);
    expect(statement!.lines.map((l) => l.type)).toEqual(['INVOICE', 'PAYMENT', 'CREDIT_NOTE']);
  });
});
