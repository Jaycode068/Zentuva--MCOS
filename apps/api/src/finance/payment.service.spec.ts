import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, PaymentMethod, PaymentStatus } from '@prisma/client';

import { InvoiceRepository, InvoiceWithRelations } from './invoice.repository';
import {
  CreatePaymentResult,
  OverPaymentError,
  PaymentAlreadyVoidedError,
  PaymentInvoiceConflictError,
  PaymentRepository,
  PaymentWithRelations,
} from './payment.repository';
import { PaymentService } from './payment.service';

describe('PaymentService', () => {
  const issuedInvoice: InvoiceWithRelations = {
    id: 'invoice-1',
    organisationId: 'org-1',
    invoiceCode: 'INV-000001',
    customerId: 'customer-1',
    status: InvoiceStatus.ISSUED,
    currency: 'NGN',
    total: 2_500_000,
    amountPaid: 0,
    amountCredited: 0,
  } as unknown as InvoiceWithRelations;

  const payment: PaymentWithRelations = {
    id: 'payment-1',
    organisationId: 'org-1',
    customerId: 'customer-1',
    paymentDate: new Date('2026-08-23'),
    amount: 1_000_000,
    currency: 'NGN',
    method: PaymentMethod.BANK_TRANSFER,
    reference: 'TXN-123',
    notes: null,
    status: PaymentStatus.RECORDED,
    idempotencyKey: null,
    createdById: 'user-1',
    createdAt: new Date('2026-08-23'),
    updatedAt: new Date('2026-08-23'),
    customer: { id: 'customer-1', customerCode: 'CUS-000013', customerName: 'ABC Supermarket' },
    allocations: [{ id: 'alloc-1', invoiceId: 'invoice-1', amount: 1_000_000 }],
  } as unknown as PaymentWithRelations;

  function makeService() {
    const paymentRepository = {
      create: jest.fn(),
      void: jest.fn(),
      findById: jest.fn(),
      findManyByOrganisation: jest.fn(),
    } as unknown as jest.Mocked<PaymentRepository>;
    const invoiceRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<InvoiceRepository>;

    const service = new PaymentService(paymentRepository, invoiceRepository);
    return { service, paymentRepository, invoiceRepository };
  }

  describe('create', () => {
    it('records a partial payment within the outstanding balance', async () => {
      const { service, invoiceRepository, paymentRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue(issuedInvoice);
      const result: CreatePaymentResult = {
        payment,
        invoice: {
          id: 'invoice-1',
          status: InvoiceStatus.PARTIALLY_PAID,
          amountPaid: 1_000_000,
          amountCredited: 0,
          total: 2_500_000,
        },
        wasCreated: true,
      };
      paymentRepository.create.mockResolvedValue(result);

      const outcome = await service.create(
        'org-1',
        {
          invoiceId: 'invoice-1',
          amount: 1_000_000,
          method: 'BANK_TRANSFER',
          paymentDate: new Date(),
        },
        'user-1',
      );

      expect(paymentRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organisationId: 'org-1',
          customerId: 'customer-1',
          invoiceId: 'invoice-1',
          amount: 1_000_000,
        }),
      );
      expect(outcome.invoice.status).toBe(InvoiceStatus.PARTIALLY_PAID);
    });

    it('records a final payment landing exactly on PAID', async () => {
      const { service, invoiceRepository, paymentRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue({ ...issuedInvoice, amountPaid: 1_000_000 });
      paymentRepository.create.mockResolvedValue({
        payment,
        invoice: {
          id: 'invoice-1',
          status: InvoiceStatus.PAID,
          amountPaid: 2_500_000,
          amountCredited: 0,
          total: 2_500_000,
        },
        wasCreated: true,
      });

      const outcome = await service.create(
        'org-1',
        { invoiceId: 'invoice-1', amount: 1_500_000, method: 'CASH', paymentDate: new Date() },
        'user-1',
      );

      expect(outcome.invoice.status).toBe(InvoiceStatus.PAID);
    });

    it('rejects an over-payment beyond the outstanding balance', async () => {
      const { service, invoiceRepository, paymentRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue(issuedInvoice);

      await expect(
        service.create(
          'org-1',
          { invoiceId: 'invoice-1', amount: 3_000_000, method: 'CASH', paymentDate: new Date() },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(paymentRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a payment exactly 0.01 beyond the outstanding boundary', async () => {
      const { service, invoiceRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue({ ...issuedInvoice, amountPaid: 2_499_999.99 });

      await expect(
        service.create(
          'org-1',
          { invoiceId: 'invoice-1', amount: 0.02, method: 'CASH', paymentDate: new Date() },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows a payment landing exactly on the outstanding boundary', async () => {
      const { service, invoiceRepository, paymentRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue({ ...issuedInvoice, amountPaid: 2_499_999.99 });
      paymentRepository.create.mockResolvedValue({
        payment,
        invoice: {
          id: 'invoice-1',
          status: InvoiceStatus.PAID,
          amountPaid: 2_500_000,
          amountCredited: 0,
          total: 2_500_000,
        },
        wasCreated: true,
      });

      await expect(
        service.create(
          'org-1',
          { invoiceId: 'invoice-1', amount: 0.01, method: 'CASH', paymentDate: new Date() },
          'user-1',
        ),
      ).resolves.toBeDefined();
    });

    it.each([['DRAFT'], ['PAID'], ['VOID']] as const)(
      'rejects a payment against a %s invoice',
      async (status) => {
        const { service, invoiceRepository } = makeService();
        invoiceRepository.findById.mockResolvedValue({ ...issuedInvoice, status });

        await expect(
          service.create(
            'org-1',
            { invoiceId: 'invoice-1', amount: 100, method: 'CASH', paymentDate: new Date() },
            'user-1',
          ),
        ).rejects.toThrow('This invoice is not eligible to receive a payment');
      },
    );

    it('rejects a payment against a nonexistent/cross-tenant invoice', async () => {
      const { service, invoiceRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          'org-1',
          { invoiceId: 'unknown', amount: 100, method: 'CASH', paymentDate: new Date() },
          'user-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('translates a repository OverPaymentError into a BadRequestException', async () => {
      const { service, invoiceRepository, paymentRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue(issuedInvoice);
      paymentRepository.create.mockRejectedValue(new OverPaymentError('race'));

      await expect(
        service.create(
          'org-1',
          { invoiceId: 'invoice-1', amount: 100, method: 'CASH', paymentDate: new Date() },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('translates a repository PaymentInvoiceConflictError into a BadRequestException', async () => {
      const { service, invoiceRepository, paymentRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue(issuedInvoice);
      paymentRepository.create.mockRejectedValue(new PaymentInvoiceConflictError('conflict'));

      await expect(
        service.create(
          'org-1',
          { invoiceId: 'invoice-1', amount: 100, method: 'CASH', paymentDate: new Date() },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('is idempotent — a replayed request with the same key does not double-record', async () => {
      const { service, invoiceRepository, paymentRepository } = makeService();
      invoiceRepository.findById.mockResolvedValue(issuedInvoice);
      paymentRepository.create.mockResolvedValue({
        payment,
        invoice: {
          id: 'invoice-1',
          status: InvoiceStatus.PARTIALLY_PAID,
          amountPaid: 1_000_000,
          amountCredited: 0,
          total: 2_500_000,
        },
        wasCreated: false,
      });

      const outcome = await service.create(
        'org-1',
        {
          invoiceId: 'invoice-1',
          amount: 1_000_000,
          method: 'CASH',
          paymentDate: new Date(),
          idempotencyKey: 'key-1',
        },
        'user-1',
      );

      expect(outcome.wasCreated).toBe(false);
    });
  });

  describe('void', () => {
    it('reverses a payment', async () => {
      const { service, paymentRepository } = makeService();
      paymentRepository.void.mockResolvedValue({
        payment: { ...payment, status: PaymentStatus.VOIDED },
        invoiceId: 'invoice-1',
      });

      const result = await service.void('org-1', 'payment-1', 'user-1');
      expect(result.payment.status).toBe(PaymentStatus.VOIDED);
    });

    it('rejects voiding an already-voided payment', async () => {
      const { service, paymentRepository } = makeService();
      paymentRepository.void.mockRejectedValue(new PaymentAlreadyVoidedError('already voided'));

      await expect(service.void('org-1', 'payment-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFoundException for an unknown/cross-tenant payment', async () => {
      const { service, paymentRepository } = makeService();
      paymentRepository.void.mockResolvedValue(null);

      await expect(service.void('org-1', 'unknown', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
