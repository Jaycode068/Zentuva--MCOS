import { LedgerService } from './accounting/ledger.service';
import { AccountsPayableService } from './accounts-payable.service';
import { SupplierInvoiceRepository } from './supplier-invoice.repository';
import { SupplierPaymentRepository } from './supplier-payment.repository';
import { SupplierRepository } from '../suppliers/supplier/supplier.repository';

describe('AccountsPayableService', () => {
  function makeService() {
    const supplierInvoiceRepository = {
      getApBySupplier: jest.fn().mockResolvedValue([]),
      getApSummary: jest.fn(),
      sumInvoicedBetween: jest.fn().mockResolvedValue(0),
      getOutstandingForAging: jest.fn().mockResolvedValue([]),
      countDiscrepancies: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<SupplierInvoiceRepository>;
    const supplierPaymentRepository = {
      sumRecordedBetween: jest.fn().mockResolvedValue(0),
      countBySupplier: jest.fn(),
    } as unknown as jest.Mocked<SupplierPaymentRepository>;
    const supplierRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<SupplierRepository>;
    const ledgerService = {
      getSystemAccountBalance: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<LedgerService>;

    const service = new AccountsPayableService(
      supplierInvoiceRepository,
      supplierPaymentRepository,
      supplierRepository,
      ledgerService,
    );
    return {
      service,
      supplierInvoiceRepository,
      supplierPaymentRepository,
      supplierRepository,
      ledgerService,
    };
  }

  describe('getAgingReport', () => {
    const asOf = new Date('2026-08-29');
    function daysAgo(days: number): Date {
      return new Date(asOf.getTime() - days * 24 * 60 * 60 * 1000);
    }

    it('buckets a supplier invoice not yet due as Current', async () => {
      const { service, supplierInvoiceRepository } = makeService();
      supplierInvoiceRepository.getOutstandingForAging.mockResolvedValue([
        {
          id: 'sinv-1',
          invoiceNumber: 'INV-0001',
          supplierId: 'supplier-1',
          supplierCode: 'SUP-0001',
          supplierName: 'PackRight Nigeria',
          dueDate: daysAgo(-5),
          amountOutstanding: 150_000,
        },
      ] as never);

      const report = await service.getAgingReport('org-1', asOf);

      expect(report.current).toBe(150_000);
      expect(report.totalOutstanding).toBe(150_000);
      expect(report.bySupplier[0]).toEqual(
        expect.objectContaining({ supplierId: 'supplier-1', current: 150_000 }),
      );
    });

    it.each([
      [15, 'days1To30'],
      [45, 'days31To60'],
      [75, 'days61To90'],
      [120, 'days90Plus'],
    ] as const)(
      'buckets a supplier invoice %d days past due into %s',
      async (daysPastDue, bucket) => {
        const { service, supplierInvoiceRepository } = makeService();
        supplierInvoiceRepository.getOutstandingForAging.mockResolvedValue([
          {
            id: 'sinv-1',
            invoiceNumber: 'INV-0001',
            supplierId: 'supplier-1',
            supplierCode: 'SUP-0001',
            supplierName: 'PackRight Nigeria',
            dueDate: daysAgo(daysPastDue),
            amountOutstanding: 150_000,
          },
        ] as never);

        const report = await service.getAgingReport('org-1', asOf);

        expect(report[bucket]).toBe(150_000);
      },
    );

    it('surfaces the GRNI Pending Approval balance and discrepancy invoice count', async () => {
      const { service, ledgerService, supplierInvoiceRepository } = makeService();
      ledgerService.getSystemAccountBalance.mockResolvedValue(75_000);
      supplierInvoiceRepository.countDiscrepancies.mockResolvedValue(2);

      const report = await service.getAgingReport('org-1', asOf);

      expect(report.grniPendingApprovalBalance).toBe(75_000);
      expect(report.discrepancyInvoiceCount).toBe(2);
      expect(ledgerService.getSystemAccountBalance).toHaveBeenCalledWith(
        'org-1',
        'GRNI_PENDING_APPROVAL',
      );
    });

    it('returns an all-zero report when nothing is outstanding', async () => {
      const { service } = makeService();

      const report = await service.getAgingReport('org-1', asOf);

      expect(report.totalOutstanding).toBe(0);
      expect(report.bySupplier).toEqual([]);
    });
  });
});
