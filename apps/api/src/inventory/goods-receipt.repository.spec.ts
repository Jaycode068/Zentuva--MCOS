import { DiscrepancyStatus, PurchaseOrderStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  MissingSystemAccountError,
  NoOpenPeriodError,
} from '../finance/accounting/journal-posting';
import {
  GoodsReceiptConflictError,
  GoodsReceiptRepository,
  ReceiveGoodsData,
} from './goods-receipt.repository';

/**
 * A deliberate exception to this codebase's "no repository-level unit tests for atomic
 * transactions" convention — same justification as `payment.repository.spec.ts`/
 * `journal-posting.spec.ts` (Sprint 6/7): the accepted-vs-payable split and its journal
 * construction is money-correctness logic worth verifying against the real
 * `receive()` transaction callback, not a re-implementation of it. Combines the
 * "in-memory fake `tx`" technique both those files already established — the Goods
 * Receipt tables (`goodsReceipt`/`goodsReceiptItem`/`purchaseOrder`/`inventoryStock`/
 * `inventoryTransaction`) plus the same `chartOfAccount`/`accountingPeriod`/
 * `journalEntry` fakes `payment.repository.spec.ts` uses so `postSystemJournalEntry`
 * (a real, unmocked import) succeeds deterministically.
 */
interface FakeGoodsReceiptItem {
  id: string;
  goodsReceiptId: string;
  purchaseOrderItemId: string;
  productId: string;
  deliveredQuantity: number;
  rejectedQuantity: number;
  acceptedQuantity: number;
  payableQuantity: number;
  rejectionReason?: string | null;
  rejectionNotes?: string | null;
}

interface FakeGoodsReceipt {
  id: string;
  organisationId: string;
  purchaseOrderId: string;
  idempotencyKey: string | null;
  goodsReceiptNumber: string;
  supplierId: string;
  locationId: string;
  receivedDate: Date;
  receivedById: string;
  remarks?: string | null;
  discrepancyStatus: DiscrepancyStatus;
  items: FakeGoodsReceiptItem[];
}

const PRODUCT = { id: 'product-1', code: 'PRD-000011', name: 'Raw Plantain', unit: 'Kilogram' };

function makeFakeTx(options: {
  purchaseOrders: Map<string, { id: string; organisationId: string; status: PurchaseOrderStatus }>;
  goodsReceipts?: Map<string, FakeGoodsReceipt>;
  journalEntries?: Map<string, Record<string, unknown>>;
  accounts?: Record<string, string>;
  openPeriod?: { startDate: Date; endDate: Date } | null;
}) {
  const purchaseOrders = options.purchaseOrders;
  const goodsReceipts = options.goodsReceipts ?? new Map<string, FakeGoodsReceipt>();
  const journalEntries = options.journalEntries ?? new Map<string, Record<string, unknown>>();
  const accounts = options.accounts ?? {
    INVENTORY: 'account-inventory',
    AP: 'account-ap',
    GRNI_PENDING_APPROVAL: 'account-grni',
  };
  const openPeriod =
    'openPeriod' in options
      ? options.openPeriod
      : { startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') };
  const inventoryStocks = new Map<string, { quantityOnHand: number }>();
  const inventoryTransactions: Record<string, unknown>[] = [];
  let grSequence = goodsReceipts.size;
  let journalSequence = journalEntries.size;

  const tx = {
    goodsReceipt: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            purchaseOrderId_idempotencyKey?: { purchaseOrderId: string; idempotencyKey: string };
          };
        }) => {
          const key = where.purchaseOrderId_idempotencyKey;
          if (!key) return null;
          for (const receipt of goodsReceipts.values()) {
            if (
              receipt.purchaseOrderId === key.purchaseOrderId &&
              receipt.idempotencyKey === key.idempotencyKey
            ) {
              return receipt;
            }
          }
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        grSequence += 1;
        const id = `gr-${grSequence}`;
        const itemsInput = (
          data.items as { create: Omit<FakeGoodsReceiptItem, 'id' | 'goodsReceiptId'>[] }
        ).create;
        const items = itemsInput.map((item, index) => ({
          id: `gri-${id}-${index}`,
          goodsReceiptId: id,
          ...item,
          product: PRODUCT,
        }));
        const receipt = {
          id,
          organisationId: data.organisationId,
          purchaseOrderId: data.purchaseOrderId,
          idempotencyKey: data.idempotencyKey ?? null,
          goodsReceiptNumber: data.goodsReceiptNumber,
          supplierId: data.supplierId,
          locationId: data.locationId,
          receivedDate: data.receivedDate,
          receivedById: data.receivedById,
          remarks: data.remarks,
          discrepancyStatus: data.discrepancyStatus,
          items,
        } as unknown as FakeGoodsReceipt;
        goodsReceipts.set(id, receipt);
        return receipt;
      }),
    },
    goodsReceiptItem: {
      groupBy: jest.fn(
        async ({
          where,
          _sum,
        }: {
          where: { goodsReceipt: { organisationId: string; purchaseOrderId: string } };
          _sum: Record<string, boolean>;
        }) => {
          const totals = new Map<string, Record<string, number>>();
          for (const receipt of goodsReceipts.values()) {
            if (
              receipt.organisationId !== where.goodsReceipt.organisationId ||
              receipt.purchaseOrderId !== where.goodsReceipt.purchaseOrderId
            ) {
              continue;
            }
            for (const item of receipt.items) {
              const running = totals.get(item.purchaseOrderItemId) ?? {};
              for (const field of Object.keys(_sum)) {
                running[field] =
                  (running[field] ?? 0) + (item as never as Record<string, number>)[field]!;
              }
              totals.set(item.purchaseOrderItemId, running);
            }
          }
          return [...totals.entries()].map(([purchaseOrderItemId, sums]) => {
            const _sumResult: Record<string, number> = {};
            for (const field of Object.keys(_sum)) {
              _sumResult[field] = sums[field] ?? 0;
            }
            return { purchaseOrderItemId, _sum: _sumResult };
          });
        },
      ),
    },
    purchaseOrder: {
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; organisationId: string; status: { notIn: PurchaseOrderStatus[] } };
          data: { status: PurchaseOrderStatus };
        }) => {
          const po = purchaseOrders.get(where.id);
          if (!po || po.organisationId !== where.organisationId) return { count: 0 };
          if (where.status.notIn.includes(po.status)) return { count: 0 };
          po.status = data.status;
          return { count: 1 };
        },
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const po = purchaseOrders.get(where.id);
        if (!po) throw new Error('purchase order not found');
        return po;
      }),
    },
    inventoryStock: {
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: unknown;
          create: { quantityOnHand: number };
          update: { quantityOnHand: { increment: number } };
        }) => {
          const key = JSON.stringify(where);
          const existing = inventoryStocks.get(key);
          if (existing) {
            existing.quantityOnHand += update.quantityOnHand.increment;
            return existing;
          }
          const created = { quantityOnHand: create.quantityOnHand };
          inventoryStocks.set(key, created);
          return created;
        },
      ),
    },
    inventoryTransaction: {
      createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        inventoryTransactions.push(...data);
        return { count: data.length };
      }),
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
                // `GoodsReceiptRepository.findJournalEntry` includes `lines: { select:
                // { debit: true } } }` — resolve the stored create-input shape
                // (`lines: { create: [...] }`) into the flat array a real Prisma
                // `include` would return.
                const lines =
                  (entry.lines as { create: { debit: number }[] } | undefined)?.create ?? [];
                return { ...entry, lines };
              }
            }
            return null;
          }
          return null;
        },
      ),
      count: jest.fn(async () => journalEntries.size),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        journalSequence += 1;
        const id = `journal-${journalSequence}`;
        const entry = { id, status: 'POSTED', postedAt: new Date(), ...data };
        journalEntries.set(id, entry);
        return entry;
      }),
    },
  };

  return { tx, goodsReceipts, journalEntries, inventoryStocks, inventoryTransactions };
}

function makePrisma(fakeTx: ReturnType<typeof makeFakeTx>['tx']) {
  return {
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx)),
  } as unknown as PrismaService;
}

function makeReceiveData(overrides: Partial<ReceiveGoodsData> = {}): ReceiveGoodsData {
  return {
    organisationId: 'org-1',
    purchaseOrderId: 'po-1',
    purchaseOrderItems: [{ id: 'poi-1', quantity: 1000 }],
    purchaseOrderNumber: 'PO-000001',
    goodsReceiptNumber: 'GRN-000001',
    supplierId: 'supplier-1',
    locationId: 'loc-1',
    receivedDate: new Date('2026-08-15'),
    receivedById: 'user-1',
    discrepancyStatus: DiscrepancyStatus.NONE,
    items: [
      {
        purchaseOrderItemId: 'poi-1',
        productId: 'product-1',
        deliveredQuantity: 1000,
        rejectedQuantity: 0,
        acceptedQuantity: 1000,
        unitPrice: 1000,
      },
    ],
    ...overrides,
  };
}

describe('GoodsReceiptRepository (deliberate exception — real transaction logic under test)', () => {
  function setup(poStatus: PurchaseOrderStatus = PurchaseOrderStatus.PENDING) {
    const purchaseOrders = new Map([
      ['po-1', { id: 'po-1', organisationId: 'org-1', status: poStatus }],
    ]);
    const fake = makeFakeTx({ purchaseOrders });
    const repository = new GoodsReceiptRepository(makePrisma(fake.tx));
    return { repository, ...fake, purchaseOrders };
  }

  it('happy path: fully payable receipt posts DR Inventory / CR AP only, no GRNI line', async () => {
    const { repository, journalEntries } = setup();

    const result = await repository.receive(
      makeReceiveData({
        purchaseOrderItems: [{ id: 'poi-1', quantity: 1000 }],
        items: [
          {
            purchaseOrderItemId: 'poi-1',
            productId: 'product-1',
            deliveredQuantity: 300,
            rejectedQuantity: 0,
            acceptedQuantity: 300,
            unitPrice: 1000,
          },
        ],
      }),
    );

    expect(result.wasCreated).toBe(true);
    expect(result.goodsReceipt.items[0]!.payableQuantity).toBe(300);
    expect(result.journalEntry).not.toBeNull();
    expect(result.journalEntry!.totalAmount).toBe(300_000);

    const entry = journalEntries.get(result.journalEntry!.id) as {
      lines: { create: { accountId: string; debit: number; credit: number }[] };
    };
    expect(entry.lines.create).toEqual([
      { accountId: 'account-inventory', description: undefined, debit: 300_000, credit: 0 },
      { accountId: 'account-ap', description: undefined, debit: 0, credit: 300_000 },
    ]);
  });

  it("the user's worked example: delivered 1,100 / rejected 50 / accepted 1,050 on a 1,000-unit PO posts a 3-line journal (DR Inventory 1,050,000 / CR AP 1,000,000 / CR GRNI 50,000)", async () => {
    const { repository, journalEntries } = setup();

    const result = await repository.receive(
      makeReceiveData({
        items: [
          {
            purchaseOrderItemId: 'poi-1',
            productId: 'product-1',
            deliveredQuantity: 1100,
            rejectedQuantity: 50,
            acceptedQuantity: 1050,
            unitPrice: 1000,
          },
        ],
      }),
    );

    expect(result.goodsReceipt.items[0]!.acceptedQuantity).toBe(1050);
    expect(result.goodsReceipt.items[0]!.payableQuantity).toBe(1000);
    expect(result.journalEntry!.totalAmount).toBe(1_050_000);

    const entry = journalEntries.get(result.journalEntry!.id) as {
      lines: { create: { accountId: string; debit: number; credit: number }[] };
    };
    expect(entry.lines.create).toEqual([
      { accountId: 'account-inventory', description: undefined, debit: 1_050_000, credit: 0 },
      { accountId: 'account-ap', description: undefined, debit: 0, credit: 1_000_000 },
      { accountId: 'account-grni', description: undefined, debit: 0, credit: 50_000 },
    ]);
  });

  it('payable-cap edge case: a PO item already fully consumed by a prior receipt posts no AP line at all on the next receipt', async () => {
    const { repository, journalEntries, goodsReceipts } = setup(
      PurchaseOrderStatus.PARTIALLY_RECEIVED,
    );

    // First receipt consumes the entire 1,000-unit PO as payable.
    await repository.receive(
      makeReceiveData({
        items: [
          {
            purchaseOrderItemId: 'poi-1',
            productId: 'product-1',
            deliveredQuantity: 1000,
            rejectedQuantity: 0,
            acceptedQuantity: 1000,
            unitPrice: 1000,
          },
        ],
      }),
    );
    expect(goodsReceipts.size).toBe(1);

    // A second (replacement/excess) receipt against the same fully-consumed item.
    const second = await repository.receive(
      makeReceiveData({
        goodsReceiptNumber: 'GRN-000002',
        items: [
          {
            purchaseOrderItemId: 'poi-1',
            productId: 'product-1',
            deliveredQuantity: 100,
            rejectedQuantity: 0,
            acceptedQuantity: 100,
            unitPrice: 1000,
          },
        ],
      }),
    );

    expect(second.goodsReceipt.items[0]!.payableQuantity).toBe(0);
    const entry = journalEntries.get(second.journalEntry!.id) as {
      lines: { create: { accountId: string; debit: number; credit: number }[] };
    };
    expect(entry.lines.create).toEqual([
      { accountId: 'account-inventory', description: undefined, debit: 100_000, credit: 0 },
      { accountId: 'account-grni', description: undefined, debit: 0, credit: 100_000 },
    ]);
  });

  it('all-rejected receipt posts no journal entry at all', async () => {
    const { repository } = setup();

    const result = await repository.receive(
      makeReceiveData({
        items: [
          {
            purchaseOrderItemId: 'poi-1',
            productId: 'product-1',
            deliveredQuantity: 200,
            rejectedQuantity: 200,
            acceptedQuantity: 0,
            unitPrice: 1000,
          },
        ],
      }),
    );

    expect(result.journalEntry).toBeNull();
  });

  it('idempotency replay returns the original receipt and posts exactly one journal entry', async () => {
    const { repository, goodsReceipts, journalEntries } = setup();
    const data = makeReceiveData({ idempotencyKey: 'key-1' });

    const first = await repository.receive(data);
    const second = await repository.receive(data);

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.goodsReceipt.id).toBe(first.goodsReceipt.id);
    expect(second.journalEntry?.id).toBe(first.journalEntry?.id);
    expect(goodsReceipts.size).toBe(1);
    expect(journalEntries.size).toBe(1);
  });

  it('throws GoodsReceiptConflictError when the purchase order is no longer receivable', async () => {
    const { repository } = setup(PurchaseOrderStatus.CANCELLED);

    await expect(repository.receive(makeReceiveData())).rejects.toThrow(GoodsReceiptConflictError);
  });

  it('throws NoOpenPeriodError when the received date falls outside every open period, and creates no journal', async () => {
    const purchaseOrders = new Map([
      ['po-1', { id: 'po-1', organisationId: 'org-1', status: PurchaseOrderStatus.PENDING }],
    ]);
    const fake = makeFakeTx({ purchaseOrders, openPeriod: null });
    const repository = new GoodsReceiptRepository(makePrisma(fake.tx));

    await expect(repository.receive(makeReceiveData())).rejects.toThrow(NoOpenPeriodError);
    expect(fake.journalEntries.size).toBe(0);
  });

  it('throws MissingSystemAccountError when the excess-value GRNI account is not configured for the organisation', async () => {
    const purchaseOrders = new Map([
      ['po-1', { id: 'po-1', organisationId: 'org-1', status: PurchaseOrderStatus.PENDING }],
    ]);
    const fake = makeFakeTx({
      purchaseOrders,
      accounts: { INVENTORY: 'account-inventory', AP: 'account-ap' }, // GRNI_PENDING_APPROVAL missing
    });
    const repository = new GoodsReceiptRepository(makePrisma(fake.tx));

    await expect(
      repository.receive(
        makeReceiveData({
          items: [
            {
              purchaseOrderItemId: 'poi-1',
              productId: 'product-1',
              deliveredQuantity: 1100,
              rejectedQuantity: 50,
              acceptedQuantity: 1050,
              unitPrice: 1000,
            },
          ],
        }),
      ),
    ).rejects.toThrow(MissingSystemAccountError);
  });

  it('multiple receipts against one PO (200+200+100 of 500, all within the ordered quantity) post three balanced journals with no excess line', async () => {
    const purchaseOrders = new Map([
      ['po-1', { id: 'po-1', organisationId: 'org-1', status: PurchaseOrderStatus.PENDING }],
    ]);
    const fake = makeFakeTx({ purchaseOrders });
    const repository = new GoodsReceiptRepository(makePrisma(fake.tx));
    const receiptData = (quantity: number, grn: string) =>
      makeReceiveData({
        purchaseOrderItems: [{ id: 'poi-1', quantity: 500 }],
        goodsReceiptNumber: grn,
        items: [
          {
            purchaseOrderItemId: 'poi-1',
            productId: 'product-1',
            deliveredQuantity: quantity,
            rejectedQuantity: 0,
            acceptedQuantity: quantity,
            unitPrice: 1000,
          },
        ],
      });

    const first = await repository.receive(receiptData(200, 'GRN-000001'));
    const second = await repository.receive(receiptData(200, 'GRN-000002'));
    const third = await repository.receive(receiptData(100, 'GRN-000003'));

    expect(first.purchaseOrderStatus).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);
    expect(second.purchaseOrderStatus).toBe(PurchaseOrderStatus.PARTIALLY_RECEIVED);
    expect(third.purchaseOrderStatus).toBe(PurchaseOrderStatus.RECEIVED);
    expect(fake.journalEntries.size).toBe(3);
    for (const entry of fake.journalEntries.values()) {
      const lines = (entry as { lines: { create: { debit: number; credit: number }[] } }).lines
        .create;
      const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
      const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
      expect(totalDebit).toBe(totalCredit);
      expect(lines).toHaveLength(2); // fully payable each time, no excess line
    }
  });
});
