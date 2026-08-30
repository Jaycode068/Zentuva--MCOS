import { CustomerRepository } from '../retail/customer/customer.repository';
import { AccountsReceivableService } from './accounts-receivable.service';
import { InvoiceRepository } from './invoice.repository';
import { PaymentRepository } from './payment.repository';

describe('AccountsReceivableService', () => {
  function makeService() {
    const invoiceRepository = {
      getArByCustomer: jest.fn(),
      getArSummary: jest.fn(),
      sumInvoicedBetween: jest.fn().mockResolvedValue(0),
      getOutstandingForAging: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<InvoiceRepository>;
    const paymentRepository = {
      sumRecordedBetween: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<PaymentRepository>;
    const customerRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<CustomerRepository>;

    const service = new AccountsReceivableService(
      invoiceRepository,
      paymentRepository,
      customerRepository,
    );
    return { service, invoiceRepository, paymentRepository, customerRepository };
  }

  describe('listByCustomer', () => {
    it('computes invoiced/paid/credited/outstanding per customer, sorted by outstanding desc', async () => {
      const { service, invoiceRepository, customerRepository } = makeService();
      invoiceRepository.getArByCustomer.mockResolvedValue([
        {
          customerId: 'customer-1',
          _sum: { total: 2_500_000, amountPaid: 1_000_000, amountCredited: 0 },
        },
        {
          customerId: 'customer-2',
          _sum: { total: 500_000, amountPaid: 500_000, amountCredited: 0 },
        },
      ] as never);
      customerRepository.findById.mockImplementation((_org, id) =>
        Promise.resolve(
          id === 'customer-1'
            ? ({ customerCode: 'CUS-000013', customerName: 'ABC Supermarket' } as never)
            : ({ customerCode: 'CUS-000012', customerName: 'Mama Nkechi Stores' } as never),
        ),
      );

      const rows = await service.listByCustomer('org-1');

      expect(rows).toEqual([
        expect.objectContaining({
          customerId: 'customer-1',
          totalInvoiced: 2_500_000,
          totalPaid: 1_000_000,
          totalCredited: 0,
          totalOutstanding: 1_500_000,
        }),
        expect.objectContaining({ customerId: 'customer-2', totalOutstanding: 0 }),
      ]);
    });

    it('treats a customer with a fully credited invoice as zero outstanding, never negative', async () => {
      const { service, invoiceRepository, customerRepository } = makeService();
      invoiceRepository.getArByCustomer.mockResolvedValue([
        {
          customerId: 'customer-1',
          _sum: { total: 250_000, amountPaid: 0, amountCredited: 250_000 },
        },
      ] as never);
      customerRepository.findById.mockResolvedValue({
        customerCode: 'CUS-000013',
        customerName: 'ABC Supermarket',
      } as never);

      const rows = await service.listByCustomer('org-1');
      expect(rows[0]!.totalOutstanding).toBe(0);
    });
  });

  describe('getCustomerBalance', () => {
    it('returns zeroed balance for a customer with no invoices', async () => {
      const { service, invoiceRepository, customerRepository } = makeService();
      invoiceRepository.getArByCustomer.mockResolvedValue([]);
      customerRepository.findById.mockResolvedValue({
        customerCode: 'CUS-000099',
        customerName: 'No Invoices Ltd',
      } as never);

      const balance = await service.getCustomerBalance('org-1', 'customer-99');
      expect(balance).toEqual(
        expect.objectContaining({
          totalInvoiced: 0,
          totalPaid: 0,
          totalCredited: 0,
          totalOutstanding: 0,
        }),
      );
    });
  });

  describe('getAgingReport', () => {
    const asOf = new Date('2026-08-29');
    function daysAgo(days: number): Date {
      return new Date(asOf.getTime() - days * 24 * 60 * 60 * 1000);
    }

    it('buckets an invoice not yet due as Current', async () => {
      const { service, invoiceRepository } = makeService();
      invoiceRepository.getOutstandingForAging.mockResolvedValue([
        {
          id: 'inv-1',
          invoiceCode: 'INV-0001',
          customerId: 'customer-1',
          customerCode: 'CUS-0001',
          customerName: 'ABC Supermarket',
          dueDate: daysAgo(-5),
          amountOutstanding: 100_000,
        },
      ] as never);

      const report = await service.getAgingReport('org-1', asOf);

      expect(report.current).toBe(100_000);
      expect(report.days1To30).toBe(0);
      expect(report.totalOutstanding).toBe(100_000);
      expect(report.byCustomer[0]).toEqual(
        expect.objectContaining({
          customerId: 'customer-1',
          current: 100_000,
          totalOutstanding: 100_000,
        }),
      );
    });

    it.each([
      [15, 'days1To30'],
      [45, 'days31To60'],
      [75, 'days61To90'],
      [120, 'days90Plus'],
    ] as const)('buckets an invoice %d days past due into %s', async (daysPastDue, bucket) => {
      const { service, invoiceRepository } = makeService();
      invoiceRepository.getOutstandingForAging.mockResolvedValue([
        {
          id: 'inv-1',
          invoiceCode: 'INV-0001',
          customerId: 'customer-1',
          customerCode: 'CUS-0001',
          customerName: 'ABC Supermarket',
          dueDate: daysAgo(daysPastDue),
          amountOutstanding: 100_000,
        },
      ] as never);

      const report = await service.getAgingReport('org-1', asOf);

      expect(report[bucket]).toBe(100_000);
      expect(report.totalOutstanding).toBe(100_000);
    });

    it('aggregates multiple invoices for the same customer across buckets', async () => {
      const { service, invoiceRepository } = makeService();
      invoiceRepository.getOutstandingForAging.mockResolvedValue([
        {
          id: 'inv-1',
          invoiceCode: 'INV-0001',
          customerId: 'customer-1',
          customerCode: 'CUS-0001',
          customerName: 'ABC Supermarket',
          dueDate: daysAgo(-5),
          amountOutstanding: 100_000,
        },
        {
          id: 'inv-2',
          invoiceCode: 'INV-0002',
          customerId: 'customer-1',
          customerCode: 'CUS-0001',
          customerName: 'ABC Supermarket',
          dueDate: daysAgo(45),
          amountOutstanding: 50_000,
        },
      ] as never);

      const report = await service.getAgingReport('org-1', asOf);

      expect(report.byCustomer).toHaveLength(1);
      expect(report.byCustomer[0]).toEqual(
        expect.objectContaining({
          current: 100_000,
          days31To60: 50_000,
          totalOutstanding: 150_000,
        }),
      );
      expect(report.totalOutstanding).toBe(150_000);
    });

    it('returns an all-zero report when nothing is outstanding', async () => {
      const { service, invoiceRepository } = makeService();
      invoiceRepository.getOutstandingForAging.mockResolvedValue([]);

      const report = await service.getAgingReport('org-1', asOf);

      expect(report.totalOutstanding).toBe(0);
      expect(report.byCustomer).toEqual([]);
    });
  });

  describe('tenant isolation', () => {
    it('every aggregate query is scoped by organisationId', async () => {
      const { service, invoiceRepository, paymentRepository } = makeService();
      invoiceRepository.getArByCustomer.mockResolvedValue([]);
      invoiceRepository.getArSummary.mockResolvedValue({
        totals: { _sum: { total: 0, amountPaid: 0, amountCredited: 0 } },
        overdue: { _sum: { total: 0, amountPaid: 0, amountCredited: 0 } },
      } as never);

      await service.getSummary('org-1');

      expect(invoiceRepository.getArSummary).toHaveBeenCalledWith('org-1');
      expect(invoiceRepository.sumInvoicedBetween).toHaveBeenCalledWith(
        'org-1',
        expect.any(Date),
        expect.any(Date),
      );
      expect(paymentRepository.sumRecordedBetween).toHaveBeenCalledWith(
        'org-1',
        expect.any(Date),
        expect.any(Date),
      );
    });
  });
});
