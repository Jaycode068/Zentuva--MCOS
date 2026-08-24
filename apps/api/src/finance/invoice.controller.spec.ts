import { InvoiceStatus } from '@prisma/client';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { CreditNoteService } from './credit-note.service';
import { FINANCE_AUDIT_ACTIONS } from './finance-audit-actions';
import { InvoiceController } from './invoice.controller';
import { InvoiceWithRelations } from './invoice.repository';
import { InvoiceService } from './invoice.service';
import { PaymentService } from './payment.service';

describe('InvoiceController', () => {
  const tokenUser: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };
  const req = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } } as unknown as Request;

  const invoice = {
    id: 'invoice-1',
    invoiceCode: 'INV-000001',
    customer: { id: 'customer-1', customerCode: 'CUS-000013', customerName: 'ABC Supermarket' },
    outlet: null,
    salesOrder: { id: 'order-1', orderCode: 'SO-000012' },
    salesOrderId: 'order-1',
    customerId: 'customer-1',
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
    items: [],
    createdAt: new Date('2026-08-23'),
    updatedAt: new Date('2026-08-23'),
  } as unknown as InvoiceWithRelations;

  function makeController() {
    const invoiceService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      issue: jest.fn(),
      void: jest.fn(),
      listEligibleSalesOrders: jest.fn(),
    } as unknown as jest.Mocked<InvoiceService>;
    const paymentService = { list: jest.fn() } as unknown as jest.Mocked<PaymentService>;
    const creditNoteService = { list: jest.fn() } as unknown as jest.Mocked<CreditNoteService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const controller = new InvoiceController(
      invoiceService,
      paymentService,
      creditNoteService,
      auditService,
    );
    return { controller, invoiceService, paymentService, creditNoteService, auditService };
  }

  describe('create', () => {
    it('creates the invoice and records an audit entry', async () => {
      const { controller, invoiceService, auditService } = makeController();
      invoiceService.create.mockResolvedValue(invoice);

      const result = await controller.create(
        {
          salesOrderId: 'order-1',
          invoiceDate: new Date('2026-08-23'),
          paymentTerms: 'DUE_ON_RECEIPT',
          items: [{ salesOrderItemId: 'order-item-1' }],
        },
        tokenUser,
        req,
      );

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: FINANCE_AUDIT_ACTIONS.INVOICE_CREATED,
          entityId: 'invoice-1',
        }),
      );
      expect(result.invoiceCode).toBe('INV-000001');
    });
  });

  describe('issue / void', () => {
    it('issues and records an audit entry', async () => {
      const { controller, invoiceService, auditService } = makeController();
      invoiceService.issue.mockResolvedValue({ ...invoice, status: InvoiceStatus.ISSUED });

      await controller.issue('invoice-1', tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: FINANCE_AUDIT_ACTIONS.INVOICE_ISSUED }),
      );
    });

    it('voids and records an audit entry', async () => {
      const { controller, invoiceService, auditService } = makeController();
      invoiceService.void.mockResolvedValue({ ...invoice, status: InvoiceStatus.VOID });

      await controller.void('invoice-1', {}, tokenUser, req);

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: FINANCE_AUDIT_ACTIONS.INVOICE_VOIDED }),
      );
    });
  });

  describe('eligible-sales-orders / drill-downs', () => {
    it('lists eligible sales orders', async () => {
      const { controller, invoiceService } = makeController();
      invoiceService.listEligibleSalesOrders.mockResolvedValue([]);

      const result = await controller.listEligibleSalesOrders(tokenUser);
      expect(invoiceService.listEligibleSalesOrders).toHaveBeenCalledWith('org-1');
      expect(result).toEqual({ items: [] });
    });

    it('lists payments for an invoice', async () => {
      const { controller, paymentService } = makeController();
      paymentService.list.mockResolvedValue([]);

      const result = await controller.listPayments(tokenUser, 'invoice-1');
      expect(paymentService.list).toHaveBeenCalledWith('org-1', { invoiceId: 'invoice-1' });
      expect(result).toEqual({ items: [] });
    });

    it('lists credit notes for an invoice', async () => {
      const { controller, creditNoteService } = makeController();
      creditNoteService.list.mockResolvedValue([]);

      const result = await controller.listCreditNotes(tokenUser, 'invoice-1');
      expect(creditNoteService.list).toHaveBeenCalledWith('org-1', { invoiceId: 'invoice-1' });
      expect(result).toEqual({ items: [] });
    });
  });
});
