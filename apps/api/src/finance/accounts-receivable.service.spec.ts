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
