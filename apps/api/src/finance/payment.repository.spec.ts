import { InvoiceStatus, PaymentMethod, PaymentStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  OverPaymentError,
  PaymentInvoiceConflictError,
  PaymentRepository,
} from './payment.repository';

/**
 * A deliberate exception to this codebase's "no repository-level unit tests for atomic
 * transactions" convention (see docs/domains/finance.md "Testing" and the Sprint 6
 * completion report) — money correctness at exact boundary values is worth it. Rather
 * than standing up real-database integration infrastructure this codebase has never
 * needed anywhere else, this exercises `PaymentRepository.create()`'s actual
 * transaction-callback logic against a small in-memory fake of the two tables it reads/
 * writes (`invoice`, `payment`) — deterministic, no DB required, but the real repository
 * code under test, not a re-implementation of it.
 */
function makeFakeTx(
  invoices: Map<string, Record<string, unknown>>,
  payments: Map<string, Record<string, unknown>>,
) {
  let sequence = 0;
  return {
    payment: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; organisationId?: string } }) => {
        const payment = payments.get(where.id);
        if (!payment) return null;
        if (where.organisationId && payment.organisationId !== where.organisationId) return null;
        return payment;
      }),
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { customerId_idempotencyKey?: { customerId: string; idempotencyKey: string } };
        }) => {
          const key = where.customerId_idempotencyKey;
          if (!key) return null;
          for (const payment of payments.values()) {
            if (
              payment.customerId === key.customerId &&
              payment.idempotencyKey === key.idempotencyKey
            ) {
              return payment;
            }
          }
          return null;
        },
      ),
      create: jest.fn(
        async ({
          data,
        }: {
          data: Record<string, unknown> & {
            allocations: { create: { invoiceId: string; amount: number }[] };
          };
        }) => {
          sequence += 1;
          const id = `payment-${sequence}`;
          const allocations = data.allocations.create.map((allocation, index) => ({
            id: `alloc-${id}-${index}`,
            ...allocation,
          }));
          const payment = {
            id,
            ...data,
            allocations,
            customer: {
              id: data.customerId,
              customerCode: 'CUS-000013',
              customerName: 'ABC Supermarket',
            },
          };
          delete (payment as Record<string, unknown>).allocations;
          const stored = { ...payment, allocations };
          payments.set(id, stored);
          return stored;
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const payment = payments.get(where.id);
          if (!payment) throw new Error('payment not found');
          Object.assign(payment, data);
          return payment;
        },
      ),
    },
    invoice: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: {
            id: string;
            organisationId?: string;
            customerId?: string;
            status?: { in: InvoiceStatus[] };
          };
        }) => {
          const invoice = invoices.get(where.id);
          if (!invoice) return null;
          if (where.organisationId && invoice.organisationId !== where.organisationId) return null;
          if (where.customerId && invoice.customerId !== where.customerId) return null;
          if (where.status?.in && !where.status.in.includes(invoice.status as InvoiceStatus))
            return null;
          return invoice;
        },
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const invoice = invoices.get(where.id);
        if (!invoice) throw new Error('invoice not found');
        return invoice;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const invoice = invoices.get(where.id);
          if (!invoice) throw new Error('invoice not found');
          Object.assign(invoice, data);
          return invoice;
        },
      ),
    },
  };
}

function makePrisma(
  invoices: Map<string, Record<string, unknown>>,
  payments: Map<string, Record<string, unknown>>,
) {
  const tx = makeFakeTx(invoices, payments);
  return {
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaService;
}

function makeInvoice(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'invoice-1',
    organisationId: 'org-1',
    customerId: 'customer-1',
    currency: 'NGN',
    status: InvoiceStatus.ISSUED,
    total: 2_500_000,
    amountPaid: 0,
    amountCredited: 0,
    ...overrides,
  };
}

describe('PaymentRepository (deliberate exception — real transaction logic under test)', () => {
  it('records a partial payment and lands the invoice on PARTIALLY_PAID', async () => {
    const invoices = new Map([['invoice-1', makeInvoice()]]);
    const payments = new Map<string, Record<string, unknown>>();
    const repository = new PaymentRepository(makePrisma(invoices, payments));

    const result = await repository.create({
      organisationId: 'org-1',
      customerId: 'customer-1',
      invoiceId: 'invoice-1',
      amount: 1_000_000,
      method: PaymentMethod.CASH,
      paymentDate: new Date(),
      createdById: 'user-1',
    });

    expect(result.wasCreated).toBe(true);
    expect(result.invoice.status).toBe(InvoiceStatus.PARTIALLY_PAID);
    expect(result.invoice.amountPaid).toBe(1_000_000);
  });

  it('allows a payment landing exactly on the outstanding boundary and marks PAID', async () => {
    const invoices = new Map([['invoice-1', makeInvoice({ amountPaid: 2_499_999.99 })]]);
    const payments = new Map<string, Record<string, unknown>>();
    const repository = new PaymentRepository(makePrisma(invoices, payments));

    const result = await repository.create({
      organisationId: 'org-1',
      customerId: 'customer-1',
      invoiceId: 'invoice-1',
      amount: 0.01,
      method: PaymentMethod.CASH,
      paymentDate: new Date(),
      createdById: 'user-1',
    });

    expect(result.invoice.status).toBe(InvoiceStatus.PAID);
    expect(result.invoice.amountPaid).toBe(2_500_000);
  });

  it('rejects a payment exactly 0.01 beyond the outstanding boundary', async () => {
    const invoices = new Map([['invoice-1', makeInvoice({ amountPaid: 2_499_999.99 })]]);
    const payments = new Map<string, Record<string, unknown>>();
    const repository = new PaymentRepository(makePrisma(invoices, payments));

    await expect(
      repository.create({
        organisationId: 'org-1',
        customerId: 'customer-1',
        invoiceId: 'invoice-1',
        amount: 0.02,
        method: PaymentMethod.CASH,
        paymentDate: new Date(),
        createdById: 'user-1',
      }),
    ).rejects.toThrow(OverPaymentError);
  });

  it('rejects a payment against a DRAFT invoice', async () => {
    const invoices = new Map([['invoice-1', makeInvoice({ status: InvoiceStatus.DRAFT })]]);
    const payments = new Map<string, Record<string, unknown>>();
    const repository = new PaymentRepository(makePrisma(invoices, payments));

    await expect(
      repository.create({
        organisationId: 'org-1',
        customerId: 'customer-1',
        invoiceId: 'invoice-1',
        amount: 100,
        method: PaymentMethod.CASH,
        paymentDate: new Date(),
        createdById: 'user-1',
      }),
    ).rejects.toThrow(PaymentInvoiceConflictError);
  });

  it('rejects a payment against a VOID invoice', async () => {
    const invoices = new Map([['invoice-1', makeInvoice({ status: InvoiceStatus.VOID })]]);
    const payments = new Map<string, Record<string, unknown>>();
    const repository = new PaymentRepository(makePrisma(invoices, payments));

    await expect(
      repository.create({
        organisationId: 'org-1',
        customerId: 'customer-1',
        invoiceId: 'invoice-1',
        amount: 100,
        method: PaymentMethod.CASH,
        paymentDate: new Date(),
        createdById: 'user-1',
      }),
    ).rejects.toThrow(PaymentInvoiceConflictError);
  });

  it('rejects a payment against a nonexistent/cross-tenant invoice', async () => {
    const invoices = new Map<string, Record<string, unknown>>();
    const payments = new Map<string, Record<string, unknown>>();
    const repository = new PaymentRepository(makePrisma(invoices, payments));

    await expect(
      repository.create({
        organisationId: 'org-1',
        customerId: 'customer-1',
        invoiceId: 'unknown',
        amount: 100,
        method: PaymentMethod.CASH,
        paymentDate: new Date(),
        createdById: 'user-1',
      }),
    ).rejects.toThrow(PaymentInvoiceConflictError);
  });

  it('idempotency replay returns the original payment without double-applying', async () => {
    const invoices = new Map([['invoice-1', makeInvoice()]]);
    const payments = new Map<string, Record<string, unknown>>();
    const repository = new PaymentRepository(makePrisma(invoices, payments));

    const first = await repository.create({
      organisationId: 'org-1',
      customerId: 'customer-1',
      invoiceId: 'invoice-1',
      amount: 1_000_000,
      method: PaymentMethod.CASH,
      paymentDate: new Date(),
      createdById: 'user-1',
      idempotencyKey: 'key-1',
    });
    const second = await repository.create({
      organisationId: 'org-1',
      customerId: 'customer-1',
      invoiceId: 'invoice-1',
      amount: 1_000_000,
      method: PaymentMethod.CASH,
      paymentDate: new Date(),
      createdById: 'user-1',
      idempotencyKey: 'key-1',
    });

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.payment.id).toBe(first.payment.id);
    // Only ONE payment's worth was ever applied — the invoice was not double-deducted.
    expect(second.invoice.amountPaid).toBe(1_000_000);
  });

  it('a concurrent-style double payment sequence: the second payment sees the first applied and is correctly bounded', async () => {
    const invoices = new Map([['invoice-1', makeInvoice()]]);
    const payments = new Map<string, Record<string, unknown>>();
    const repository = new PaymentRepository(makePrisma(invoices, payments));

    const first = await repository.create({
      organisationId: 'org-1',
      customerId: 'customer-1',
      invoiceId: 'invoice-1',
      amount: 1_500_000,
      method: PaymentMethod.CASH,
      paymentDate: new Date(),
      createdById: 'user-1',
    });
    expect(first.invoice.amountPaid).toBe(1_500_000);

    // A second payment for the full remaining amount should succeed and land on PAID.
    const second = await repository.create({
      organisationId: 'org-1',
      customerId: 'customer-1',
      invoiceId: 'invoice-1',
      amount: 1_000_000,
      method: PaymentMethod.CASH,
      paymentDate: new Date(),
      createdById: 'user-1',
    });
    expect(second.invoice.status).toBe(InvoiceStatus.PAID);

    // A third payment against the now-PAID invoice must be rejected — nothing left owing.
    await expect(
      repository.create({
        organisationId: 'org-1',
        customerId: 'customer-1',
        invoiceId: 'invoice-1',
        amount: 1,
        method: PaymentMethod.CASH,
        paymentDate: new Date(),
        createdById: 'user-1',
      }),
    ).rejects.toThrow(PaymentInvoiceConflictError);
  });

  it('void() reverses the payment and recomputes the invoice status back down', async () => {
    const invoices = new Map([
      ['invoice-1', makeInvoice({ amountPaid: 1_000_000, status: InvoiceStatus.PARTIALLY_PAID })],
    ]);
    const payments = new Map<string, Record<string, unknown>>([
      [
        'payment-1',
        {
          id: 'payment-1',
          organisationId: 'org-1',
          status: PaymentStatus.RECORDED,
          allocations: [{ id: 'alloc-1', invoiceId: 'invoice-1', amount: 1_000_000 }],
        },
      ],
    ]);
    const repository = new PaymentRepository(makePrisma(invoices, payments));

    const result = await repository.void('org-1', 'payment-1', 'user-1');

    expect(result).not.toBeNull();
    expect(result!.payment.status).toBe(PaymentStatus.VOIDED);
    expect(invoices.get('invoice-1')!.amountPaid).toBe(0);
    expect(invoices.get('invoice-1')!.status).toBe(InvoiceStatus.ISSUED);
  });

  it('never lets amountPaid go negative when voiding', async () => {
    const invoices = new Map([
      ['invoice-1', makeInvoice({ amountPaid: 0, status: InvoiceStatus.ISSUED })],
    ]);
    const payments = new Map<string, Record<string, unknown>>([
      [
        'payment-1',
        {
          id: 'payment-1',
          organisationId: 'org-1',
          status: PaymentStatus.RECORDED,
          allocations: [{ id: 'alloc-1', invoiceId: 'invoice-1', amount: 1_000_000 }],
        },
      ],
    ]);
    const repository = new PaymentRepository(makePrisma(invoices, payments));

    await repository.void('org-1', 'payment-1', 'user-1');

    expect(invoices.get('invoice-1')!.amountPaid).toBe(0);
  });
});
