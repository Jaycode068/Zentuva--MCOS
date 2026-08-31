import { CustomerReturnStatus, InvoiceStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  CustomerReturnConflictError,
  CustomerReturnRepository,
  DispositionMismatchError,
  NoEligibleInvoiceError,
  OverReturnError,
  ReceiveCustomerReturnData,
} from './customer-return.repository';

/**
 * A deliberate exception to this codebase's "no repository-level unit tests for atomic
 * transactions" convention — same justification as `goods-receipt.repository.spec.ts`/
 * `credit-note.repository.spec.ts`: the COGS reversal and Credit Note issuance are
 * money-correctness logic worth verifying against the real `create()`/`receive()`
 * transaction callbacks, not a re-implementation of them. Combines the in-memory fake
 * `tx` technique both those files already established.
 */
const PRODUCT = { id: 'product-1', code: 'PRD-000027', name: 'Plantain Chips 500g', unit: 'Pack' };

function makeFakeTx(options: {
  fulfilmentItems: Map<string, Record<string, unknown>>;
  invoices?: Map<string, Record<string, unknown>>;
  accounts?: Record<string, string>;
  openPeriod?: { startDate: Date; endDate: Date } | null;
}) {
  const fulfilmentItems = options.fulfilmentItems;
  const invoices = options.invoices ?? new Map<string, Record<string, unknown>>();
  const customerReturns = new Map<string, Record<string, unknown>>();
  const inventoryStocks = new Map<string, { quantityOnHand: number; averageUnitCost: number }>();
  const inventoryTransactions: Record<string, unknown>[] = [];
  const journalEntries = new Map<string, Record<string, unknown>>();
  const creditNotes = new Map<string, Record<string, unknown>>();
  const accounts = options.accounts ?? {
    FINISHED_GOODS_INVENTORY: 'account-fgi',
    COGS: 'account-cogs',
    SALES_RETURNS: 'account-sales-returns',
    AR: 'account-ar',
  };
  // Relative to "now" (not a hardcoded calendar month) so this fixture never
  // goes stale purely because the real clock crossed a fixed month boundary.
  const openPeriod =
    'openPeriod' in options
      ? options.openPeriod
      : { startDate: new Date(2000, 0, 1), endDate: new Date(2100, 0, 1) };
  let returnSeq = 0;
  let journalSeq = 0;
  let creditNoteSeq = 0;

  function attachReturnRelations(row: Record<string, unknown>) {
    return {
      ...row,
      customer: { id: row.customerId, customerCode: 'CUS-000001', customerName: 'Boby Bites' },
      outlet: null,
      salesOrder: { id: row.salesOrderId, orderCode: 'SO-000006' },
      location: { id: row.locationId, name: 'Main Warehouse' },
    };
  }

  const tx = {
    customerReturn: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            salesOrderId_idempotencyKey?: { salesOrderId: string; idempotencyKey: string };
          };
        }) => {
          const key = where.salesOrderId_idempotencyKey;
          if (!key) return null;
          for (const row of customerReturns.values()) {
            if (
              row.salesOrderId === key.salesOrderId &&
              row.idempotencyKey === key.idempotencyKey
            ) {
              return row;
            }
          }
          return null;
        },
      ),
      findFirst: jest.fn(async ({ where }: { where: { id: string; organisationId: string } }) => {
        const row = customerReturns.get(where.id);
        if (!row || row.organisationId !== where.organisationId) return null;
        return row;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        returnSeq += 1;
        const id = `ret-${returnSeq}`;
        const itemsInput = (data.items as { create: Record<string, unknown>[] }).create;
        const items = itemsInput.map((item, index) => ({
          id: `reti-${id}-${index}`,
          customerReturnId: id,
          quantityResalable: 0,
          quantityDamaged: 0,
          quantityQuarantine: 0,
          quantityScrap: 0,
          quantityCredited: 0,
          ...item,
          product: PRODUCT,
        }));
        const row = {
          id,
          status: CustomerReturnStatus.REQUESTED,
          receivedAt: null,
          receivedById: null,
          receivedIdempotencyKey: null,
          photoUrl: null,
          photoKey: null,
          ...data,
          items,
        };
        delete (row as { items?: unknown }).items;
        const stored = { ...row, items };
        customerReturns.set(id, attachReturnRelations(stored));
        return customerReturns.get(id);
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = customerReturns.get(where.id);
          if (!existing) throw new Error('customer return not found');
          const updated = attachReturnRelations({ ...existing, ...data });
          customerReturns.set(where.id, updated);
          return updated;
        },
      ),
    },
    customerReturnItem: {
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          for (const returnRow of customerReturns.values()) {
            const items = returnRow.items as Record<string, unknown>[];
            const item = items.find((row) => row.id === where.id);
            if (item) {
              Object.assign(item, data);
              return item;
            }
          }
          throw new Error('customer return item not found');
        },
      ),
    },
    salesFulfilmentItem: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: {
            id: { in: string[] };
            salesFulfilment: { organisationId: string; salesOrderId: string };
          };
        }) => {
          return [...fulfilmentItems.values()].filter((row) => {
            const fulfilment = row.salesFulfilment as {
              organisationId: string;
              salesOrderId: string;
            };
            return (
              where.id.in.includes(row.id as string) &&
              fulfilment.organisationId === where.salesFulfilment.organisationId &&
              fulfilment.salesOrderId === where.salesFulfilment.salesOrderId
            );
          });
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { quantityReturned: { increment?: number; decrement?: number } };
        }) => {
          const row = fulfilmentItems.get(where.id);
          if (!row) throw new Error('fulfilment item not found');
          const current = row.quantityReturned as number;
          const delta = data.quantityReturned.increment ?? -(data.quantityReturned.decrement ?? 0);
          row.quantityReturned = current + delta;
          return row;
        },
      ),
    },
    inventoryStock: {
      findUnique: jest.fn(async ({ where }: { where: unknown }) => {
        return inventoryStocks.get(JSON.stringify(where)) ?? null;
      }),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: unknown;
          create: { quantityOnHand: number; averageUnitCost?: number };
          update: { quantityOnHand: number; averageUnitCost?: number };
        }) => {
          const key = JSON.stringify(where);
          const existing = inventoryStocks.get(key);
          if (existing) {
            existing.quantityOnHand = update.quantityOnHand;
            existing.averageUnitCost = update.averageUnitCost ?? existing.averageUnitCost;
            return existing;
          }
          const created = {
            quantityOnHand: create.quantityOnHand,
            averageUnitCost: create.averageUnitCost ?? 0,
          };
          inventoryStocks.set(key, created);
          return created;
        },
      ),
    },
    inventoryTransaction: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        inventoryTransactions.push(data);
        return data;
      }),
    },
    invoice: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: {
            id?: string;
            organisationId: string;
            salesOrderId?: string;
            customerId?: string;
            status: { in: InvoiceStatus[] };
          };
        }) => {
          const eligible = [...invoices.values()]
            .filter((row) => {
              if (where.id && row.id !== where.id) return false;
              if (row.organisationId !== where.organisationId) return false;
              if (where.salesOrderId && row.salesOrderId !== where.salesOrderId) return false;
              if (where.customerId && row.customerId !== where.customerId) return false;
              return where.status.in.includes(row.status as InvoiceStatus);
            })
            .sort((a, b) => (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime());
          return eligible[0] ?? null;
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = invoices.get(where.id);
          if (!row) throw new Error('invoice not found');
          Object.assign(row, data);
          return row;
        },
      ),
    },
    creditNote: {
      count: jest.fn(async () => creditNotes.size),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        creditNoteSeq += 1;
        const id = `cn-${creditNoteSeq}`;
        const row = { id, status: 'DRAFT', ...data };
        creditNotes.set(id, row);
        return row;
      }),
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: {
            id?: string;
            organisationId: string;
            sourceType?: string;
            sourceId?: string;
          };
        }) => {
          if (where.id) {
            const row = creditNotes.get(where.id);
            if (!row || row.organisationId !== where.organisationId) return null;
            return row;
          }
          for (const row of creditNotes.values()) {
            if (
              row.organisationId === where.organisationId &&
              row.sourceType === where.sourceType &&
              row.sourceId === where.sourceId
            ) {
              return row;
            }
          }
          return null;
        },
      ),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const row = creditNotes.get(where.id);
          if (!row) throw new Error('credit note not found');
          Object.assign(row, data);
          const invoice = row.invoiceId ? invoices.get(row.invoiceId as string) : null;
          return {
            ...row,
            customer: {
              id: row.customerId,
              customerCode: 'CUS-000001',
              customerName: 'Boby Bites',
            },
            invoice: invoice ? { id: invoice.id, invoiceCode: invoice.invoiceCode } : null,
          };
        },
      ),
    },
    chartOfAccount: {
      findFirst: jest.fn(async ({ where }: { where: { systemKey: string } }) => {
        const id = accounts[where.systemKey];
        return id ? { id, systemKey: where.systemKey } : null;
      }),
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
              const lines =
                (entry.lines as { create: { debit: number }[] } | undefined)?.create ?? [];
              return { ...entry, lines };
            }
          }
          return null;
        },
      ),
      count: jest.fn(async () => journalEntries.size),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        journalSeq += 1;
        const id = `journal-${journalSeq}`;
        const entry = { id, status: 'POSTED', postedAt: new Date(), ...data };
        journalEntries.set(id, entry);
        return entry;
      }),
    },
  };

  return {
    tx,
    customerReturns,
    inventoryStocks,
    inventoryTransactions,
    journalEntries,
    creditNotes,
    invoices,
  };
}

function makePrisma(fakeTx: ReturnType<typeof makeFakeTx>['tx']) {
  return {
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx)),
    // `findById`/`findByIdempotencyKey` call `this.prisma.customerReturn.*` directly
    // (outside any transaction) — delegate to the same fake, which closes over the
    // same shared `customerReturns` map the transactional methods mutate.
    customerReturn: fakeTx.customerReturn,
  } as unknown as PrismaService;
}

function makeFulfilmentItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sfi-1',
    productId: 'product-1',
    quantityFulfilled: 10,
    quantityReturned: 0,
    unitCost: 500,
    salesOrderItem: { unitPrice: 800 },
    salesFulfilment: { organisationId: 'org-1', salesOrderId: 'so-1' },
    ...overrides,
  };
}

function makeEligibleInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    organisationId: 'org-1',
    salesOrderId: 'so-1',
    customerId: 'cust-1',
    status: InvoiceStatus.ISSUED,
    currency: 'NGN',
    total: 8000,
    amountPaid: 0,
    amountCredited: 0,
    invoiceCode: 'INV-000001',
    createdAt: new Date('2026-08-10'),
    ...overrides,
  };
}

describe('CustomerReturnRepository (deliberate exception — real transaction logic under test)', () => {
  function setup(
    options: {
      fulfilmentItems?: Map<string, Record<string, unknown>>;
      invoices?: Map<string, Record<string, unknown>>;
      openPeriod?: { startDate: Date; endDate: Date } | null;
    } = {},
  ) {
    const fulfilmentItems = options.fulfilmentItems ?? new Map([['sfi-1', makeFulfilmentItem()]]);
    const invoices = options.invoices ?? new Map([['inv-1', makeEligibleInvoice()]]);
    const fake = makeFakeTx({
      fulfilmentItems,
      invoices,
      ...('openPeriod' in options ? { openPeriod: options.openPeriod } : {}),
    });
    const repository = new CustomerReturnRepository(makePrisma(fake.tx));
    return { repository, fulfilmentItems, ...fake };
  }

  describe('create (request step)', () => {
    it('creates a return and reserves the returned quantity on the fulfilment line', async () => {
      const { repository, fulfilmentItems } = setup();

      const result = await repository.create({
        organisationId: 'org-1',
        returnCode: 'RET-000001',
        customerId: 'cust-1',
        salesOrderId: 'so-1',
        locationId: 'loc-1',
        returnDate: new Date('2026-08-20'),
        reason: 'DAMAGED',
        createdById: 'user-1',
        items: [{ salesFulfilmentItemId: 'sfi-1', quantityReturned: 4 }],
      });

      expect(result.wasCreated).toBe(true);
      expect(result.customerReturn.status).toBe(CustomerReturnStatus.REQUESTED);
      expect(result.customerReturn.items[0]!.unitCost).toBe(500);
      expect(result.customerReturn.items[0]!.unitPrice).toBe(800);
      expect(fulfilmentItems.get('sfi-1')!.quantityReturned).toBe(4);
    });

    it('rejects a request that exceeds the eligible remaining quantity', async () => {
      const { repository } = setup({
        fulfilmentItems: new Map([['sfi-1', makeFulfilmentItem({ quantityFulfilled: 10 })]]),
      });

      await expect(
        repository.create({
          organisationId: 'org-1',
          returnCode: 'RET-000001',
          customerId: 'cust-1',
          salesOrderId: 'so-1',
          locationId: 'loc-1',
          returnDate: new Date('2026-08-20'),
          reason: 'DAMAGED',
          createdById: 'user-1',
          items: [{ salesFulfilmentItemId: 'sfi-1', quantityReturned: 11 }],
        }),
      ).rejects.toThrow(OverReturnError);
    });

    it('a duplicate idempotent request returns the original result without double-reserving', async () => {
      const { repository, fulfilmentItems } = setup();
      const input = {
        organisationId: 'org-1',
        returnCode: 'RET-000001',
        customerId: 'cust-1',
        salesOrderId: 'so-1',
        locationId: 'loc-1',
        returnDate: new Date('2026-08-20'),
        reason: 'DAMAGED' as const,
        createdById: 'user-1',
        idempotencyKey: 'key-1',
        items: [{ salesFulfilmentItemId: 'sfi-1', quantityReturned: 4 }],
      };

      const first = await repository.create(input);
      const second = await repository.create(input);

      expect(first.wasCreated).toBe(true);
      expect(second.wasCreated).toBe(false);
      expect(second.customerReturn.id).toBe(first.customerReturn.id);
      expect(fulfilmentItems.get('sfi-1')!.quantityReturned).toBe(4);
    });

    it('tenant isolation: findById never returns another organisation’s return', async () => {
      const { repository } = setup();
      const created = await repository.create({
        organisationId: 'org-1',
        returnCode: 'RET-000001',
        customerId: 'cust-1',
        salesOrderId: 'so-1',
        locationId: 'loc-1',
        returnDate: new Date('2026-08-20'),
        reason: 'DAMAGED',
        createdById: 'user-1',
        items: [{ salesFulfilmentItemId: 'sfi-1', quantityReturned: 4 }],
      });

      expect(await repository.findById('org-2', created.customerReturn.id)).toBeNull();
      expect(await repository.findById('org-1', created.customerReturn.id)).not.toBeNull();
    });
  });

  describe('cancel', () => {
    it('releases the reserved quantity and marks the return cancelled', async () => {
      const { repository, fulfilmentItems } = setup();
      const created = await repository.create({
        organisationId: 'org-1',
        returnCode: 'RET-000001',
        customerId: 'cust-1',
        salesOrderId: 'so-1',
        locationId: 'loc-1',
        returnDate: new Date('2026-08-20'),
        reason: 'DAMAGED',
        createdById: 'user-1',
        items: [{ salesFulfilmentItemId: 'sfi-1', quantityReturned: 4 }],
      });

      const cancelled = await repository.cancel('org-1', created.customerReturn.id);

      expect(cancelled!.status).toBe(CustomerReturnStatus.CANCELLED);
      expect(fulfilmentItems.get('sfi-1')!.quantityReturned).toBe(0);
    });

    it('rejects cancelling a return that is not REQUESTED', async () => {
      const { repository } = setup();
      const created = await repository.create({
        organisationId: 'org-1',
        returnCode: 'RET-000001',
        customerId: 'cust-1',
        salesOrderId: 'so-1',
        locationId: 'loc-1',
        returnDate: new Date('2026-08-20'),
        reason: 'DAMAGED',
        createdById: 'user-1',
        items: [{ salesFulfilmentItemId: 'sfi-1', quantityReturned: 4 }],
      });
      await repository.cancel('org-1', created.customerReturn.id);

      await expect(repository.cancel('org-1', created.customerReturn.id)).rejects.toThrow(
        CustomerReturnConflictError,
      );
    });
  });

  describe('receive (the atomic physical + financial event)', () => {
    async function createReturn(
      repository: CustomerReturnRepository,
      quantityReturned = 10,
    ): Promise<string> {
      const created = await repository.create({
        organisationId: 'org-1',
        returnCode: 'RET-000001',
        customerId: 'cust-1',
        salesOrderId: 'so-1',
        locationId: 'loc-1',
        returnDate: new Date('2026-08-20'),
        reason: 'DAMAGED',
        createdById: 'user-1',
        items: [{ salesFulfilmentItemId: 'sfi-1', quantityReturned }],
      });
      return created.customerReturn.id;
    }

    it('Boby Bites scenario: 7 resalable / 3 damaged posts COGS reversal on 7 only and a full credit note for 10', async () => {
      const { repository, inventoryStocks, journalEntries, creditNotes, invoices } = setup();
      const id = await createReturn(repository, 10);

      const result = await repository.receive({
        organisationId: 'org-1',
        customerReturnId: id,
        receivedById: 'user-2',
        items: [
          {
            customerReturnItemId: `reti-ret-1-0`,
            quantityResalable: 7,
            quantityDamaged: 3,
            quantityQuarantine: 0,
            quantityScrap: 0,
          },
        ],
      });

      expect(result.wasCreated).toBe(true);
      expect(result.customerReturn.status).toBe(CustomerReturnStatus.RECEIVED);
      expect(result.journalEntry!.totalAmount).toBe(3_500); // 7 × ₦500
      expect(result.creditNote!.amount).toBe(8_000); // 10 × ₦800, full default credit

      const stock = inventoryStocks.get(
        JSON.stringify({
          organisationId_productId_locationId: {
            organisationId: 'org-1',
            productId: 'product-1',
            locationId: 'loc-1',
          },
        }),
      );
      expect(stock!.quantityOnHand).toBe(7);

      const entry = [...journalEntries.values()].find((e) => e.sourceType === 'CUSTOMER_RETURN');
      expect(
        (entry!.lines as { create: { accountId: string; debit: number; credit: number }[] }).create,
      ).toEqual([
        { accountId: 'account-fgi', description: undefined, debit: 3_500, credit: 0 },
        { accountId: 'account-cogs', description: undefined, debit: 0, credit: 3_500 },
      ]);

      const creditNote = [...creditNotes.values()][0]!;
      expect(creditNote.status).toBe('ISSUED');
      const invoice = invoices.get('inv-1')!;
      expect(invoice.amountCredited).toBe(8_000);
    });

    it('quantityCredited can be overridden independently of the resalable quantity (brief §36)', async () => {
      const { repository } = setup();
      const id = await createReturn(repository, 10);

      const result = await repository.receive({
        organisationId: 'org-1',
        customerReturnId: id,
        receivedById: 'user-2',
        items: [
          {
            customerReturnItemId: `reti-ret-1-0`,
            quantityResalable: 7,
            quantityDamaged: 3,
            quantityQuarantine: 0,
            quantityScrap: 0,
            quantityCredited: 7,
          },
        ],
      });

      expect(result.creditNote!.amount).toBe(5_600); // 7 × ₦800, not the full 10
    });

    it('all-damaged return posts no COGS journal but still credits the customer in full', async () => {
      const { repository, journalEntries } = setup();
      const id = await createReturn(repository, 10);

      const result = await repository.receive({
        organisationId: 'org-1',
        customerReturnId: id,
        receivedById: 'user-2',
        items: [
          {
            customerReturnItemId: `reti-ret-1-0`,
            quantityResalable: 0,
            quantityDamaged: 10,
            quantityQuarantine: 0,
            quantityScrap: 0,
          },
        ],
      });

      expect(result.journalEntry).toBeNull();
      expect(result.creditNote!.amount).toBe(8_000);
      expect([...journalEntries.values()].some((e) => e.sourceType === 'CUSTOMER_RETURN')).toBe(
        false,
      );
    });

    it('rejects a disposition breakdown that does not sum to the returned quantity', async () => {
      const { repository } = setup();
      const id = await createReturn(repository, 10);

      await expect(
        repository.receive({
          organisationId: 'org-1',
          customerReturnId: id,
          receivedById: 'user-2',
          items: [
            {
              customerReturnItemId: `reti-ret-1-0`,
              quantityResalable: 5,
              quantityDamaged: 2,
              quantityQuarantine: 0,
              quantityScrap: 0,
            },
          ],
        }),
      ).rejects.toThrow(DispositionMismatchError);
    });

    it('a duplicate idempotent receive returns the original result without double-posting', async () => {
      const { repository, journalEntries, creditNotes } = setup();
      const id = await createReturn(repository, 10);
      const receiveInput: ReceiveCustomerReturnData = {
        organisationId: 'org-1',
        customerReturnId: id,
        receivedById: 'user-2',
        idempotencyKey: 'receive-key-1',
        items: [
          {
            customerReturnItemId: `reti-ret-1-0`,
            quantityResalable: 7,
            quantityDamaged: 3,
            quantityQuarantine: 0,
            quantityScrap: 0,
          },
        ],
      };

      const first = await repository.receive(receiveInput);
      const second = await repository.receive(receiveInput);

      expect(first.wasCreated).toBe(true);
      expect(second.wasCreated).toBe(false);
      expect(second.journalEntry!.id).toBe(first.journalEntry!.id);
      expect(second.creditNote!.id).toBe(first.creditNote!.id);
      // Two journals per receive() (COGS reversal + the Credit Note's own AR posting)
      // — the replay must not add a third or fourth.
      expect(journalEntries.size).toBe(2);
      expect(creditNotes.size).toBe(1);
    });

    it('rejects receiving when no eligible invoice exists for the sales order', async () => {
      const { repository } = setup({ invoices: new Map() });
      const id = await createReturn(repository, 10);

      await expect(
        repository.receive({
          organisationId: 'org-1',
          customerReturnId: id,
          receivedById: 'user-2',
          items: [
            {
              customerReturnItemId: `reti-ret-1-0`,
              quantityResalable: 7,
              quantityDamaged: 3,
              quantityQuarantine: 0,
              quantityScrap: 0,
            },
          ],
        }),
      ).rejects.toThrow(NoEligibleInvoiceError);
    });

    it('a closed accounting period rejects the receive with NoOpenPeriodError and posts no journal', async () => {
      const { repository, journalEntries } = setup({ openPeriod: null });
      const id = await createReturn(repository, 10);

      await expect(
        repository.receive({
          organisationId: 'org-1',
          customerReturnId: id,
          receivedById: 'user-2',
          items: [
            {
              customerReturnItemId: `reti-ret-1-0`,
              quantityResalable: 7,
              quantityDamaged: 3,
              quantityQuarantine: 0,
              quantityScrap: 0,
            },
          ],
        }),
      ).rejects.toThrow('No open accounting period');

      expect(journalEntries.size).toBe(0);
    });
  });
});
