import { PaymentMethod, PaymentStatus, SupplierInvoiceStatus } from '@prisma/client';

import {
  OverPaymentError,
  PaymentInvoiceConflictError,
  SupplierPaymentRepository,
} from './supplier-payment.repository';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A deliberate exception to this codebase's "no repository-level unit tests for atomic
 * transactions" convention — same justification as `payment.repository.spec.ts`.
 * Verifies `SupplierPaymentRepository.create()`/`.void()`'s real transaction logic,
 * including the brief's Scenario E (Invoice -> Payment -> AP balance -> GL consistency)
 * and the over-payment guard being bounded by `recognizedAmount`, never `total`.
 */
function makeFakeTx(
  supplierInvoices: Map<string, Record<string, unknown>>,
  supplierPayments: Map<string, Record<string, unknown>>,
  journalEntries: Map<string, Record<string, unknown>> = new Map(),
) {
  let sequence = 0;
  let journalSequence = 0;
  return {
    chartOfAccount: {
      findFirst: jest.fn(
        async ({ where }: { where: { organisationId: string; systemKey: string } }) => ({
          id: `account-${where.systemKey}`,
          organisationId: where.organisationId,
          systemKey: where.systemKey,
        }),
      ),
    },
    accountingPeriod: {
      findFirst: jest.fn(async () => ({ id: 'period-1', status: 'OPEN' })),
    },
    journalEntry: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            organisationId_sourceType_sourceId?: {
              organisationId: string;
              sourceType: string;
              sourceId: string;
            };
          };
        }) => {
          const key = where.organisationId_sourceType_sourceId;
          if (!key) return null;
          for (const entry of journalEntries.values()) {
            if (
              entry.organisationId === key.organisationId &&
              entry.sourceType === key.sourceType &&
              entry.sourceId === key.sourceId
            ) {
              return entry;
            }
          }
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        journalSequence += 1;
        const id = `journal-${journalSequence}`;
        const entry = { id, ...data };
        journalEntries.set(id, entry);
        return entry;
      }),
    },
    supplierPayment: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { supplierId_idempotencyKey?: { supplierId: string; idempotencyKey: string } };
        }) => {
          const key = where.supplierId_idempotencyKey;
          if (!key) return null;
          for (const payment of supplierPayments.values()) {
            if (
              payment.supplierId === key.supplierId &&
              payment.idempotencyKey === key.idempotencyKey
            ) {
              return payment;
            }
          }
          return null;
        },
      ),
      findFirst: jest.fn(async ({ where }: { where: { id: string; organisationId?: string } }) => {
        const payment = supplierPayments.get(where.id);
        if (!payment) return null;
        if (where.organisationId && payment.organisationId !== where.organisationId) return null;
        return payment;
      }),
      create: jest.fn(
        async ({
          data,
        }: {
          data: Record<string, unknown> & {
            allocations: { create: { supplierInvoiceId: string; amount: number }[] };
          };
        }) => {
          sequence += 1;
          const id = `spay-${sequence}`;
          const allocations = data.allocations.create.map((allocation, index) => ({
            id: `alloc-${id}-${index}`,
            ...allocation,
          }));
          const stored = {
            id,
            ...data,
            allocations,
            supplier: {
              id: data.supplierId,
              supplierCode: 'SUP-000004',
              supplierName: 'Label Masters',
            },
          };
          supplierPayments.set(id, stored);
          return stored;
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const payment = supplierPayments.get(where.id);
          if (!payment) throw new Error('supplier payment not found');
          Object.assign(payment, data);
          return payment;
        },
      ),
    },
    supplierInvoice: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: {
            id: string;
            organisationId?: string;
            supplierId?: string;
            status?: { in: SupplierInvoiceStatus[] };
          };
        }) => {
          const invoice = supplierInvoices.get(where.id);
          if (!invoice) return null;
          if (where.organisationId && invoice.organisationId !== where.organisationId) return null;
          if (where.supplierId && invoice.supplierId !== where.supplierId) return null;
          if (
            where.status?.in &&
            !where.status.in.includes(invoice.status as SupplierInvoiceStatus)
          ) {
            return null;
          }
          return invoice;
        },
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const invoice = supplierInvoices.get(where.id);
        if (!invoice) throw new Error('supplier invoice not found');
        return invoice;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const invoice = supplierInvoices.get(where.id);
          if (!invoice) throw new Error('supplier invoice not found');
          Object.assign(invoice, data);
          return invoice;
        },
      ),
    },
  };
}

function makePrisma(
  supplierInvoices: Map<string, Record<string, unknown>>,
  supplierPayments: Map<string, Record<string, unknown>>,
  journalEntries: Map<string, Record<string, unknown>> = new Map(),
) {
  const tx = makeFakeTx(supplierInvoices, supplierPayments, journalEntries);
  return {
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaService;
}

function makeSupplierInvoice(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sinv-1',
    organisationId: 'org-1',
    supplierId: 'supplier-1',
    invoiceNumber: 'INV-0001',
    currency: 'NGN',
    status: SupplierInvoiceStatus.POSTED,
    total: 1_000_000,
    recognizedAmount: 1_000_000,
    amountPaid: 0,
    amountCredited: 0,
    ...overrides,
  };
}

describe('SupplierPaymentRepository (deliberate exception — real transaction logic under test)', () => {
  it('Scenario A/E: a partial payment lands the invoice on PARTIALLY_PAID with the correct outstanding balance', async () => {
    const supplierInvoices = new Map([['sinv-1', makeSupplierInvoice()]]);
    const supplierPayments = new Map<string, Record<string, unknown>>();
    const repository = new SupplierPaymentRepository(
      makePrisma(supplierInvoices, supplierPayments),
    );

    const result = await repository.create({
      organisationId: 'org-1',
      supplierId: 'supplier-1',
      supplierInvoiceId: 'sinv-1',
      amount: 600_000,
      method: PaymentMethod.CASH,
      paymentDate: new Date(),
      createdById: 'user-1',
    });

    expect(result.wasCreated).toBe(true);
    expect(result.supplierInvoice.status).toBe(SupplierInvoiceStatus.PARTIALLY_PAID);
    expect(result.supplierInvoice.amountPaid).toBe(600_000);
  });

  it('Scenario A/E: a second payment for the remainder brings AP to zero and the invoice to PAID', async () => {
    const supplierInvoices = new Map([['sinv-1', makeSupplierInvoice()]]);
    const supplierPayments = new Map<string, Record<string, unknown>>();
    const repository = new SupplierPaymentRepository(
      makePrisma(supplierInvoices, supplierPayments),
    );

    await repository.create({
      organisationId: 'org-1',
      supplierId: 'supplier-1',
      supplierInvoiceId: 'sinv-1',
      amount: 600_000,
      method: PaymentMethod.CASH,
      paymentDate: new Date(),
      createdById: 'user-1',
    });
    const second = await repository.create({
      organisationId: 'org-1',
      supplierId: 'supplier-1',
      supplierInvoiceId: 'sinv-1',
      amount: 400_000,
      method: PaymentMethod.CASH,
      paymentDate: new Date(),
      createdById: 'user-1',
    });

    expect(second.supplierInvoice.status).toBe(SupplierInvoiceStatus.PAID);
    expect(second.supplierInvoice.amountPaid).toBe(1_000_000);
    const outstanding =
      (second.supplierInvoice.recognizedAmount as number) -
      (second.supplierInvoice.amountPaid as number);
    expect(outstanding).toBe(0);
  });

  it('posts DR Accounts Payable / CR Cash for a CASH payment, and CR Bank for BANK_TRANSFER', async () => {
    const supplierInvoices = new Map([
      ['sinv-1', makeSupplierInvoice()],
      ['sinv-2', makeSupplierInvoice({ id: 'sinv-2' })],
    ]);
    const supplierPayments = new Map<string, Record<string, unknown>>();
    const journalEntries = new Map<string, Record<string, unknown>>();
    const repository = new SupplierPaymentRepository(
      makePrisma(supplierInvoices, supplierPayments, journalEntries),
    );

    await repository.create({
      organisationId: 'org-1',
      supplierId: 'supplier-1',
      supplierInvoiceId: 'sinv-1',
      amount: 400_000,
      method: PaymentMethod.CASH,
      paymentDate: new Date(),
      createdById: 'user-1',
    });
    await repository.create({
      organisationId: 'org-1',
      supplierId: 'supplier-1',
      supplierInvoiceId: 'sinv-2',
      amount: 300_000,
      method: PaymentMethod.BANK_TRANSFER,
      paymentDate: new Date(),
      createdById: 'user-1',
    });

    const entries = [...journalEntries.values()] as {
      lines: { create: { accountId: string; debit: number; credit: number }[] };
    }[];
    const cashLines = entries[0]!.lines.create;
    expect(cashLines).toEqual(
      expect.arrayContaining([
        { accountId: 'account-AP', description: undefined, debit: 400_000, credit: 0 },
        { accountId: 'account-CASH', description: undefined, debit: 0, credit: 400_000 },
      ]),
    );
    const bankLines = entries[1]!.lines.create;
    expect(bankLines).toEqual(
      expect.arrayContaining([
        { accountId: 'account-AP', description: undefined, debit: 300_000, credit: 0 },
        { accountId: 'account-BANK', description: undefined, debit: 0, credit: 300_000 },
      ]),
    );
  });

  it('rejects a payment exceeding the outstanding recognizedAmount, even when total is higher (over-invoice, Scenario C guard)', async () => {
    const supplierInvoices = new Map([
      // total=1,050,000 (what the supplier billed) but recognizedAmount capped at 1,000,000.
      ['sinv-1', makeSupplierInvoice({ total: 1_050_000, recognizedAmount: 1_000_000 })],
    ]);
    const supplierPayments = new Map<string, Record<string, unknown>>();
    const repository = new SupplierPaymentRepository(
      makePrisma(supplierInvoices, supplierPayments),
    );

    await expect(
      repository.create({
        organisationId: 'org-1',
        supplierId: 'supplier-1',
        supplierInvoiceId: 'sinv-1',
        amount: 1_050_000,
        method: PaymentMethod.CASH,
        paymentDate: new Date(),
        createdById: 'user-1',
      }),
    ).rejects.toThrow(OverPaymentError);
  });

  it('rejects a payment exactly 0.01 beyond the outstanding boundary', async () => {
    const supplierInvoices = new Map([['sinv-1', makeSupplierInvoice({ amountPaid: 999_999.99 })]]);
    const supplierPayments = new Map<string, Record<string, unknown>>();
    const repository = new SupplierPaymentRepository(
      makePrisma(supplierInvoices, supplierPayments),
    );

    await expect(
      repository.create({
        organisationId: 'org-1',
        supplierId: 'supplier-1',
        supplierInvoiceId: 'sinv-1',
        amount: 0.02,
        method: PaymentMethod.CASH,
        paymentDate: new Date(),
        createdById: 'user-1',
      }),
    ).rejects.toThrow(OverPaymentError);
  });

  it('rejects a payment against a DRAFT supplier invoice', async () => {
    const supplierInvoices = new Map([
      ['sinv-1', makeSupplierInvoice({ status: SupplierInvoiceStatus.DRAFT })],
    ]);
    const supplierPayments = new Map<string, Record<string, unknown>>();
    const repository = new SupplierPaymentRepository(
      makePrisma(supplierInvoices, supplierPayments),
    );

    await expect(
      repository.create({
        organisationId: 'org-1',
        supplierId: 'supplier-1',
        supplierInvoiceId: 'sinv-1',
        amount: 100,
        method: PaymentMethod.CASH,
        paymentDate: new Date(),
        createdById: 'user-1',
      }),
    ).rejects.toThrow(PaymentInvoiceConflictError);
  });

  it('rejects a payment against a VOID supplier invoice', async () => {
    const supplierInvoices = new Map([
      ['sinv-1', makeSupplierInvoice({ status: SupplierInvoiceStatus.VOID })],
    ]);
    const supplierPayments = new Map<string, Record<string, unknown>>();
    const repository = new SupplierPaymentRepository(
      makePrisma(supplierInvoices, supplierPayments),
    );

    await expect(
      repository.create({
        organisationId: 'org-1',
        supplierId: 'supplier-1',
        supplierInvoiceId: 'sinv-1',
        amount: 100,
        method: PaymentMethod.CASH,
        paymentDate: new Date(),
        createdById: 'user-1',
      }),
    ).rejects.toThrow(PaymentInvoiceConflictError);
  });

  it('rejects a payment against another supplier’s invoice (tenant/party isolation)', async () => {
    const supplierInvoices = new Map([
      ['sinv-1', makeSupplierInvoice({ supplierId: 'supplier-2' })],
    ]);
    const supplierPayments = new Map<string, Record<string, unknown>>();
    const repository = new SupplierPaymentRepository(
      makePrisma(supplierInvoices, supplierPayments),
    );

    await expect(
      repository.create({
        organisationId: 'org-1',
        supplierId: 'supplier-1',
        supplierInvoiceId: 'sinv-1',
        amount: 100,
        method: PaymentMethod.CASH,
        paymentDate: new Date(),
        createdById: 'user-1',
      }),
    ).rejects.toThrow(PaymentInvoiceConflictError);
  });

  it('idempotency replay returns the original payment without double-applying, and posts exactly one journal entry', async () => {
    const supplierInvoices = new Map([['sinv-1', makeSupplierInvoice()]]);
    const supplierPayments = new Map<string, Record<string, unknown>>();
    const journalEntries = new Map<string, Record<string, unknown>>();
    const repository = new SupplierPaymentRepository(
      makePrisma(supplierInvoices, supplierPayments, journalEntries),
    );

    const input = {
      organisationId: 'org-1',
      supplierId: 'supplier-1',
      supplierInvoiceId: 'sinv-1',
      amount: 600_000,
      method: PaymentMethod.CASH,
      paymentDate: new Date(),
      createdById: 'user-1',
      idempotencyKey: 'key-1',
    };

    const first = await repository.create(input);
    const second = await repository.create(input);

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.supplierPayment.id).toBe(first.supplierPayment.id);
    expect(second.supplierInvoice.amountPaid).toBe(600_000);
    expect(journalEntries.size).toBe(1);
  });

  it('void() reverses the payment and recomputes the invoice status back down', async () => {
    const supplierInvoices = new Map([
      [
        'sinv-1',
        makeSupplierInvoice({ amountPaid: 600_000, status: SupplierInvoiceStatus.PARTIALLY_PAID }),
      ],
    ]);
    const supplierPayments = new Map<string, Record<string, unknown>>([
      [
        'spay-1',
        {
          id: 'spay-1',
          organisationId: 'org-1',
          status: PaymentStatus.RECORDED,
          allocations: [{ id: 'alloc-1', supplierInvoiceId: 'sinv-1', amount: 600_000 }],
        },
      ],
    ]);
    const repository = new SupplierPaymentRepository(
      makePrisma(supplierInvoices, supplierPayments),
    );

    const result = await repository.void('org-1', 'spay-1', 'user-1');

    expect(result).not.toBeNull();
    expect(result!.supplierPayment.status).toBe(PaymentStatus.VOIDED);
    expect(supplierInvoices.get('sinv-1')!.amountPaid).toBe(0);
    expect(supplierInvoices.get('sinv-1')!.status).toBe(SupplierInvoiceStatus.POSTED);
  });

  it('never lets amountPaid go negative when voiding', async () => {
    const supplierInvoices = new Map([
      ['sinv-1', makeSupplierInvoice({ amountPaid: 0, status: SupplierInvoiceStatus.POSTED })],
    ]);
    const supplierPayments = new Map<string, Record<string, unknown>>([
      [
        'spay-1',
        {
          id: 'spay-1',
          organisationId: 'org-1',
          status: PaymentStatus.RECORDED,
          allocations: [{ id: 'alloc-1', supplierInvoiceId: 'sinv-1', amount: 600_000 }],
        },
      ],
    ]);
    const repository = new SupplierPaymentRepository(
      makePrisma(supplierInvoices, supplierPayments),
    );

    await repository.void('org-1', 'spay-1', 'user-1');

    expect(supplierInvoices.get('sinv-1')!.amountPaid).toBe(0);
  });

  it('rejects voiding an already-voided payment', async () => {
    const supplierInvoices = new Map([['sinv-1', makeSupplierInvoice()]]);
    const supplierPayments = new Map<string, Record<string, unknown>>([
      [
        'spay-1',
        {
          id: 'spay-1',
          organisationId: 'org-1',
          status: PaymentStatus.VOIDED,
          allocations: [{ id: 'alloc-1', supplierInvoiceId: 'sinv-1', amount: 600_000 }],
        },
      ],
    ]);
    const repository = new SupplierPaymentRepository(
      makePrisma(supplierInvoices, supplierPayments),
    );

    await expect(repository.void('org-1', 'spay-1', 'user-1')).rejects.toThrow();
  });
});
