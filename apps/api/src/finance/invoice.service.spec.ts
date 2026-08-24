import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvoiceStatus, SalesOrderStatus } from '@prisma/client';

import { OrganisationService } from '../identity/organisation/organisation.service';
import { SalesOrderRepository, SalesOrderWithRelations } from '../sales/sales-order.repository';
import { MissingSystemAccountError, NoOpenPeriodError } from './accounting/journal-posting';
import { InvoiceRepository, InvoiceWithRelations } from './invoice.repository';
import { InvoiceService } from './invoice.service';

describe('InvoiceService', () => {
  const fulfilledOrder: SalesOrderWithRelations = {
    id: 'order-1',
    organisationId: 'org-1',
    orderCode: 'SO-000012',
    customerId: 'customer-1',
    outletId: 'outlet-1',
    salesAgentId: 'user-1',
    status: SalesOrderStatus.FULFILLED,
    orderDate: new Date('2026-08-20'),
    notes: null,
    subtotal: 2_500_000,
    discount: 0,
    total: 2_500_000,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-20'),
    updatedAt: new Date('2026-08-20'),
    customer: { id: 'customer-1', customerCode: 'CUS-000013', customerName: 'ABC Supermarket' },
    outlet: { id: 'outlet-1', outletCode: 'OUT-000010', name: 'ABC Supermarket — Main' },
    items: [
      {
        id: 'order-item-1',
        productId: 'product-1',
        quantity: 500,
        quantityFulfilled: 500,
        unitPrice: 5000,
        lineTotal: 2_500_000,
        product: {
          id: 'product-1',
          code: 'PRD-000027',
          name: 'Plantain Chips Classic Salted 500g',
          unit: 'Pack',
        },
      },
    ],
  } as unknown as SalesOrderWithRelations;

  const invoice: InvoiceWithRelations = {
    id: 'invoice-1',
    organisationId: 'org-1',
    invoiceCode: 'INV-000001',
    customerId: 'customer-1',
    outletId: 'outlet-1',
    salesOrderId: 'order-1',
    invoiceDate: new Date('2026-08-23'),
    dueDate: new Date('2026-08-23'),
    paymentTerms: 'DUE_ON_RECEIPT',
    status: InvoiceStatus.DRAFT,
    currency: 'NGN',
    subtotal: 2_500_000,
    discount: 0,
    taxAmount: 0,
    total: 2_500_000,
    amountPaid: 0,
    amountCredited: 0,
    notes: null,
    idempotencyKey: null,
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-08-23'),
    updatedAt: new Date('2026-08-23'),
    customer: { id: 'customer-1', customerCode: 'CUS-000013', customerName: 'ABC Supermarket' },
    outlet: { id: 'outlet-1', outletCode: 'OUT-000010', name: 'ABC Supermarket — Main' },
    salesOrder: { id: 'order-1', orderCode: 'SO-000012' },
    items: [
      {
        id: 'invoice-item-1',
        productId: 'product-1',
        productCode: 'PRD-000027',
        productName: 'Plantain Chips Classic Salted 500g',
        description: null,
        quantity: 500,
        unitPrice: 5000,
        discount: 0,
        taxRate: 0,
        taxAmount: 0,
        lineTotal: 2_500_000,
      },
    ],
  } as unknown as InvoiceWithRelations;

  function makeService() {
    const invoiceRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
      findManyBySalesOrderExcludingVoid: jest.fn().mockResolvedValue([]),
      existsByCode: jest.fn().mockResolvedValue(false),
      updateStatus: jest.fn(),
      issue: jest.fn(),
    } as unknown as jest.Mocked<InvoiceRepository>;
    const salesOrderRepository = {
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
    } as unknown as jest.Mocked<SalesOrderRepository>;
    const organisationService = {
      getById: jest.fn().mockResolvedValue({ currency: 'NGN' }),
    } as unknown as jest.Mocked<OrganisationService>;
    const config = {
      get: jest.fn().mockReturnValue(7.5),
    } as unknown as jest.Mocked<ConfigService>;

    const service = new InvoiceService(
      invoiceRepository,
      salesOrderRepository,
      organisationService,
      config,
    );
    return { service, invoiceRepository, salesOrderRepository, organisationService, config };
  }

  describe('create', () => {
    it('creates from a fulfilled order, snapshotting items and computing totals server-side', async () => {
      const { service, salesOrderRepository, invoiceRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue(fulfilledOrder);
      invoiceRepository.create.mockResolvedValue(invoice);

      const result = await service.create(
        'org-1',
        {
          salesOrderId: 'order-1',
          invoiceDate: new Date('2026-08-23'),
          paymentTerms: 'DUE_ON_RECEIPT',
          items: [{ salesOrderItemId: 'order-item-1', taxRate: 0 }],
        },
        'user-1',
      );

      expect(invoiceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceCode: 'INV-000001',
          subtotal: 2_500_000,
          discount: 0,
          taxAmount: 0,
          total: 2_500_000,
          currency: 'NGN',
        }),
      );
      expect(result.invoiceCode).toBe('INV-000001');
    });

    it('applies the configured default tax rate when a line omits taxRate', async () => {
      const { service, salesOrderRepository, invoiceRepository, config } = makeService();
      salesOrderRepository.findById.mockResolvedValue(fulfilledOrder);
      invoiceRepository.create.mockResolvedValue(invoice);
      config.get.mockReturnValue(7.5);

      await service.create(
        'org-1',
        {
          salesOrderId: 'order-1',
          invoiceDate: new Date('2026-08-23'),
          paymentTerms: 'DUE_ON_RECEIPT',
          items: [{ salesOrderItemId: 'order-item-1' }],
        },
        'user-1',
      );

      expect(invoiceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ taxAmount: 187_500 }), // 7.5% of 2,500,000
      );
    });

    it.each([['DRAFT'], ['CONFIRMED'], ['PARTIALLY_FULFILLED'], ['CANCELLED']] as const)(
      'rejects invoicing a %s order',
      async (status) => {
        const { service, salesOrderRepository } = makeService();
        salesOrderRepository.findById.mockResolvedValue({ ...fulfilledOrder, status });

        await expect(
          service.create(
            'org-1',
            {
              salesOrderId: 'order-1',
              invoiceDate: new Date(),
              paymentTerms: 'NET_30',
              items: [{ salesOrderItemId: 'order-item-1' }],
            },
            'user-1',
          ),
        ).rejects.toThrow('Sales order must be fulfilled before it can be invoiced');
      },
    );

    it('rejects a second invoice for an already-invoiced order', async () => {
      const { service, salesOrderRepository, invoiceRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue(fulfilledOrder);
      invoiceRepository.findManyBySalesOrderExcludingVoid.mockResolvedValue([invoice]);

      await expect(
        service.create(
          'org-1',
          {
            salesOrderId: 'order-1',
            invoiceDate: new Date(),
            paymentTerms: 'NET_30',
            items: [{ salesOrderItemId: 'order-item-1' }],
          },
          'user-1',
        ),
      ).rejects.toThrow('already been invoiced');
    });

    it('rejects an item that does not belong to this order', async () => {
      const { service, salesOrderRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue(fulfilledOrder);

      await expect(
        service.create(
          'org-1',
          {
            salesOrderId: 'order-1',
            invoiceDate: new Date(),
            paymentTerms: 'NET_30',
            items: [{ salesOrderItemId: 'not-a-real-item' }],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for an unknown/cross-tenant order', async () => {
      const { service, salesOrderRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          'org-1',
          {
            salesOrderId: 'unknown',
            invoiceDate: new Date(),
            paymentTerms: 'NET_30',
            items: [{ salesOrderItemId: 'order-item-1' }],
          },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it.each([
      ['CASH', 0],
      ['DUE_ON_RECEIPT', 0],
      ['NET_7', 7],
      ['NET_14', 14],
      ['NET_30', 30],
    ] as const)('computes dueDate correctly for %s', async (paymentTerms, days) => {
      const { service, salesOrderRepository, invoiceRepository } = makeService();
      salesOrderRepository.findById.mockResolvedValue(fulfilledOrder);
      invoiceRepository.create.mockResolvedValue(invoice);
      const invoiceDate = new Date('2026-08-23T00:00:00.000Z');

      await service.create(
        'org-1',
        {
          salesOrderId: 'order-1',
          invoiceDate,
          paymentTerms,
          items: [{ salesOrderItemId: 'order-item-1' }],
        },
        'user-1',
      );

      const expectedDueDate = new Date(invoiceDate);
      expectedDueDate.setDate(expectedDueDate.getDate() + days);
      expect(invoiceRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ dueDate: expectedDueDate }),
      );
    });
  });

  describe('issue', () => {
    it('transitions DRAFT to ISSUED', async () => {
      const { service, invoiceRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue(invoice);
      invoiceRepository.issue.mockResolvedValue({
        ...invoice,
        status: InvoiceStatus.ISSUED,
      });

      const result = await service.issue('org-1', 'invoice-1', 'user-1');
      expect(result.status).toBe(InvoiceStatus.ISSUED);
      expect(invoiceRepository.issue).toHaveBeenCalledWith('org-1', 'invoice-1', 'user-1');
    });

    it('rejects issuing a non-draft invoice', async () => {
      const { service, invoiceRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue({ ...invoice, status: InvoiceStatus.ISSUED });

      await expect(service.issue('org-1', 'invoice-1', 'user-1')).rejects.toThrow(
        'Only a draft invoice can be issued',
      );
    });

    it('translates a NoOpenPeriodError from the atomic issue+post transaction into a BadRequestException — no invoice is left half-issued with no accounting behind it', async () => {
      const { service, invoiceRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue(invoice);
      invoiceRepository.issue.mockRejectedValue(
        new NoOpenPeriodError('No open accounting period covers 2026-08-23'),
      );

      await expect(service.issue('org-1', 'invoice-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('translates a MissingSystemAccountError into a BadRequestException', async () => {
      const { service, invoiceRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue(invoice);
      invoiceRepository.issue.mockRejectedValue(
        new MissingSystemAccountError('No "SALES_REVENUE" system account is configured'),
      );

      await expect(service.issue('org-1', 'invoice-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('void', () => {
    it('voids a DRAFT invoice freely', async () => {
      const { service, invoiceRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue(invoice);
      invoiceRepository.updateStatus.mockResolvedValue({ ...invoice, status: InvoiceStatus.VOID });

      const result = await service.void('org-1', 'invoice-1', {}, 'user-1');
      expect(result.status).toBe(InvoiceStatus.VOID);
    });

    it('voids an ISSUED invoice with nothing paid/credited yet', async () => {
      const { service, invoiceRepository } = makeService();
      const issued = { ...invoice, status: InvoiceStatus.ISSUED, amountPaid: 0, amountCredited: 0 };
      invoiceRepository.findById.mockResolvedValue(issued);
      invoiceRepository.updateStatus.mockResolvedValue({ ...issued, status: InvoiceStatus.VOID });

      const result = await service.void('org-1', 'invoice-1', {}, 'user-1');
      expect(result.status).toBe(InvoiceStatus.VOID);
    });

    it('rejects voiding an ISSUED invoice once a payment has been applied', async () => {
      const { service, invoiceRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue({
        ...invoice,
        status: InvoiceStatus.PARTIALLY_PAID,
        amountPaid: 1_000_000,
      });

      await expect(service.void('org-1', 'invoice-1', {}, 'user-1')).rejects.toThrow(
        'issue a credit note instead',
      );
    });

    it('rejects voiding an already-PAID invoice', async () => {
      const { service, invoiceRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue({ ...invoice, status: InvoiceStatus.PAID });

      await expect(service.void('org-1', 'invoice-1', {}, 'user-1')).rejects.toThrow(
        'A fully paid invoice cannot be voided',
      );
    });

    it('rejects voiding an already-VOID invoice', async () => {
      const { service, invoiceRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue({ ...invoice, status: InvoiceStatus.VOID });

      await expect(service.void('org-1', 'invoice-1', {}, 'user-1')).rejects.toThrow(
        'already been voided',
      );
    });
  });

  describe('listEligibleSalesOrders', () => {
    it('excludes orders that already have a non-void invoice', async () => {
      const { service, salesOrderRepository, invoiceRepository } = makeService();
      salesOrderRepository.findManyByOrganisation.mockResolvedValue([fulfilledOrder]);
      invoiceRepository.findManyBySalesOrderExcludingVoid.mockResolvedValue([invoice]);

      const result = await service.listEligibleSalesOrders('org-1');
      expect(result).toEqual([]);
    });

    it('includes fulfilled orders with no existing invoice', async () => {
      const { service, salesOrderRepository, invoiceRepository } = makeService();
      salesOrderRepository.findManyByOrganisation.mockResolvedValue([fulfilledOrder]);
      invoiceRepository.findManyBySalesOrderExcludingVoid.mockResolvedValue([]);

      const result = await service.listEligibleSalesOrders('org-1');
      expect(result).toEqual([fulfilledOrder]);
    });
  });

  describe('tenant isolation', () => {
    it('getById throws NotFoundException for a cross-tenant invoice', async () => {
      const { service, invoiceRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue(null);

      await expect(service.getById('org-2', 'invoice-1')).rejects.toThrow(NotFoundException);
    });
  });
});
