import { DiscrepancyStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  InsufficientReturnableStockError,
  OverReturnError,
  SupplierReturnRepository,
} from './supplier-return.repository';

/**
 * A deliberate exception to this codebase's "no repository-level unit tests for atomic
 * transactions" convention — same justification as `goods-receipt.repository.spec.ts`.
 * Verifies the excess-first allocation (brief §17-19) against the real `create()`
 * transaction callback.
 */
const PRODUCT = { id: 'product-1', code: 'PRD-000031', name: 'Labels', unit: 'Roll' };

function makeFakeTx(options: {
  goodsReceiptItems: Map<string, Record<string, unknown>>;
  goodsReceipt: Record<string, unknown>;
  accounts?: Record<string, string>;
  openPeriod?: { startDate: Date; endDate: Date } | null;
  priorStockQuantity?: number;
}) {
  const goodsReceiptItems = options.goodsReceiptItems;
  const goodsReceipt = options.goodsReceipt;
  const supplierReturns = new Map<string, Record<string, unknown>>();
  const inventoryStocks = new Map<string, { quantityOnHand: number; averageUnitCost: number }>();
  if (options.priorStockQuantity !== undefined) {
    for (const item of goodsReceiptItems.values()) {
      const key = JSON.stringify({
        organisationId_productId_locationId: {
          organisationId: 'org-1',
          productId: item.productId,
          locationId: 'loc-1',
        },
      });
      inventoryStocks.set(key, {
        quantityOnHand: options.priorStockQuantity,
        averageUnitCost: 1000,
      });
    }
  }
  const inventoryTransactions: Record<string, unknown>[] = [];
  const journalEntries = new Map<string, Record<string, unknown>>();
  const accounts = options.accounts ?? {
    AP: 'account-ap',
    GRNI_PENDING_APPROVAL: 'account-grni',
    INVENTORY: 'account-inventory',
  };
  const openPeriod =
    'openPeriod' in options
      ? options.openPeriod
      : { startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') };
  let returnSeq = 0;
  let journalSeq = 0;

  function attachRelations(row: Record<string, unknown>) {
    return {
      ...row,
      supplier: { id: row.supplierId, supplierCode: 'SUP-000004', supplierName: 'Label Masters' },
      purchaseOrder: { id: row.purchaseOrderId, purchaseOrderNumber: 'PO-000004' },
      goodsReceipt: { id: goodsReceipt.id, goodsReceiptNumber: goodsReceipt.goodsReceiptNumber },
      location: { id: row.locationId, name: 'Main Warehouse' },
    };
  }

  const tx = {
    supplierReturn: {
      findFirst: jest.fn(async ({ where }: { where: { id: string; organisationId: string } }) => {
        const row = supplierReturns.get(where.id);
        if (!row || row.organisationId !== where.organisationId) return null;
        return row;
      }),
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            goodsReceiptId_idempotencyKey?: { goodsReceiptId: string; idempotencyKey: string };
          };
        }) => {
          const key = where.goodsReceiptId_idempotencyKey;
          if (!key) return null;
          for (const row of supplierReturns.values()) {
            if (
              row.goodsReceiptId === key.goodsReceiptId &&
              row.idempotencyKey === key.idempotencyKey
            ) {
              return row;
            }
          }
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        returnSeq += 1;
        const id = `sret-${returnSeq}`;
        const itemsInput = (data.items as { create: Record<string, unknown>[] }).create;
        const items = itemsInput.map((item, index) => ({
          id: `sreti-${id}-${index}`,
          supplierReturnId: id,
          ...item,
          product: PRODUCT,
        }));
        const row = attachRelations({
          id,
          status: 'COMPLETED',
          photoUrl: null,
          photoKey: null,
          ...data,
          items,
        });
        supplierReturns.set(id, row);
        return row;
      }),
    },
    goodsReceiptItem: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: {
            id: { in: string[] };
            goodsReceiptId: string;
            goodsReceipt: { organisationId: string };
          };
        }) => {
          if (goodsReceipt.organisationId !== where.goodsReceipt.organisationId) return [];
          if (goodsReceipt.id !== where.goodsReceiptId) return [];
          return [...goodsReceiptItems.values()].filter((row) =>
            where.id.in.includes(row.id as string),
          );
        },
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: {
            returnedQuantity: { increment: number };
            returnedExcessQuantity: { increment: number };
          };
        }) => {
          const row = goodsReceiptItems.get(where.id);
          if (!row) throw new Error('goods receipt item not found');
          row.returnedQuantity = (row.returnedQuantity as number) + data.returnedQuantity.increment;
          row.returnedExcessQuantity =
            (row.returnedExcessQuantity as number) + data.returnedExcessQuantity.increment;
          return row;
        },
      ),
    },
    goodsReceipt: {
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        if (goodsReceipt.id !== where.id) throw new Error('goods receipt not found');
        return { discrepancyStatus: goodsReceipt.discrepancyStatus };
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          if (goodsReceipt.id !== where.id) throw new Error('goods receipt not found');
          Object.assign(goodsReceipt, data);
          return goodsReceipt;
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
    supplierReturns,
    goodsReceiptItems,
    inventoryStocks,
    inventoryTransactions,
    journalEntries,
  };
}

function makePrisma(fakeTx: ReturnType<typeof makeFakeTx>['tx']) {
  return {
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(fakeTx)),
    // `findById` calls `this.prisma.supplierReturn.findFirst` directly (outside any
    // transaction) — delegate to the same fake/shared map the transactional methods
    // mutate.
    supplierReturn: fakeTx.supplierReturn,
  } as unknown as PrismaService;
}

function makeGoodsReceiptItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gri-1',
    productId: 'product-1',
    acceptedQuantity: 1050,
    payableQuantity: 1000,
    returnedQuantity: 0,
    returnedExcessQuantity: 0,
    purchaseOrderItem: { unitPrice: 1000 },
    ...overrides,
  };
}

describe('SupplierReturnRepository (deliberate exception — real transaction logic under test)', () => {
  function setup(
    options: {
      items?: Map<string, Record<string, unknown>>;
      discrepancyStatus?: DiscrepancyStatus;
      openPeriod?: { startDate: Date; endDate: Date } | null;
      priorStockQuantity?: number;
    } = {},
  ) {
    const goodsReceiptItems = options.items ?? new Map([['gri-1', makeGoodsReceiptItem()]]);
    const goodsReceipt: { discrepancyResolutionAction?: string } & Record<string, unknown> = {
      id: 'gr-1',
      organisationId: 'org-1',
      goodsReceiptNumber: 'GRN-000004',
      discrepancyStatus: options.discrepancyStatus ?? DiscrepancyStatus.NONE,
    };
    const fake = makeFakeTx({
      goodsReceiptItems,
      goodsReceipt,
      priorStockQuantity: options.priorStockQuantity ?? 1050,
      ...('openPeriod' in options ? { openPeriod: options.openPeriod } : {}),
    });
    const repository = new SupplierReturnRepository(makePrisma(fake.tx));
    return { repository, goodsReceipt, ...fake };
  }

  it('§17 worked example: returning exactly the 50-unit excess allocates 100% to GRNI, leaving AP untouched', async () => {
    const { repository, goodsReceiptItems } = setup();

    const result = await repository.create({
      organisationId: 'org-1',
      returnCode: 'SRET-000001',
      supplierId: 'supplier-1',
      purchaseOrderId: 'po-1',
      goodsReceiptId: 'gr-1',
      locationId: 'loc-1',
      returnDate: new Date('2026-08-25'),
      reason: 'OTHER',
      createdById: 'user-1',
      items: [{ goodsReceiptItemId: 'gri-1', quantityReturned: 50 }],
    });

    expect(result.wasCreated).toBe(true);
    expect(result.journalEntry!.totalAmount).toBe(50_000); // 50 × ₦1,000
    const entry = result.journalEntry!;
    expect(entry.totalAmount).toBe(50_000);
    expect(goodsReceiptItems.get('gri-1')!.returnedQuantity).toBe(50);
    expect(goodsReceiptItems.get('gri-1')!.returnedExcessQuantity).toBe(50);
  });

  it('§17: the posted journal is DR GRNI_PENDING_APPROVAL / CR Inventory only — no AP line', async () => {
    const { repository, journalEntries } = setup();

    await repository.create({
      organisationId: 'org-1',
      returnCode: 'SRET-000001',
      supplierId: 'supplier-1',
      purchaseOrderId: 'po-1',
      goodsReceiptId: 'gr-1',
      locationId: 'loc-1',
      returnDate: new Date('2026-08-25'),
      reason: 'OTHER',
      createdById: 'user-1',
      items: [{ goodsReceiptItemId: 'gri-1', quantityReturned: 50 }],
    });

    const entry = [...journalEntries.values()][0]!;
    expect(
      (entry.lines as { create: { accountId: string; debit: number; credit: number }[] }).create,
    ).toEqual([
      { accountId: 'account-grni', description: undefined, debit: 50_000, credit: 0 },
      { accountId: 'account-inventory', description: undefined, debit: 0, credit: 50_000 },
    ]);
  });

  it('§18: returning from a fully-payable receipt (no excess) allocates 100% to AP', async () => {
    const { repository, journalEntries } = setup({
      items: new Map([
        ['gri-1', makeGoodsReceiptItem({ acceptedQuantity: 1000, payableQuantity: 1000 })],
      ]),
    });

    const result = await repository.create({
      organisationId: 'org-1',
      returnCode: 'SRET-000001',
      supplierId: 'supplier-1',
      purchaseOrderId: 'po-1',
      goodsReceiptId: 'gr-1',
      locationId: 'loc-1',
      returnDate: new Date('2026-08-25'),
      reason: 'DEFECTIVE',
      createdById: 'user-1',
      items: [{ goodsReceiptItemId: 'gri-1', quantityReturned: 100 }],
    });

    expect(result.journalEntry!.totalAmount).toBe(100_000);
    const entry = [...journalEntries.values()][0]!;
    expect(
      (entry.lines as { create: { accountId: string; debit: number; credit: number }[] }).create,
    ).toEqual([
      { accountId: 'account-ap', description: undefined, debit: 100_000, credit: 0 },
      { accountId: 'account-inventory', description: undefined, debit: 0, credit: 100_000 },
    ]);
  });

  it('§19: cumulative partial returns (100 then 50) correctly spill from excess into payable once excess is exhausted', async () => {
    const { repository, goodsReceiptItems, journalEntries } = setup({
      items: new Map([
        [
          'gri-1',
          // accepted 1050, payable 1000 -> 50 excess available
          makeGoodsReceiptItem({ acceptedQuantity: 1050, payableQuantity: 1000 }),
        ],
      ]),
    });

    // First return of 30 — fully within the 50-unit excess.
    await repository.create({
      organisationId: 'org-1',
      returnCode: 'SRET-000001',
      supplierId: 'supplier-1',
      purchaseOrderId: 'po-1',
      goodsReceiptId: 'gr-1',
      locationId: 'loc-1',
      returnDate: new Date('2026-08-25'),
      reason: 'OTHER',
      createdById: 'user-1',
      items: [{ goodsReceiptItemId: 'gri-1', quantityReturned: 30 }],
    });
    expect(goodsReceiptItems.get('gri-1')!.returnedExcessQuantity).toBe(30);

    // Second return of 40 — only 20 excess remains, the other 20 spills into payable/AP.
    const second = await repository.create({
      organisationId: 'org-1',
      returnCode: 'SRET-000002',
      supplierId: 'supplier-1',
      purchaseOrderId: 'po-1',
      goodsReceiptId: 'gr-1',
      locationId: 'loc-1',
      returnDate: new Date('2026-08-26'),
      reason: 'OTHER',
      createdById: 'user-1',
      items: [{ goodsReceiptItemId: 'gri-1', quantityReturned: 40 }],
    });

    expect(goodsReceiptItems.get('gri-1')!.returnedQuantity).toBe(70);
    expect(goodsReceiptItems.get('gri-1')!.returnedExcessQuantity).toBe(50);
    const secondEntry = [...journalEntries.values()].find(
      (e) => e.sourceId === second.supplierReturn.id,
    )!;
    expect(
      (secondEntry.lines as { create: { accountId: string; debit: number; credit: number }[] })
        .create,
    ).toEqual([
      { accountId: 'account-ap', description: undefined, debit: 20_000, credit: 0 },
      { accountId: 'account-grni', description: undefined, debit: 20_000, credit: 0 },
      { accountId: 'account-inventory', description: undefined, debit: 0, credit: 40_000 },
    ]);

    // A third return exceeding the remaining eligible quantity (1050 accepted - 70
    // already returned = 980 remaining) must be rejected.
    await expect(
      repository.create({
        organisationId: 'org-1',
        returnCode: 'SRET-000003',
        supplierId: 'supplier-1',
        purchaseOrderId: 'po-1',
        goodsReceiptId: 'gr-1',
        locationId: 'loc-1',
        returnDate: new Date('2026-08-27'),
        reason: 'OTHER',
        createdById: 'user-1',
        items: [{ goodsReceiptItemId: 'gri-1', quantityReturned: 981 }],
      }),
    ).rejects.toThrow(OverReturnError);
  });

  it('a duplicate idempotent request returns the original result without double-posting', async () => {
    const { repository, journalEntries, goodsReceiptItems } = setup();
    const input = {
      organisationId: 'org-1',
      returnCode: 'SRET-000001',
      supplierId: 'supplier-1',
      purchaseOrderId: 'po-1',
      goodsReceiptId: 'gr-1',
      locationId: 'loc-1',
      returnDate: new Date('2026-08-25'),
      reason: 'OTHER' as const,
      createdById: 'user-1',
      idempotencyKey: 'key-1',
      items: [{ goodsReceiptItemId: 'gri-1', quantityReturned: 50 }],
    };

    const first = await repository.create(input);
    const second = await repository.create(input);

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.supplierReturn.id).toBe(first.supplierReturn.id);
    expect(journalEntries.size).toBe(1);
    expect(goodsReceiptItems.get('gri-1')!.returnedQuantity).toBe(50);
  });

  it('tenant isolation: findById never returns another organisation’s return', async () => {
    const { repository } = setup();
    const created = await repository.create({
      organisationId: 'org-1',
      returnCode: 'SRET-000001',
      supplierId: 'supplier-1',
      purchaseOrderId: 'po-1',
      goodsReceiptId: 'gr-1',
      locationId: 'loc-1',
      returnDate: new Date('2026-08-25'),
      reason: 'OTHER',
      createdById: 'user-1',
      items: [{ goodsReceiptItemId: 'gri-1', quantityReturned: 50 }],
    });

    expect(await repository.findById('org-2', created.supplierReturn.id)).toBeNull();
    expect(await repository.findById('org-1', created.supplierReturn.id)).not.toBeNull();
  });

  it('rejects a return that exceeds the eligible accepted quantity', async () => {
    const { repository } = setup();

    await expect(
      repository.create({
        organisationId: 'org-1',
        returnCode: 'SRET-000001',
        supplierId: 'supplier-1',
        purchaseOrderId: 'po-1',
        goodsReceiptId: 'gr-1',
        locationId: 'loc-1',
        returnDate: new Date('2026-08-25'),
        reason: 'OTHER',
        createdById: 'user-1',
        items: [{ goodsReceiptItemId: 'gri-1', quantityReturned: 1051 }],
      }),
    ).rejects.toThrow(OverReturnError);
  });

  it('rejects a return whose quantity exceeds what is physically on hand at the location', async () => {
    const { repository } = setup({ priorStockQuantity: 20 });

    await expect(
      repository.create({
        organisationId: 'org-1',
        returnCode: 'SRET-000001',
        supplierId: 'supplier-1',
        purchaseOrderId: 'po-1',
        goodsReceiptId: 'gr-1',
        locationId: 'loc-1',
        returnDate: new Date('2026-08-25'),
        reason: 'OTHER',
        createdById: 'user-1',
        items: [{ goodsReceiptItemId: 'gri-1', quantityReturned: 50 }],
      }),
    ).rejects.toThrow(InsufficientReturnableStockError);
  });

  it('auto-resolves an active discrepancy on the referenced goods receipt', async () => {
    const { repository, goodsReceipt } = setup({
      discrepancyStatus: DiscrepancyStatus.PENDING_SUPPLIER,
    });

    await repository.create({
      organisationId: 'org-1',
      returnCode: 'SRET-000001',
      supplierId: 'supplier-1',
      purchaseOrderId: 'po-1',
      goodsReceiptId: 'gr-1',
      locationId: 'loc-1',
      returnDate: new Date('2026-08-25'),
      reason: 'DEFECTIVE',
      createdById: 'user-1',
      items: [{ goodsReceiptItemId: 'gri-1', quantityReturned: 50 }],
    });

    expect(goodsReceipt.discrepancyStatus).toBe(DiscrepancyStatus.RESOLVED);
    expect(goodsReceipt.discrepancyResolutionAction).toBe('RETURN');
  });

  it('a closed accounting period rejects the return with NoOpenPeriodError and posts no journal', async () => {
    const { repository, journalEntries } = setup({ openPeriod: null });

    await expect(
      repository.create({
        organisationId: 'org-1',
        returnCode: 'SRET-000001',
        supplierId: 'supplier-1',
        purchaseOrderId: 'po-1',
        goodsReceiptId: 'gr-1',
        locationId: 'loc-1',
        returnDate: new Date('2026-08-25'),
        reason: 'OTHER',
        createdById: 'user-1',
        items: [{ goodsReceiptItemId: 'gri-1', quantityReturned: 50 }],
      }),
    ).rejects.toThrow('No open accounting period');

    expect(journalEntries.size).toBe(0);
  });
});
