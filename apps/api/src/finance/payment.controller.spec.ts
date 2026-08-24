import { InvoiceStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { FINANCE_AUDIT_ACTIONS } from './finance-audit-actions';
import { PaymentController } from './payment.controller';
import { PaymentWithRelations } from './payment.repository';
import { PaymentService } from './payment.service';

describe('PaymentController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };
  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  const payment = {
    id: 'payment-1',
    customer: { id: 'customer-1', customerCode: 'CUS-000013', customerName: 'ABC Supermarket' },
    paymentDate: new Date('2026-08-23'),
    amount: 1_000_000,
    currency: 'NGN',
    method: PaymentMethod.BANK_TRANSFER,
    reference: 'TXN-1',
    notes: null,
    status: PaymentStatus.RECORDED,
    allocations: [{ id: 'alloc-1', invoiceId: 'invoice-1', amount: 1_000_000 }],
    createdAt: new Date('2026-08-23'),
  } as unknown as PaymentWithRelations;

  function makeController() {
    const paymentService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      void: jest.fn(),
    } as unknown as jest.Mocked<PaymentService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new PaymentController(paymentService, auditService);
    return { controller, paymentService, auditService };
  }

  describe('create', () => {
    it('records the payment and audits when wasCreated is true', async () => {
      const { controller, paymentService, auditService } = makeController();
      paymentService.create.mockResolvedValue({
        payment,
        invoice: {
          id: 'invoice-1',
          status: InvoiceStatus.PARTIALLY_PAID,
          amountPaid: 1_000_000,
          amountCredited: 0,
          total: 2_500_000,
        },
        wasCreated: true,
      });

      await controller.create(
        {
          invoiceId: 'invoice-1',
          amount: 1_000_000,
          method: 'BANK_TRANSFER',
          paymentDate: new Date(),
        },
        tokenUser,
        req,
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: FINANCE_AUDIT_ACTIONS.PAYMENT_RECORDED,
          entityId: 'invoice-1',
        }),
      );
    });

    it('does NOT audit on an idempotent replay (wasCreated: false)', async () => {
      const { controller, paymentService, auditService } = makeController();
      paymentService.create.mockResolvedValue({
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

      await controller.create(
        {
          invoiceId: 'invoice-1',
          amount: 1_000_000,
          method: 'BANK_TRANSFER',
          paymentDate: new Date(),
        },
        tokenUser,
        req,
      );

      expect(auditService.record).not.toHaveBeenCalled();
    });
  });

  describe('void', () => {
    it('voids and records an audit entry', async () => {
      const { controller, paymentService, auditService } = makeController();
      paymentService.void.mockResolvedValue({
        payment: { ...payment, status: PaymentStatus.VOIDED },
        invoiceId: 'invoice-1',
      });

      await controller.void('payment-1', tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: FINANCE_AUDIT_ACTIONS.PAYMENT_VOIDED,
          entityId: 'invoice-1',
        }),
      );
    });
  });
});
