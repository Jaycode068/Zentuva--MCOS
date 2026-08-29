import { AccountType, PaymentTermType, SupplierInvoiceStatus } from '@prisma/client';

import { NoOpenPeriodError } from './accounting/journal-posting';
import { InvalidDebitAccountError } from './supplier-invoice-matching';
import {
  CreateSupplierInvoiceData,
  InvalidGoodsReceiptReferenceError,
  MissingLineReferenceError,
  SupplierInvoiceConflictError,
  SupplierInvoiceRepository,
} from './supplier-invoice.repository';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A deliberate exception to this codebase's "no repository-level unit tests for atomic
 * transactions" convention — same justification as `supplier-return.repository.spec.ts`.
 * Verifies Sprint 12's Path A capping formula (docs/domains/accounting.md "Supplier
 * Invoice Matching") and Path B posting against the real `post()` transaction callback,
 * including the brief's own worked Scenarios A-E.
 */

interface FakeGoodsReceiptItem {
  id: string;
  productId: string;
  payableQuantity: number;
  returnedQuantity: number;
  returnedExcessQuantity: number;
  invoicedQuantity: number;
  purchaseOrderItem: { unitPrice: number };
  goodsReceipt: { organisationId: string; supplierId: string };
}

interface FakeAccount {
  id: string;
  organisationId: string;
  systemKey?: string;
  type: AccountType;
  isSystemAccount: boolean;
}

function makeGoodsReceiptItem(overrides: Partial<FakeGoodsReceiptItem> = {}): FakeGoodsReceiptItem {
  return {
    id: 'gri-1',
    productId: 'product-1',
    payableQuantity: 1000,
    returnedQuantity: 0,
    returnedExcessQuantity: 0,
    invoicedQuantity: 0,
    purchaseOrderItem: { unitPrice: 1000 },
    goodsReceipt: { organisationId: 'org-1', supplierId: 'supplier-1' },
    ...overrides,
  };
}

function defaultAccounts(): Map<string, FakeAccount> {
  return new Map([
    [
      'account-ap',
      {
        id: 'account-ap',
        organisationId: 'org-1',
        systemKey: 'AP',
        type: AccountType.LIABILITY,
        isSystemAccount: true,
      },
    ],
    [
      'account-freight',
      {
        id: 'account-freight',
        organisationId: 'org-1',
        type: AccountType.EXPENSE,
        isSystemAccount: false,
      },
    ],
    [
      'account-asset',
      {
        id: 'account-asset',
        organisationId: 'org-1',
        type: AccountType.ASSET,
        isSystemAccount: false,
      },
    ],
    [
      'account-liability',
      {
        id: 'account-liability',
        organisationId: 'org-1',
        type: AccountType.LIABILITY,
        isSystemAccount: false,
      },
    ],
    [
      'account-system-expense',
      {
        id: 'account-system-expense',
        organisationId: 'org-1',
        type: AccountType.EXPENSE,
        isSystemAccount: true,
      },
    ],
    [
      'account-other-org',
      {
        id: 'account-other-org',
        organisationId: 'org-2',
        type: AccountType.EXPENSE,
        isSystemAccount: false,
      },
    ],
  ]);
}

function makeFakeTx(
  options: {
    goodsReceiptItems?: Map<string, FakeGoodsReceiptItem>;
    accounts?: Map<string, FakeAccount>;
    openPeriod?: { startDate: Date; endDate: Date } | null;
  } = {},
) {
  const goodsReceiptItems =
    options.goodsReceiptItems ?? new Map([['gri-1', makeGoodsReceiptItem()]]);
  const accounts = options.accounts ?? defaultAccounts();
  const openPeriod =
    'openPeriod' in options
      ? options.openPeriod
      : { startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') };

  const supplierInvoices = new Map<string, Record<string, unknown>>();
  const journalEntries = new Map<string, Record<string, unknown>>();
  let invoiceSeq = 0;
  let journalSeq = 0;

  function findItem(itemId: string): Record<string, unknown> | null {
    for (const invoice of supplierInvoices.values()) {
      const items = invoice.items as Record<string, unknown>[];
      const item = items.find((i) => i.id === itemId);
      if (item) return item;
    }
    return null;
  }

  const tx = {
    supplierInvoice: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { supplierId_idempotencyKey?: { supplierId: string; idempotencyKey: string } };
        }) => {
          const key = where.supplierId_idempotencyKey;
          if (!key) return null;
          for (const row of supplierInvoices.values()) {
            if (row.supplierId === key.supplierId && row.idempotencyKey === key.idempotencyKey) {
              return row;
            }
          }
          return null;
        },
      ),
      findFirst: jest.fn(async ({ where }: { where: { id: string; organisationId: string } }) => {
        const row = supplierInvoices.get(where.id);
        if (!row || row.organisationId !== where.organisationId) return null;
        return row;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        invoiceSeq += 1;
        const id = `sinv-${invoiceSeq}`;
        const itemsInput = (data.items as { create: Record<string, unknown>[] }).create;
        const items = itemsInput.map((item, index) => ({
          id: `sinvi-${id}-${index}`,
          supplierInvoiceId: id,
          recognizedAmount: 0,
          varianceAmount: 0,
          ...item,
        }));
        const row: Record<string, unknown> = {
          status: SupplierInvoiceStatus.DRAFT,
          matchStatus: null,
          recognizedAmount: 0,
          varianceAmount: 0,
          amountPaid: 0,
          amountCredited: 0,
          postIdempotencyKey: null,
          ...data,
          id,
          items,
        };
        supplierInvoices.set(id, row);
        return row;
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = supplierInvoices.get(where.id);
          if (!row) throw new Error('supplier invoice not found');
          Object.assign(row, data);
          return row;
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; organisationId?: string; status?: { in: SupplierInvoiceStatus[] } };
          data: Record<string, unknown>;
        }) => {
          const row = supplierInvoices.get(where.id);
          if (!row) return { count: 0 };
          if (where.organisationId && row.organisationId !== where.organisationId)
            return { count: 0 };
          if (where.status && !where.status.in.includes(row.status as SupplierInvoiceStatus)) {
            return { count: 0 };
          }
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const row = supplierInvoices.get(where.id);
        if (!row) throw new Error('supplier invoice not found');
        return row;
      }),
    },
    supplierInvoiceItem: {
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const item = findItem(where.id);
          if (!item) throw new Error('supplier invoice item not found');
          Object.assign(item, data);
          return item;
        },
      ),
    },
    goodsReceiptItem: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: {
            id: { in: string[] };
            goodsReceipt: { organisationId: string; supplierId: string };
          };
        }) => {
          return [...goodsReceiptItems.values()].filter(
            (row) =>
              where.id.in.includes(row.id) &&
              row.goodsReceipt.organisationId === where.goodsReceipt.organisationId &&
              row.goodsReceipt.supplierId === where.goodsReceipt.supplierId,
          );
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { invoicedQuantity: { increment: number } };
        }) => {
          const row = goodsReceiptItems.get(where.id);
          if (!row) throw new Error('goods receipt item not found');
          row.invoicedQuantity += data.invoicedQuantity.increment;
          return row;
        },
      ),
    },
    chartOfAccount: {
      findMany: jest.fn(
        async ({ where }: { where: { id: { in: string[] }; organisationId: string } }) => {
          return [...accounts.values()].filter(
            (a) => where.id.in.includes(a.id) && a.organisationId === where.organisationId,
          );
        },
      ),
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { systemKey?: string; id?: string; organisationId: string };
        }) => {
          if (where.systemKey) {
            return (
              [...accounts.values()].find(
                (a) => a.systemKey === where.systemKey && a.organisationId === where.organisationId,
              ) ?? null
            );
          }
          if (where.id) {
            return (
              [...accounts.values()].find(
                (a) => a.id === where.id && a.organisationId === where.organisationId,
              ) ?? null
            );
          }
          return null;
        },
      ),
    },
    accountingPeriod: {
      findFirst: jest.fn(
        async ({ where }: { where: { startDate: { lte: Date }; endDate: { gte: Date } } }) => {
          if (!openPeriod) return null;
          if (where.startDate.lte < openPeriod.startDate) return null;
          if (where.endDate.gte > openPeriod.endDate) return null;
          return { id: 'period-1' };
        },
      ),
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
            organisationId_journalNumber?: { organisationId: string; journalNumber: string };
          };
        }) => {
          if (where.organisationId_sourceType_sourceId) {
            const key = where.organisationId_sourceType_sourceId;
            for (const entry of journalEntries.values()) {
              if (
                entry.organisationId === key.organisationId &&
                entry.sourceType === key.sourceType &&
                entry.sourceId === key.sourceId
              ) {
                const lines =
                  (entry.lines as { create: Record<string, unknown>[] } | undefined)?.create ?? [];
                return { ...entry, lines };
              }
            }
            return null;
          }
          // `organisationId_journalNumber` — the sequence generator's uniqueness
          // check; every test starts with a fresh, empty journal sequence.
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        journalSeq += 1;
        const id = `journal-${journalSeq}`;
        const entry = {
          id,
          journalNumber: `JE-${String(journalSeq).padStart(6, '0')}`,
          status: 'POSTED',
          postedAt: new Date(),
          ...data,
        };
        journalEntries.set(id, entry);
        return entry;
      }),
    },
  };

  return { tx, supplierInvoices, goodsReceiptItems, accounts, journalEntries };
}

function makePrisma(fakeTx: ReturnType<typeof makeFakeTx>['tx']) {
  return {
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx)),
    // `findById`/`void`/`acknowledgeDiscrepancy` call `this.prisma.supplierInvoice.*`
    // directly (outside any transaction) — delegate to the same shared map the
    // transactional methods mutate, same convention as `supplier-return.repository.spec.ts`.
    supplierInvoice: fakeTx.supplierInvoice,
  } as unknown as PrismaService;
}

function setup(options: Parameters<typeof makeFakeTx>[0] = {}) {
  const fake = makeFakeTx(options);
  const repository = new SupplierInvoiceRepository(makePrisma(fake.tx));
  return { repository, ...fake };
}

function baseCreateData(
  overrides: Partial<CreateSupplierInvoiceData> = {},
): CreateSupplierInvoiceData {
  return {
    organisationId: 'org-1',
    supplierId: 'supplier-1',
    purchaseOrderId: 'po-1',
    invoiceNumber: 'INV-0001',
    invoiceDate: new Date('2026-08-25'),
    dueDate: new Date('2026-09-25'),
    paymentTerms: PaymentTermType.NET_30,
    currency: 'NGN',
    createdById: 'user-1',
    items: [],
    ...overrides,
  };
}

describe('SupplierInvoiceRepository (deliberate exception — real transaction logic under test)', () => {
  describe('create()', () => {
    it('creates a DRAFT invoice with computed subtotal/total', async () => {
      const { repository } = setup();

      const result = await repository.create(
        baseCreateData({
          items: [{ quantity: 1000, unitPrice: 1000, goodsReceiptItemId: 'gri-1' }],
        }),
      );

      expect(result.wasCreated).toBe(true);
      expect(result.supplierInvoice.status).toBe(SupplierInvoiceStatus.DRAFT);
      expect(result.supplierInvoice.subtotal).toBe(1_000_000);
      expect(result.supplierInvoice.total).toBe(1_000_000);
    });

    it('an idempotent replay returns the original row without creating a second one', async () => {
      const { repository, supplierInvoices } = setup();
      const input = baseCreateData({
        idempotencyKey: 'key-1',
        items: [{ quantity: 1000, unitPrice: 1000, goodsReceiptItemId: 'gri-1' }],
      });

      const first = await repository.create(input);
      const second = await repository.create(input);

      expect(first.wasCreated).toBe(true);
      expect(second.wasCreated).toBe(false);
      expect(second.supplierInvoice.id).toBe(first.supplierInvoice.id);
      expect(supplierInvoices.size).toBe(1);
    });
  });

  describe('post() — Scenario A: normal purchase, full match', () => {
    it('recognizes the full amount and posts no journal entry (Path A only)', async () => {
      const { repository, goodsReceiptItems, journalEntries } = setup();
      const { supplierInvoice } = await repository.create(
        baseCreateData({
          items: [{ quantity: 1000, unitPrice: 1000, goodsReceiptItemId: 'gri-1' }],
        }),
      );

      const result = await repository.post('org-1', supplierInvoice.id, 'user-1');

      expect(result.supplierInvoice.status).toBe(SupplierInvoiceStatus.POSTED);
      expect(result.supplierInvoice.matchStatus).toBe('MATCHED');
      expect(result.supplierInvoice.recognizedAmount).toBe(1_000_000);
      expect(result.supplierInvoice.varianceAmount).toBe(0);
      expect(result.journalEntry).toBeNull();
      expect(journalEntries.size).toBe(0);
      expect(goodsReceiptItems.get('gri-1')!.invoicedQuantity).toBe(1000);
    });
  });

  describe('post() — Scenario C: supplier over-invoices the excess', () => {
    it('caps recognizedAmount at the payable value and flags a DISCREPANCY, never inflating AP', async () => {
      const { repository, goodsReceiptItems } = setup({
        // accepted 1050 / payable 1000 (the over-supply GRN from Sprint 8/11).
        goodsReceiptItems: new Map([['gri-1', makeGoodsReceiptItem({ payableQuantity: 1000 })]]),
      });
      const { supplierInvoice } = await repository.create(
        baseCreateData({
          items: [{ quantity: 1050, unitPrice: 1000, goodsReceiptItemId: 'gri-1' }],
        }),
      );

      const result = await repository.post('org-1', supplierInvoice.id, 'user-1');

      expect(result.supplierInvoice.total).toBe(1_050_000);
      expect(result.supplierInvoice.recognizedAmount).toBe(1_000_000);
      expect(result.supplierInvoice.varianceAmount).toBe(50_000);
      expect(result.supplierInvoice.matchStatus).toBe('DISCREPANCY');
      expect(result.journalEntry).toBeNull();
      // GRNI is never touched by an invoice — only invoicedQuantity, capped at payable.
      expect(goodsReceiptItems.get('gri-1')!.invoicedQuantity).toBe(1000);
    });
  });

  describe('post() — Scenario D: partial invoice, then completing the remainder', () => {
    it('the first partial invoice recognizes exactly what it claims', async () => {
      const { repository, goodsReceiptItems } = setup();
      const { supplierInvoice } = await repository.create(
        baseCreateData({
          invoiceNumber: 'INV-0001',
          items: [{ quantity: 600, unitPrice: 1000, goodsReceiptItemId: 'gri-1' }],
        }),
      );

      const result = await repository.post('org-1', supplierInvoice.id, 'user-1');

      expect(result.supplierInvoice.recognizedAmount).toBe(600_000);
      expect(result.supplierInvoice.matchStatus).toBe('MATCHED');
      expect(goodsReceiptItems.get('gri-1')!.invoicedQuantity).toBe(600);
    });

    it('a second invoice against the same line correctly settles the remainder', async () => {
      const { repository, goodsReceiptItems } = setup();
      const first = await repository.create(
        baseCreateData({
          invoiceNumber: 'INV-0001',
          items: [{ quantity: 600, unitPrice: 1000, goodsReceiptItemId: 'gri-1' }],
        }),
      );
      await repository.post('org-1', first.supplierInvoice.id, 'user-1');

      const second = await repository.create(
        baseCreateData({
          invoiceNumber: 'INV-0002',
          items: [{ quantity: 400, unitPrice: 1000, goodsReceiptItemId: 'gri-1' }],
        }),
      );
      const result = await repository.post('org-1', second.supplierInvoice.id, 'user-1');

      expect(result.supplierInvoice.recognizedAmount).toBe(400_000);
      expect(result.supplierInvoice.varianceAmount).toBe(0);
      expect(result.supplierInvoice.matchStatus).toBe('MATCHED');
      expect(goodsReceiptItems.get('gri-1')!.invoicedQuantity).toBe(1000);
    });

    it('a third invoice against an already-fully-invoiced line recognizes nothing and flags DISCREPANCY', async () => {
      const { repository } = setup();
      const first = await repository.create(
        baseCreateData({
          invoiceNumber: 'INV-0001',
          items: [{ quantity: 1000, unitPrice: 1000, goodsReceiptItemId: 'gri-1' }],
        }),
      );
      await repository.post('org-1', first.supplierInvoice.id, 'user-1');

      const second = await repository.create(
        baseCreateData({
          invoiceNumber: 'INV-0002',
          items: [{ quantity: 100, unitPrice: 1000, goodsReceiptItemId: 'gri-1' }],
        }),
      );
      const result = await repository.post('org-1', second.supplierInvoice.id, 'user-1');

      expect(result.supplierInvoice.recognizedAmount).toBe(0);
      expect(result.supplierInvoice.varianceAmount).toBe(100_000);
      expect(result.supplierInvoice.matchStatus).toBe('DISCREPANCY');
    });
  });

  describe('post() — Path B (no Goods Receipt reference)', () => {
    it('recognizes the line in full and posts DR <debit account> / CR AP', async () => {
      const { repository, journalEntries } = setup();
      const { supplierInvoice } = await repository.create(
        baseCreateData({
          purchaseOrderId: undefined,
          items: [
            {
              quantity: 1,
              unitPrice: 50_000,
              description: 'Freight',
              debitAccountId: 'account-freight',
            },
          ],
        }),
      );

      const result = await repository.post('org-1', supplierInvoice.id, 'user-1');

      expect(result.supplierInvoice.recognizedAmount).toBe(50_000);
      expect(result.supplierInvoice.matchStatus).toBe('UNVERIFIED');
      expect(result.journalEntry).not.toBeNull();
      expect(result.journalEntry!.totalAmount).toBe(50_000);
      const entry = [...journalEntries.values()][0]!;
      expect(
        (entry.lines as { create: { accountId: string; debit: number; credit: number }[] }).create,
      ).toEqual([
        { accountId: 'account-freight', debit: 50_000, credit: 0, description: undefined },
        { accountId: 'account-ap', debit: 0, credit: 50_000, description: undefined },
      ]);
    });

    it('rejects a debit account that is a system account', async () => {
      const { repository } = setup();
      const { supplierInvoice } = await repository.create(
        baseCreateData({
          purchaseOrderId: undefined,
          items: [{ quantity: 1, unitPrice: 1000, debitAccountId: 'account-system-expense' }],
        }),
      );

      await expect(repository.post('org-1', supplierInvoice.id, 'user-1')).rejects.toThrow(
        InvalidDebitAccountError,
      );
    });

    it('rejects a debit account whose type is not Asset/Expense', async () => {
      const { repository } = setup();
      const { supplierInvoice } = await repository.create(
        baseCreateData({
          purchaseOrderId: undefined,
          items: [{ quantity: 1, unitPrice: 1000, debitAccountId: 'account-liability' }],
        }),
      );

      await expect(repository.post('org-1', supplierInvoice.id, 'user-1')).rejects.toThrow(
        InvalidDebitAccountError,
      );
    });

    it('rejects a debit account belonging to another organisation', async () => {
      const { repository } = setup();
      const { supplierInvoice } = await repository.create(
        baseCreateData({
          purchaseOrderId: undefined,
          items: [{ quantity: 1, unitPrice: 1000, debitAccountId: 'account-other-org' }],
        }),
      );

      await expect(repository.post('org-1', supplierInvoice.id, 'user-1')).rejects.toThrow(
        InvalidDebitAccountError,
      );
    });

    it('rejects a line with neither a Goods Receipt reference nor a debit account', async () => {
      const { repository } = setup();
      const { supplierInvoice } = await repository.create(
        baseCreateData({
          purchaseOrderId: undefined,
          items: [{ quantity: 1, unitPrice: 1000 }],
        }),
      );

      await expect(repository.post('org-1', supplierInvoice.id, 'user-1')).rejects.toThrow(
        MissingLineReferenceError,
      );
    });
  });

  describe('post() — a mixed Path A + Path B invoice', () => {
    it('sums recognizedAmount across both paths, posts a journal only for the Path B portion, and derives matchStatus from Path A lines only', async () => {
      const { repository, journalEntries } = setup();
      const { supplierInvoice } = await repository.create(
        baseCreateData({
          items: [
            { quantity: 1000, unitPrice: 1000, goodsReceiptItemId: 'gri-1' },
            {
              quantity: 1,
              unitPrice: 25_000,
              description: 'Freight',
              debitAccountId: 'account-freight',
            },
          ],
        }),
      );

      const result = await repository.post('org-1', supplierInvoice.id, 'user-1');

      expect(result.supplierInvoice.recognizedAmount).toBe(1_025_000);
      expect(result.supplierInvoice.matchStatus).toBe('MATCHED');
      expect(result.journalEntry!.totalAmount).toBe(25_000);
      expect(journalEntries.size).toBe(1);
    });
  });

  describe('post() — Goods Receipt reference validation', () => {
    it('rejects a goodsReceiptItemId that does not belong to this supplier', async () => {
      const { repository } = setup({
        goodsReceiptItems: new Map([
          [
            'gri-1',
            makeGoodsReceiptItem({
              goodsReceipt: { organisationId: 'org-1', supplierId: 'supplier-2' },
            }),
          ],
        ]),
      });
      const { supplierInvoice } = await repository.create(
        baseCreateData({
          items: [{ quantity: 100, unitPrice: 1000, goodsReceiptItemId: 'gri-1' }],
        }),
      );

      await expect(repository.post('org-1', supplierInvoice.id, 'user-1')).rejects.toThrow(
        InvalidGoodsReceiptReferenceError,
      );
    });
  });

  describe('post() — status and idempotency guards', () => {
    it('rejects posting an invoice that is not DRAFT', async () => {
      const { repository } = setup();
      const { supplierInvoice } = await repository.create(
        baseCreateData({
          items: [{ quantity: 1000, unitPrice: 1000, goodsReceiptItemId: 'gri-1' }],
        }),
      );
      await repository.post('org-1', supplierInvoice.id, 'user-1');

      await expect(repository.post('org-1', supplierInvoice.id, 'user-1')).rejects.toThrow(
        SupplierInvoiceConflictError,
      );
    });

    it('an idempotent post() replay returns the already-posted result without reprocessing', async () => {
      const { repository, goodsReceiptItems } = setup();
      const { supplierInvoice } = await repository.create(
        baseCreateData({
          items: [{ quantity: 1000, unitPrice: 1000, goodsReceiptItemId: 'gri-1' }],
        }),
      );

      const first = await repository.post('org-1', supplierInvoice.id, 'user-1', 'post-key-1');
      const second = await repository.post('org-1', supplierInvoice.id, 'user-1', 'post-key-1');

      expect(first.wasCreated).toBe(true);
      expect(second.wasCreated).toBe(false);
      expect(second.supplierInvoice.recognizedAmount).toBe(1_000_000);
      // Only processed once — a replay must not double-increment invoicedQuantity.
      expect(goodsReceiptItems.get('gri-1')!.invoicedQuantity).toBe(1000);
    });

    it('a closed accounting period rejects the post with NoOpenPeriodError and posts no journal (Path B)', async () => {
      const { repository, journalEntries } = setup({ openPeriod: null });
      const { supplierInvoice } = await repository.create(
        baseCreateData({
          purchaseOrderId: undefined,
          items: [{ quantity: 1, unitPrice: 1000, debitAccountId: 'account-freight' }],
        }),
      );

      await expect(repository.post('org-1', supplierInvoice.id, 'user-1')).rejects.toThrow(
        NoOpenPeriodError,
      );
      expect(journalEntries.size).toBe(0);
    });

    it('a closed accounting period rejects a Path A-only post as well', async () => {
      const { repository, journalEntries } = setup({ openPeriod: null });
      const { supplierInvoice } = await repository.create(
        baseCreateData({
          items: [{ quantity: 1000, unitPrice: 1000, goodsReceiptItemId: 'gri-1' }],
        }),
      );

      await expect(repository.post('org-1', supplierInvoice.id, 'user-1')).rejects.toThrow(
        NoOpenPeriodError,
      );
      expect(journalEntries.size).toBe(0);
    });
  });

  describe('void()', () => {
    it('transitions a DRAFT invoice to VOID', async () => {
      const { repository } = setup();
      const { supplierInvoice } = await repository.create(
        baseCreateData({
          items: [{ quantity: 1000, unitPrice: 1000, goodsReceiptItemId: 'gri-1' }],
        }),
      );

      const result = await repository.void(
        'org-1',
        supplierInvoice.id,
        [SupplierInvoiceStatus.DRAFT],
        'user-1',
      );

      expect(result!.status).toBe(SupplierInvoiceStatus.VOID);
    });

    it('returns null when the current status is not in the allowed set', async () => {
      const { repository } = setup();
      const { supplierInvoice } = await repository.create(
        baseCreateData({
          items: [{ quantity: 1000, unitPrice: 1000, goodsReceiptItemId: 'gri-1' }],
        }),
      );
      await repository.post('org-1', supplierInvoice.id, 'user-1');

      const result = await repository.void(
        'org-1',
        supplierInvoice.id,
        [SupplierInvoiceStatus.DRAFT],
        'user-1',
      );

      expect(result).toBeNull();
    });
  });

  describe('tenant isolation', () => {
    it('findById never returns another organisation’s invoice', async () => {
      const { repository } = setup();
      const { supplierInvoice } = await repository.create(
        baseCreateData({
          items: [{ quantity: 1000, unitPrice: 1000, goodsReceiptItemId: 'gri-1' }],
        }),
      );

      expect(await repository.findById('org-2', supplierInvoice.id)).toBeNull();
      expect(await repository.findById('org-1', supplierInvoice.id)).not.toBeNull();
    });
  });
});
