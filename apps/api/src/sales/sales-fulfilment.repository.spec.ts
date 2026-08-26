import { SalesOrderStatus } from '@prisma/client';

import {
  MissingSystemAccountError,
  NoOpenPeriodError,
} from '../finance/accounting/journal-posting';
import { PrismaService } from '../prisma/prisma.service';
import {
  FulfilSalesOrderData,
  InsufficientStockError,
  SalesFulfilmentConflictError,
  SalesFulfilmentRepository,
} from './sales-fulfilment.repository';

/**
 * A deliberate exception to this codebase's "no repository-level unit tests for atomic
 * transactions" convention — same justification as
 * `production-material-issue.repository.spec.ts` (Sprint 9): money correctness at
 * exact scenarios is worth it. Same in-memory fake-`tx` technique, exposing the same
 * model methods both at the top level (`prisma.X`, for `findByIdempotencyKey`/
 * `findJournalEntriesForFulfilments`, which run outside any transaction) and inside
 * `$transaction`'s callback (`tx.X`) — the literal same functions operating on the
 * same in-memory maps, since nothing here tests real transactional isolation, only the
 * business logic built on top of it.
 */
const PRODUCT = { id: 'product-fg', code: 'PRD-000027', name: 'Plantain Chips 500g', unit: 'Pack' };
const LOCATION = { id: 'loc-1', name: 'Main Warehouse' };

interface FakeSalesOrderItem {
  id: string;
  salesOrderId: string;
  productId: string;
  quantity: number;
  quantityFulfilled: number;
}

interface FakeSalesFulfilmentItem {
  id: string;
  productId: string;
  salesOrderItemId: string;
  quantityFulfilled: number;
  quantityDispatched: number;
  unitCost: number;
  costAmount: number;
}

interface FakeSalesFulfilment {
  id: string;
  organisationId: string;
  salesOrderId: string;
  locationId: string;
  idempotencyKey: string | null;
  items: FakeSalesFulfilmentItem[];
}

function makeFakeDb(options: {
  salesOrders: Map<string, { id: string; organisationId: string; status: SalesOrderStatus }>;
  salesOrderItems: Map<string, FakeSalesOrderItem>;
  inventoryStocks?: Map<string, { quantityOnHand: number; averageUnitCost: number }>;
  fulfilments?: Map<string, FakeSalesFulfilment>;
  journalEntries?: Map<string, Record<string, unknown>>;
  accounts?: Record<string, string>;
  openPeriod?: { startDate: Date; endDate: Date } | null;
}) {
  const salesOrders = options.salesOrders;
  const salesOrderItems = options.salesOrderItems;
  const inventoryStocks = options.inventoryStocks ?? new Map();
  const fulfilments = options.fulfilments ?? new Map<string, FakeSalesFulfilment>();
  const journalEntries = options.journalEntries ?? new Map<string, Record<string, unknown>>();
  const accounts = options.accounts ?? {
    COGS: 'account-cogs',
    FINISHED_GOODS_INVENTORY: 'account-fg',
  };
  const openPeriod =
    'openPeriod' in options
      ? options.openPeriod
      : { startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') };
  const inventoryTransactions: Record<string, unknown>[] = [];
  let fulfilmentSequence = fulfilments.size;
  let journalSequence = journalEntries.size;

  const db = {
    salesOrder: {
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { id: string; organisationId: string; status: { in: SalesOrderStatus[] } };
        }) => {
          const order = salesOrders.get(where.id);
          if (!order || order.organisationId !== where.organisationId) return null;
          if (!where.status.in.includes(order.status)) return null;
          return { id: order.id };
        },
      ),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const order = salesOrders.get(where.id);
        if (!order) throw new Error('not found');
        return { ...order };
      }),
      update: jest.fn(
        async ({ where, data }: { where: { id: string }; data: { status: SalesOrderStatus } }) => {
          const order = salesOrders.get(where.id)!;
          order.status = data.status;
          return { ...order };
        },
      ),
    },
    salesOrderItem: {
      findMany: jest.fn(async ({ where }: { where: { salesOrderId: string } }) => {
        return [...salesOrderItems.values()].filter(
          (item) => item.salesOrderId === where.salesOrderId,
        );
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { quantityFulfilled: { increment: number } };
        }) => {
          const item = salesOrderItems.get(where.id)!;
          item.quantityFulfilled += data.quantityFulfilled.increment;
          return { ...item };
        },
      ),
    },
    inventoryStock: {
      findUnique: jest.fn(async ({ where }: { where: unknown }) => {
        const key = JSON.stringify(where);
        return inventoryStocks.get(key) ?? null;
      }),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: unknown;
          create: { quantityOnHand: number };
          update: { quantityOnHand: number };
        }) => {
          const key = JSON.stringify(where);
          const existing = inventoryStocks.get(key);
          if (existing) {
            existing.quantityOnHand = update.quantityOnHand;
            return existing;
          }
          const created = { quantityOnHand: create.quantityOnHand, averageUnitCost: 0 };
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
    salesFulfilment: {
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
          for (const fulfilment of fulfilments.values()) {
            if (
              fulfilment.salesOrderId === key.salesOrderId &&
              fulfilment.idempotencyKey === key.idempotencyKey
            ) {
              return {
                ...fulfilment,
                location: LOCATION,
                items: fulfilment.items.map((item) => ({ ...item, product: PRODUCT })),
              };
            }
          }
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        fulfilmentSequence += 1;
        const id = `fulfilment-${fulfilmentSequence}`;
        const itemsInput = (
          data.items as {
            create: {
              productId: string;
              salesOrderItemId: string;
              quantityFulfilled: number;
              unitCost: number;
              costAmount: number;
            }[];
          }
        ).create;
        const items: FakeSalesFulfilmentItem[] = itemsInput.map((item, index) => ({
          id: `fulfilment-item-${id}-${index}`,
          quantityDispatched: 0,
          ...item,
        }));
        const fulfilment: FakeSalesFulfilment = {
          id,
          organisationId: data.organisationId as string,
          salesOrderId: data.salesOrderId as string,
          locationId: data.locationId as string,
          idempotencyKey: (data.idempotencyKey as string | undefined) ?? null,
          items,
        };
        fulfilments.set(id, fulfilment);
        return {
          ...fulfilment,
          location: LOCATION,
          items: items.map((item) => ({ ...item, product: PRODUCT })),
        };
      }),
      findMany: jest.fn(
        async ({ where }: { where: { organisationId: string; salesOrderId: string } }) => {
          return [...fulfilments.values()]
            .filter(
              (fulfilment) =>
                fulfilment.organisationId === where.organisationId &&
                fulfilment.salesOrderId === where.salesOrderId,
            )
            .map((fulfilment) => ({
              ...fulfilment,
              location: LOCATION,
              items: fulfilment.items.map((item) => ({ ...item, product: PRODUCT })),
            }));
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
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { organisationId: string; sourceType: string; sourceId: { in: string[] } };
        }) => {
          return [...journalEntries.values()]
            .filter(
              (entry) =>
                entry.organisationId === where.organisationId &&
                entry.sourceType === where.sourceType &&
                where.sourceId.in.includes(entry.sourceId as string),
            )
            .map((entry) => ({
              ...entry,
              lines: (entry.lines as { create: { debit: number }[] } | undefined)?.create ?? [],
            }));
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

  return {
    db,
    inventoryStocks,
    fulfilments,
    journalEntries,
    inventoryTransactions,
    salesOrderItems,
  };
}

function makePrisma(db: ReturnType<typeof makeFakeDb>['db']) {
  return {
    ...db,
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(db)),
  } as unknown as PrismaService;
}

function makeFulfilData(overrides: Partial<FulfilSalesOrderData> = {}): FulfilSalesOrderData {
  return {
    organisationId: 'org-1',
    salesOrderId: 'order-1',
    salesOrderNumber: 'SO-000001',
    locationId: 'loc-1',
    fulfilmentDate: new Date('2026-08-25'),
    fulfilledById: 'user-1',
    items: [{ salesOrderItemId: 'item-1', productId: 'product-fg', quantity: 100 }],
    ...overrides,
  };
}

function stockKey(productId: string, locationId = 'loc-1', organisationId = 'org-1') {
  return JSON.stringify({
    organisationId_productId_locationId: { organisationId, productId, locationId },
  });
}

describe('SalesFulfilmentRepository (deliberate exception — real transaction logic under test)', () => {
  function setup(
    orderStatus: SalesOrderStatus = SalesOrderStatus.CONFIRMED,
    stockOverrides: { quantityOnHand: number; averageUnitCost: number } = {
      quantityOnHand: 1000,
      averageUnitCost: 500,
    },
    orderedQuantity = 1000,
  ) {
    const salesOrders = new Map([
      ['order-1', { id: 'order-1', organisationId: 'org-1', status: orderStatus }],
    ]);
    const salesOrderItems = new Map<string, FakeSalesOrderItem>([
      [
        'item-1',
        {
          id: 'item-1',
          salesOrderId: 'order-1',
          productId: 'product-fg',
          quantity: orderedQuantity,
          quantityFulfilled: 0,
        },
      ],
    ]);
    const inventoryStocks = new Map([[stockKey('product-fg'), stockOverrides]]);
    const fake = makeFakeDb({ salesOrders, salesOrderItems, inventoryStocks });
    const repository = new SalesFulfilmentRepository(makePrisma(fake.db));
    return { repository, ...fake, salesOrders };
  }

  it('happy path: posts DR COGS / CR Finished Goods Inventory for quantity × current averageUnitCost, and transitions order status', async () => {
    const { repository, journalEntries, salesOrders } = setup(
      SalesOrderStatus.CONFIRMED,
      { quantityOnHand: 1000, averageUnitCost: 500 },
      100,
    );

    const result = await repository.create(
      makeFulfilData({
        items: [{ salesOrderItemId: 'item-1', productId: 'product-fg', quantity: 100 }],
      }),
    );

    expect(result.wasCreated).toBe(true);
    expect(result.journalEntry).not.toBeNull();
    expect(result.journalEntry!.totalAmount).toBe(50_000);
    expect(salesOrders.get('order-1')!.status).toBe(SalesOrderStatus.FULFILLED);

    const entry = journalEntries.get(result.journalEntry!.id) as {
      lines: { create: { accountId: string; debit: number; credit: number }[] };
    };
    expect(entry.lines.create).toEqual([
      { accountId: 'account-cogs', description: undefined, debit: 50_000, credit: 0 },
      { accountId: 'account-fg', description: undefined, debit: 0, credit: 50_000 },
    ]);
  });

  it('partial fulfilment across 3 calls each posts its own independent journal, summing exactly to the total', async () => {
    const { repository, journalEntries, inventoryStocks } = setup(
      SalesOrderStatus.CONFIRMED,
      { quantityOnHand: 1000, averageUnitCost: 500 },
      1000,
    );

    const f1 = await repository.create(
      makeFulfilData({
        items: [{ salesOrderItemId: 'item-1', productId: 'product-fg', quantity: 300 }],
      }),
    );
    expect(f1.journalEntry!.totalAmount).toBe(150_000);
    expect(inventoryStocks.get(stockKey('product-fg'))!.quantityOnHand).toBe(700);

    const f2 = await repository.create(
      makeFulfilData({
        items: [{ salesOrderItemId: 'item-1', productId: 'product-fg', quantity: 400 }],
      }),
    );
    expect(f2.journalEntry!.totalAmount).toBe(200_000);
    expect(inventoryStocks.get(stockKey('product-fg'))!.quantityOnHand).toBe(300);

    const f3 = await repository.create(
      makeFulfilData({
        items: [{ salesOrderItemId: 'item-1', productId: 'product-fg', quantity: 300 }],
      }),
    );
    expect(f3.journalEntry!.totalAmount).toBe(150_000);
    expect(inventoryStocks.get(stockKey('product-fg'))!.quantityOnHand).toBe(0);

    expect(journalEntries.size).toBe(3);
    const total = [f1, f2, f3].reduce((sum, r) => sum + r.journalEntry!.totalAmount, 0);
    expect(total).toBe(500_000);
  });

  it('multi-SKU fulfilment posts one aggregated journal, with each item.costAmount summing exactly to the journal total', async () => {
    const salesOrders = new Map([
      ['order-1', { id: 'order-1', organisationId: 'org-1', status: SalesOrderStatus.CONFIRMED }],
    ]);
    const salesOrderItems = new Map<string, FakeSalesOrderItem>([
      [
        'item-30g',
        {
          id: 'item-30g',
          salesOrderId: 'order-1',
          productId: 'product-30g',
          quantity: 100,
          quantityFulfilled: 0,
        },
      ],
      [
        'item-500g',
        {
          id: 'item-500g',
          salesOrderId: 'order-1',
          productId: 'product-500g',
          quantity: 50,
          quantityFulfilled: 0,
        },
      ],
      [
        'item-kk',
        {
          id: 'item-kk',
          salesOrderId: 'order-1',
          productId: 'product-kk',
          quantity: 100,
          quantityFulfilled: 0,
        },
      ],
    ]);
    const inventoryStocks = new Map([
      [stockKey('product-30g'), { quantityOnHand: 500, averageUnitCost: 100 }],
      [stockKey('product-500g'), { quantityOnHand: 200, averageUnitCost: 500 }],
      [stockKey('product-kk'), { quantityOnHand: 500, averageUnitCost: 150 }],
    ]);
    const fake = makeFakeDb({ salesOrders, salesOrderItems, inventoryStocks });
    const repository = new SalesFulfilmentRepository(makePrisma(fake.db));

    const result = await repository.create(
      makeFulfilData({
        items: [
          { salesOrderItemId: 'item-30g', productId: 'product-30g', quantity: 100 },
          { salesOrderItemId: 'item-500g', productId: 'product-500g', quantity: 50 },
          { salesOrderItemId: 'item-kk', productId: 'product-kk', quantity: 100 },
        ],
      }),
    );

    expect(result.journalEntry!.totalAmount).toBe(50_000);
    const sumOfItemCosts = result.fulfilment.items.reduce((sum, item) => sum + item.costAmount, 0);
    expect(sumOfItemCosts).toBe(result.journalEntry!.totalAmount);
    expect(result.fulfilment.items.find((i) => i.productId === 'product-30g')!.costAmount).toBe(
      10_000,
    );
    expect(result.fulfilment.items.find((i) => i.productId === 'product-500g')!.costAmount).toBe(
      25_000,
    );
    expect(result.fulfilment.items.find((i) => i.productId === 'product-kk')!.costAmount).toBe(
      15_000,
    );
  });

  it("weighted-average costing: fulfils at the stock's current blended average", async () => {
    const { repository } = setup(
      SalesOrderStatus.CONFIRMED,
      { quantityOnHand: 200, averageUnitCost: 600 }, // pre-blended: (100@500 + 100@700)/200
      50,
    );

    const result = await repository.create(
      makeFulfilData({
        items: [{ salesOrderItemId: 'item-1', productId: 'product-fg', quantity: 50 }],
      }),
    );

    expect(result.journalEntry!.totalAmount).toBe(30_000);
    expect(result.fulfilment.items[0]!.unitCost).toBe(600);
  });

  it('zero/missing cost: fulfilment succeeds physically, posts no journal, item costAmount is 0', async () => {
    const { repository } = setup(
      SalesOrderStatus.CONFIRMED,
      { quantityOnHand: 1000, averageUnitCost: 0 },
      100,
    );

    const result = await repository.create(
      makeFulfilData({
        items: [{ salesOrderItemId: 'item-1', productId: 'product-fg', quantity: 100 }],
      }),
    );

    expect(result.wasCreated).toBe(true);
    expect(result.journalEntry).toBeNull();
    expect(result.fulfilment.items[0]!.costAmount).toBe(0);
  });

  it('throws InsufficientStockError when requested quantity exceeds current stock, with zero partial writes', async () => {
    const { repository, fulfilments, journalEntries } = setup(
      SalesOrderStatus.CONFIRMED,
      { quantityOnHand: 50, averageUnitCost: 500 },
      100,
    );

    await expect(
      repository.create(
        makeFulfilData({
          items: [{ salesOrderItemId: 'item-1', productId: 'product-fg', quantity: 100 }],
        }),
      ),
    ).rejects.toThrow(InsufficientStockError);
    expect(fulfilments.size).toBe(0);
    expect(journalEntries.size).toBe(0);
  });

  it('throws SalesFulfilmentConflictError when the order is not CONFIRMED/PARTIALLY_FULFILLED', async () => {
    const { repository } = setup(SalesOrderStatus.FULFILLED);

    await expect(repository.create(makeFulfilData())).rejects.toThrow(SalesFulfilmentConflictError);
  });

  it('idempotency replay returns the original fulfilment and posts exactly one journal entry', async () => {
    const { repository, fulfilments, journalEntries } = setup();
    const data = makeFulfilData({ idempotencyKey: 'key-1' });

    const first = await repository.create(data);
    const second = await repository.create(data);

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.fulfilment.id).toBe(first.fulfilment.id);
    expect(second.journalEntry?.id).toBe(first.journalEntry?.id);
    expect(fulfilments.size).toBe(1);
    expect(journalEntries.size).toBe(1);
  });

  it('findByIdempotencyKey returns the same fulfilment + journal outside any transaction', async () => {
    const { repository } = setup();
    const data = makeFulfilData({ idempotencyKey: 'key-1' });
    const created = await repository.create(data);

    const found = await repository.findByIdempotencyKey('org-1', 'order-1', 'key-1');

    expect(found).not.toBeNull();
    expect(found!.fulfilment.id).toBe(created.fulfilment.id);
    expect(found!.journalEntry?.id).toBe(created.journalEntry?.id);
  });

  it('findJournalEntriesForFulfilments batches lookups across multiple fulfilments', async () => {
    const { repository } = setup(
      SalesOrderStatus.CONFIRMED,
      { quantityOnHand: 1000, averageUnitCost: 500 },
      1000,
    );

    const f1 = await repository.create(
      makeFulfilData({
        items: [{ salesOrderItemId: 'item-1', productId: 'product-fg', quantity: 300 }],
      }),
    );
    const f2 = await repository.create(
      makeFulfilData({
        items: [{ salesOrderItemId: 'item-1', productId: 'product-fg', quantity: 400 }],
      }),
    );

    const map = await repository.findJournalEntriesForFulfilments('org-1', [
      f1.fulfilment.id,
      f2.fulfilment.id,
    ]);

    expect(map.get(f1.fulfilment.id)?.totalAmount).toBe(150_000);
    expect(map.get(f2.fulfilment.id)?.totalAmount).toBe(200_000);
  });

  it('throws NoOpenPeriodError when the fulfilment date falls outside every open period, and rolls back completely', async () => {
    const salesOrders = new Map([
      ['order-1', { id: 'order-1', organisationId: 'org-1', status: SalesOrderStatus.CONFIRMED }],
    ]);
    const salesOrderItems = new Map<string, FakeSalesOrderItem>([
      [
        'item-1',
        {
          id: 'item-1',
          salesOrderId: 'order-1',
          productId: 'product-fg',
          quantity: 100,
          quantityFulfilled: 0,
        },
      ],
    ]);
    const inventoryStocks = new Map([
      [stockKey('product-fg'), { quantityOnHand: 1000, averageUnitCost: 500 }],
    ]);
    const fake = makeFakeDb({ salesOrders, salesOrderItems, inventoryStocks, openPeriod: null });
    const repository = new SalesFulfilmentRepository(makePrisma(fake.db));

    // Note: this in-memory fake doesn't simulate a real transaction's rollback (it's
    // a plain async function over shared mutable state, not a Postgres transaction),
    // so only the journal — created strictly after the fulfilment row in the real
    // code's own sequence — reliably proves the failure happened before posting.
    // True end-to-end atomicity (fulfilment/stock/order status also rolling back) is
    // verified live against a real database — see the Sprint 10 live-verification
    // plan's closed-period scenario, same convention
    // `production-material-issue.repository.spec.ts`'s equivalent test follows.
    await expect(
      repository.create(
        makeFulfilData({
          items: [{ salesOrderItemId: 'item-1', productId: 'product-fg', quantity: 100 }],
        }),
      ),
    ).rejects.toThrow(NoOpenPeriodError);
    expect(fake.journalEntries.size).toBe(0);
  });

  it('throws MissingSystemAccountError when the COGS account is not configured for the organisation', async () => {
    const salesOrders = new Map([
      ['order-1', { id: 'order-1', organisationId: 'org-1', status: SalesOrderStatus.CONFIRMED }],
    ]);
    const salesOrderItems = new Map<string, FakeSalesOrderItem>([
      [
        'item-1',
        {
          id: 'item-1',
          salesOrderId: 'order-1',
          productId: 'product-fg',
          quantity: 100,
          quantityFulfilled: 0,
        },
      ],
    ]);
    const inventoryStocks = new Map([
      [stockKey('product-fg'), { quantityOnHand: 1000, averageUnitCost: 500 }],
    ]);
    const fake = makeFakeDb({
      salesOrders,
      salesOrderItems,
      inventoryStocks,
      accounts: { FINISHED_GOODS_INVENTORY: 'account-fg' }, // COGS missing
    });
    const repository = new SalesFulfilmentRepository(makePrisma(fake.db));

    await expect(
      repository.create(
        makeFulfilData({
          items: [{ salesOrderItemId: 'item-1', productId: 'product-fg', quantity: 100 }],
        }),
      ),
    ).rejects.toThrow(MissingSystemAccountError);
  });
});
