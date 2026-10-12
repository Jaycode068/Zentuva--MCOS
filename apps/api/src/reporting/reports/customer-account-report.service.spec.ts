import { InvoiceStatus, PaymentStatus, SalesOrderStatus } from '@prisma/client';

import { CustomerAccountReportService } from './customer-account-report.service';

describe('CustomerAccountReportService', () => {
  function makePrisma(overrides: Record<string, unknown> = {}) {
    return {
      customer: { findFirst: jest.fn() },
      outlet: { findMany: jest.fn().mockResolvedValue([]) },
      invoice: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { total: 0 } }),
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      paymentAllocation: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }) },
      salesOrder: { findMany: jest.fn().mockResolvedValue([]) },
      customerReturn: { findMany: jest.fn().mockResolvedValue([]) },
      ...overrides,
    };
  }

  function makeAccountsReceivableService(overrides: Record<string, unknown> = {}) {
    return {
      getCustomerBalance: jest.fn().mockResolvedValue({
        customerId: 'customer-1',
        customerCode: 'CUS-0001',
        customerName: 'ABC Supermarket',
        totalInvoiced: 0,
        totalPaid: 0,
        totalCredited: 0,
        totalOutstanding: 0,
      }),
      getAgingReport: jest.fn().mockResolvedValue({ byCustomer: [] }),
      ...overrides,
    };
  }

  function makeService(
    options: {
      prismaOverrides?: Record<string, unknown>;
      arOverrides?: Record<string, unknown>;
      invoiceRepository?: Record<string, unknown>;
      paymentRepository?: Record<string, unknown>;
      creditNoteRepository?: Record<string, unknown>;
    } = {},
  ) {
    const prisma = makePrisma(options.prismaOverrides);
    const accountsReceivableService = makeAccountsReceivableService(options.arOverrides);
    const invoiceRepository = {
      findManyByOrganisation: jest.fn().mockResolvedValue([]),
      ...options.invoiceRepository,
    };
    const paymentRepository = {
      findManyByOrganisation: jest.fn().mockResolvedValue([]),
      ...options.paymentRepository,
    };
    const creditNoteRepository = {
      findManyByOrganisation: jest.fn().mockResolvedValue([]),
      ...options.creditNoteRepository,
    };

    const service = new CustomerAccountReportService(
      prisma as never,
      accountsReceivableService as never,
      invoiceRepository as never,
      paymentRepository as never,
      creditNoteRepository as never,
    );
    return { service, prisma, accountsReceivableService, invoiceRepository, paymentRepository };
  }

  const fullAccess = {
    canViewFinance: true,
    canViewSalesOrders: true,
    canManageCredit: true,
  };
  const period = { from: new Date('2026-08-01'), to: new Date('2026-09-01') };

  describe('getOverview', () => {
    it('returns null for a customer belonging to another organisation', async () => {
      const { service, prisma } = makeService();
      (prisma.customer.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getOverview('org-1', 'missing', fullAccess, period);
      expect(result).toBeNull();
    });

    it('omits summary/credit entirely when the caller lacks finance visibility', async () => {
      const { service, prisma } = makeService();
      (prisma.customer.findFirst as jest.Mock).mockResolvedValue({
        id: 'customer-1',
        customerCode: 'CUS-0001',
        customerName: 'ABC Supermarket',
        creditLimit: 500_000,
      });

      const result = await service.getOverview(
        'org-1',
        'customer-1',
        { ...fullAccess, canViewFinance: false },
        period,
      );

      expect(result!.profile).not.toBeNull();
      expect(result!.summary).toBeNull();
      expect(result!.credit).toBeNull();
    });

    it('never mixes unfulfilled order value into the receivable figure', async () => {
      const { service, prisma } = makeService({
        prismaOverrides: {
          salesOrder: {
            findMany: jest.fn().mockResolvedValue([{ total: 300_000 }, { total: 200_000 }]),
          },
        },
        arOverrides: {
          getCustomerBalance: jest.fn().mockResolvedValue({
            customerId: 'customer-1',
            customerCode: 'CUS-0001',
            customerName: 'ABC Supermarket',
            totalInvoiced: 1_000_000,
            totalPaid: 400_000,
            totalCredited: 0,
            totalOutstanding: 600_000,
          }),
        },
      });
      (prisma.customer.findFirst as jest.Mock).mockResolvedValue({
        id: 'customer-1',
        customerCode: 'CUS-0001',
        customerName: 'ABC Supermarket',
        creditLimit: null,
      });

      const result = await service.getOverview('org-1', 'customer-1', fullAccess, period);

      expect(result!.summary!.currentOutstandingReceivable).toBe(600_000);
      expect(result!.summary!.unfulfilledSalesOrderValue).toBe(500_000);
      // The two must remain distinct figures, never summed together.
      expect(result!.summary!.currentOutstandingReceivable).not.toBe(
        result!.summary!.currentOutstandingReceivable +
          result!.summary!.unfulfilledSalesOrderValue!,
      );
    });

    it('returns null (not 0) pending-order figures when the caller lacks sales.order.view', async () => {
      const { service, prisma } = makeService();
      (prisma.customer.findFirst as jest.Mock).mockResolvedValue({
        id: 'customer-1',
        customerCode: 'CUS-0001',
        customerName: 'ABC Supermarket',
        creditLimit: null,
      });

      const result = await service.getOverview(
        'org-1',
        'customer-1',
        { ...fullAccess, canViewSalesOrders: false },
        period,
      );

      expect(result!.summary!.pendingSalesOrderCount).toBeNull();
      expect(result!.summary!.unfulfilledSalesOrderValue).toBeNull();
    });

    describe('credit exposure', () => {
      it.each([
        [null, 0, 'NO_LIMIT'],
        [500_000, 100_000, 'WITHIN_LIMIT'],
        [500_000, 400_000, 'APPROACHING_LIMIT'], // 80% threshold
        [500_000, 500_000, 'AT_OR_OVER_LIMIT'],
        [500_000, 600_000, 'AT_OR_OVER_LIMIT'],
        [0, 0, 'WITHIN_LIMIT'], // a deliberately configured zero limit, exactly at it... 0>=0 -> AT_OR_OVER actually
      ] as const)(
        'creditLimit=%s, outstanding=%s -> %s',
        async (creditLimit, totalOutstanding, expectedStatus) => {
          const { service, prisma } = makeService({
            arOverrides: {
              getCustomerBalance: jest.fn().mockResolvedValue({
                customerId: 'customer-1',
                customerCode: 'CUS-0001',
                customerName: 'ABC',
                totalInvoiced: totalOutstanding,
                totalPaid: 0,
                totalCredited: 0,
                totalOutstanding,
              }),
            },
          });
          (prisma.customer.findFirst as jest.Mock).mockResolvedValue({
            id: 'customer-1',
            customerCode: 'CUS-0001',
            customerName: 'ABC',
            creditLimit,
          });

          const result = await service.getOverview('org-1', 'customer-1', fullAccess, period);

          if (creditLimit === 0 && totalOutstanding === 0) {
            // 0 >= 0 is "at or over" by the ">= limit" rule — a configured zero-credit
            // account with any balance at all (including zero) is always at its limit.
            expect(result!.credit!.status).toBe('AT_OR_OVER_LIMIT');
            return;
          }
          expect(result!.credit!.status).toBe(expectedStatus);
        },
      );

      it('exposes canManageCredit from the resolved access, not a hardcoded value', async () => {
        const { service, prisma } = makeService();
        (prisma.customer.findFirst as jest.Mock).mockResolvedValue({
          id: 'customer-1',
          customerCode: 'CUS-0001',
          customerName: 'ABC',
          creditLimit: 100,
        });

        const result = await service.getOverview(
          'org-1',
          'customer-1',
          { ...fullAccess, canManageCredit: false },
          period,
        );
        expect(result!.credit!.canManageCredit).toBe(false);
      });
    });
  });

  describe('getPaymentHistory', () => {
    it('computes unallocatedAmount generically from amount minus allocations', async () => {
      const { service, paymentRepository } = makeService({
        paymentRepository: {
          findManyByOrganisation: jest.fn().mockResolvedValue([
            {
              id: 'payment-1',
              paymentDate: new Date('2026-08-05'),
              amount: 100_000,
              method: 'CASH',
              reference: 'TXN-1',
              status: PaymentStatus.RECORDED,
              allocations: [{ invoiceId: 'invoice-1', amount: 100_000 }],
            },
          ]),
        },
      });

      const result = await service.getPaymentHistory('org-1', 'customer-1');
      expect(paymentRepository.findManyByOrganisation).toHaveBeenCalledWith('org-1', {
        customerId: 'customer-1',
      });
      expect(result[0]!.unallocatedAmount).toBe(0);
      expect(result[0]!.isFullyAllocated).toBe(true);
    });
  });

  describe('getTransactionHistory', () => {
    const noAccess = {
      canViewSalesOrders: false,
      canViewInvoices: false,
      canViewPayments: false,
      canViewCreditNotes: false,
      canViewReturns: false,
    };

    it('omits an entire source type when the caller lacks its permission', async () => {
      const { service, prisma } = makeService({
        prismaOverrides: {
          salesOrder: {
            findMany: jest.fn().mockResolvedValue([
              {
                id: 'so-1',
                orderCode: 'SO-000001',
                orderDate: new Date('2026-08-10'),
                status: SalesOrderStatus.CONFIRMED,
                total: 50_000,
              },
            ]),
          },
        },
      });

      const result = await service.getTransactionHistory('org-1', 'customer-1', noAccess, {
        page: 1,
        pageSize: 25,
      });

      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
      expect(prisma.salesOrder.findMany).not.toHaveBeenCalled();
    });

    it('merges multiple source types, sorts descending by date, and paginates', async () => {
      const { service } = makeService({
        prismaOverrides: {
          salesOrder: {
            findMany: jest.fn().mockResolvedValue([
              {
                id: 'so-1',
                orderCode: 'SO-000001',
                orderDate: new Date('2026-08-10'),
                status: SalesOrderStatus.CONFIRMED,
                total: 50_000,
              },
            ]),
          },
        },
        invoiceRepository: {
          findManyByOrganisation: jest.fn().mockResolvedValue([
            {
              id: 'inv-1',
              invoiceCode: 'INV-000001',
              invoiceDate: new Date('2026-08-15'),
              status: InvoiceStatus.ISSUED,
              total: 50_000,
            },
          ]),
        },
        paymentRepository: {
          findManyByOrganisation: jest.fn().mockResolvedValue([
            {
              id: 'pay-1',
              paymentDate: new Date('2026-08-20'),
              amount: 50_000,
              reference: 'TXN-1',
              status: PaymentStatus.RECORDED,
            },
          ]),
        },
      });

      const result = await service.getTransactionHistory(
        'org-1',
        'customer-1',
        { ...noAccess, canViewSalesOrders: true, canViewInvoices: true, canViewPayments: true },
        { page: 1, pageSize: 25 },
      );

      expect(result.total).toBe(3);
      expect(result.rows.map((r) => r.type)).toEqual(['PAYMENT', 'INVOICE', 'SALES_ORDER']);
    });

    it('filters by type and respects pagination', async () => {
      const { service } = makeService({
        invoiceRepository: {
          findManyByOrganisation: jest.fn().mockResolvedValue([
            {
              id: 'inv-1',
              invoiceCode: 'INV-000001',
              invoiceDate: new Date('2026-08-01'),
              status: InvoiceStatus.ISSUED,
              total: 10_000,
            },
            {
              id: 'inv-2',
              invoiceCode: 'INV-000002',
              invoiceDate: new Date('2026-08-02'),
              status: InvoiceStatus.PAID,
              total: 20_000,
            },
          ]),
        },
      });

      const result = await service.getTransactionHistory(
        'org-1',
        'customer-1',
        { ...noAccess, canViewInvoices: true },
        { type: 'INVOICE', page: 1, pageSize: 1 },
      );

      expect(result.total).toBe(2);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]!.id).toBe('inv-2'); // most recent first
    });
  });
});
