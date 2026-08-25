import { ProductionOrderStatus, ProductionRejectionReason } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  MissingSystemAccountError,
  NoOpenPeriodError,
} from '../finance/accounting/journal-posting';
import {
  CompleteProductionData,
  ProductionCompletionConflictError,
  ProductionRunRepository,
} from './production-run.repository';

/**
 * A deliberate exception to this codebase's "no repository-level unit tests for atomic
 * transactions" convention — same justification as `goods-receipt.repository.spec.ts`/
 * `production-material-issue.repository.spec.ts`.
 */
interface FakeProductionRun {
  id: string;
  organisationId: string;
  productionOrderId: string;
  idempotencyKey: string | null;
  producedQuantity: number;
  rejectedQuantity: number;
  acceptedQuantity: number;
  rejectionReason?: ProductionRejectionReason;
  rejectionNotes?: string;
  completedAt: Date;
}

function makeFakeDb(options: {
  productionOrders: Map<
    string,
    { id: string; organisationId: string; status: ProductionOrderStatus }
  >;
  inventoryStocks?: Map<string, { quantityOnHand: number; averageUnitCost: number }>;
  productionRuns?: Map<string, FakeProductionRun>;
  journalEntries?: Map<string, Record<string, unknown>>;
  accounts?: Record<string, string>;
  openPeriod?: { startDate: Date; endDate: Date } | null;
}) {
  const productionOrders = options.productionOrders;
  const inventoryStocks = options.inventoryStocks ?? new Map();
  const productionRuns = options.productionRuns ?? new Map<string, FakeProductionRun>();
  const journalEntries = options.journalEntries ?? new Map<string, Record<string, unknown>>();
  const accounts = options.accounts ?? {
    WIP: 'account-wip',
    FINISHED_GOODS_INVENTORY: 'account-fg',
    PRODUCTION_LOSS: 'account-loss',
  };
  const openPeriod =
    'openPeriod' in options
      ? options.openPeriod
      : { startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') };
  let runSequence = productionRuns.size;
  let journalSequence = journalEntries.size;

  const db = {
    productionOrder: {
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; organisationId: string; status: ProductionOrderStatus };
          data: { status: ProductionOrderStatus };
        }) => {
          const order = productionOrders.get(where.id);
          if (!order || order.organisationId !== where.organisationId) return { count: 0 };
          if (order.status !== where.status) return { count: 0 };
          order.status = data.status;
          return { count: 1 };
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
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
    productionRun: {
      findUnique: jest.fn(
        async ({ where }: { where: { productionOrderId: string } }) =>
          [...productionRuns.values()].find(
            (run) => run.productionOrderId === where.productionOrderId,
          ) ?? null,
      ),
      findFirst: jest.fn(
        async ({ where }: { where: { organisationId: string; productionOrderId: string } }) =>
          [...productionRuns.values()].find(
            (run) =>
              run.organisationId === where.organisationId &&
              run.productionOrderId === where.productionOrderId,
          ) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        runSequence += 1;
        const id = `run-${runSequence}`;
        const run: FakeProductionRun = {
          id,
          organisationId: data.organisationId as string,
          productionOrderId: data.productionOrderId as string,
          idempotencyKey: (data.idempotencyKey as string | undefined) ?? null,
          producedQuantity: data.producedQuantity as number,
          rejectedQuantity: data.rejectedQuantity as number,
          acceptedQuantity: data.acceptedQuantity as number,
          rejectionReason: data.rejectionReason as ProductionRejectionReason | undefined,
          rejectionNotes: data.rejectionNotes as string | undefined,
          completedAt: new Date('2026-08-20'),
        };
        productionRuns.set(id, run);
        return run;
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
                (entry.lines as { create: { debit: number; credit: number }[] } | undefined)
                  ?.create ?? [];
              return { ...entry, lines };
            }
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

  return { db, inventoryStocks, productionRuns, journalEntries };
}

function makePrisma(db: ReturnType<typeof makeFakeDb>['db']) {
  return {
    ...db,
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(db)),
  } as unknown as PrismaService;
}

function makeCompleteData(overrides: Partial<CompleteProductionData> = {}): CompleteProductionData {
  return {
    organisationId: 'org-1',
    productionOrderId: 'order-1',
    productionOrderNumber: 'PROD-000001',
    productId: 'product-finished',
    locationId: 'loc-1',
    producedQuantity: 1000,
    rejectedQuantity: 0,
    acceptedQuantity: 1000,
    completedById: 'user-1',
    totalWipValue: 900_000,
    ...overrides,
  };
}

describe('ProductionRunRepository (deliberate exception — real transaction logic under test)', () => {
  function setup(orderStatus: ProductionOrderStatus = ProductionOrderStatus.IN_PROGRESS) {
    const productionOrders = new Map([
      ['order-1', { id: 'order-1', organisationId: 'org-1', status: orderStatus }],
    ]);
    const fake = makeFakeDb({ productionOrders });
    const repository = new ProductionRunRepository(makePrisma(fake.db));
    return { repository, ...fake, productionOrders };
  }

  it('fully accepted output: DR Finished Goods Inventory / CR WIP for the full totalWipValue, no loss line', async () => {
    const { repository, journalEntries, inventoryStocks } = setup();

    const result = await repository.complete(
      makeCompleteData({
        producedQuantity: 1000,
        rejectedQuantity: 0,
        acceptedQuantity: 1000,
        totalWipValue: 900_000,
      }),
    );

    expect(result.wasCreated).toBe(true);
    expect(result.journalEntry!.totalAmount).toBe(900_000);
    const entry = journalEntries.get(result.journalEntry!.id) as {
      lines: { create: { accountId: string; debit: number; credit: number }[] };
    };
    expect(entry.lines.create).toEqual([
      { accountId: 'account-wip', description: undefined, debit: 0, credit: 900_000 },
      { accountId: 'account-fg', description: undefined, debit: 900_000, credit: 0 },
    ]);

    const stockKey = JSON.stringify({
      organisationId_productId_locationId: {
        organisationId: 'org-1',
        productId: 'product-finished',
        locationId: 'loc-1',
      },
    });
    expect(inventoryStocks.get(stockKey)!.quantityOnHand).toBe(1000);
  });

  it("the brief's own 980/20 split: CR WIP for the full value, DR Finished Goods for the accepted share, DR Production Loss for the rejected share, summing to exactly totalWipValue", async () => {
    const { repository, journalEntries } = setup();

    const result = await repository.complete(
      makeCompleteData({
        producedQuantity: 1000,
        rejectedQuantity: 20,
        acceptedQuantity: 980,
        totalWipValue: 900_000,
      }),
    );

    const entry = journalEntries.get(result.journalEntry!.id) as {
      lines: { create: { accountId: string; debit: number; credit: number }[] };
    };
    const fgLine = entry.lines.create.find((line) => line.accountId === 'account-fg')!;
    const lossLine = entry.lines.create.find((line) => line.accountId === 'account-loss')!;
    const wipLine = entry.lines.create.find((line) => line.accountId === 'account-wip')!;
    expect(fgLine.debit).toBe(882_000); // 900,000 × 980/1000
    expect(lossLine.debit).toBe(18_000); // 900,000 × 20/1000
    expect(fgLine.debit + lossLine.debit).toBe(900_000);
    expect(wipLine.credit).toBe(900_000);
  });

  it('zero accepted quantity: 100% of totalWipValue posts to Production Loss, no Finished Goods line, no inventory movement', async () => {
    const { repository, journalEntries, inventoryStocks } = setup();

    const result = await repository.complete(
      makeCompleteData({
        producedQuantity: 50,
        rejectedQuantity: 50,
        acceptedQuantity: 0,
        totalWipValue: 45_000,
      }),
    );

    const entry = journalEntries.get(result.journalEntry!.id) as {
      lines: { create: { accountId: string; debit: number; credit: number }[] };
    };
    expect(entry.lines.create).toEqual([
      { accountId: 'account-wip', description: undefined, debit: 0, credit: 45_000 },
      { accountId: 'account-loss', description: undefined, debit: 45_000, credit: 0 },
    ]);
    expect(inventoryStocks.size).toBe(0);
  });

  it('producedQuantity === 0 (total-loss run): entire totalWipValue posts to Production Loss', async () => {
    const { repository, journalEntries } = setup();

    const result = await repository.complete(
      makeCompleteData({
        producedQuantity: 0,
        rejectedQuantity: 0,
        acceptedQuantity: 0,
        totalWipValue: 45_000,
      }),
    );

    const entry = journalEntries.get(result.journalEntry!.id) as {
      lines: { create: { accountId: string; debit: number; credit: number }[] };
    };
    const fgLine = entry.lines.create.find((line) => line.accountId === 'account-fg');
    expect(fgLine).toBeUndefined();
    const lossLine = entry.lines.create.find((line) => line.accountId === 'account-loss')!;
    expect(lossLine.debit).toBe(45_000);
  });

  it('skips posting entirely when totalWipValue is 0', async () => {
    const { repository } = setup();

    const result = await repository.complete(makeCompleteData({ totalWipValue: 0 }));

    expect(result.journalEntry).toBeNull();
  });

  it('throws ProductionCompletionConflictError when the order is not IN_PROGRESS', async () => {
    const { repository } = setup(ProductionOrderStatus.PLANNED);

    await expect(repository.complete(makeCompleteData())).rejects.toThrow(
      ProductionCompletionConflictError,
    );
  });

  it('idempotency replay (matching key) returns the original run and posts exactly one journal entry', async () => {
    const { repository, productionRuns, journalEntries } = setup();
    const data = makeCompleteData({ idempotencyKey: 'key-1' });

    const first = await repository.complete(data);
    const second = await repository.complete(data);

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.productionRun.id).toBe(first.productionRun.id);
    expect(second.journalEntry?.id).toBe(first.journalEntry?.id);
    expect(productionRuns.size).toBe(1);
    expect(journalEntries.size).toBe(1);
  });

  it('a mismatched idempotency key against an already-completed order still gets the existing conflict error', async () => {
    const { repository } = setup();
    await repository.complete(makeCompleteData({ idempotencyKey: 'key-1' }));

    await expect(
      repository.complete(makeCompleteData({ idempotencyKey: 'key-2' })),
    ).rejects.toThrow(ProductionCompletionConflictError);
  });

  it('throws NoOpenPeriodError when completedAt falls outside every open period, and creates no journal', async () => {
    const productionOrders = new Map([
      [
        'order-1',
        { id: 'order-1', organisationId: 'org-1', status: ProductionOrderStatus.IN_PROGRESS },
      ],
    ]);
    const fake = makeFakeDb({ productionOrders, openPeriod: null });
    const repository = new ProductionRunRepository(makePrisma(fake.db));

    await expect(repository.complete(makeCompleteData())).rejects.toThrow(NoOpenPeriodError);
    expect(fake.journalEntries.size).toBe(0);
  });

  it('throws MissingSystemAccountError when the Finished Goods account is not configured', async () => {
    const productionOrders = new Map([
      [
        'order-1',
        { id: 'order-1', organisationId: 'org-1', status: ProductionOrderStatus.IN_PROGRESS },
      ],
    ]);
    const fake = makeFakeDb({
      productionOrders,
      accounts: { WIP: 'account-wip' }, // FINISHED_GOODS_INVENTORY missing
    });
    const repository = new ProductionRunRepository(makePrisma(fake.db));

    await expect(repository.complete(makeCompleteData())).rejects.toThrow(
      MissingSystemAccountError,
    );
  });

  it('accepts a rejection reason and notes without affecting the accounting split', async () => {
    const { repository, journalEntries } = setup();

    const result = await repository.complete(
      makeCompleteData({
        producedQuantity: 100,
        rejectedQuantity: 10,
        acceptedQuantity: 90,
        totalWipValue: 90_000,
        rejectionReason: ProductionRejectionReason.BURNT,
        rejectionNotes: 'edges burnt',
      }),
    );

    expect(result.productionRun.rejectionReason).toBe(ProductionRejectionReason.BURNT);
    const entry = journalEntries.get(result.journalEntry!.id) as {
      lines: { create: { accountId: string; debit: number; credit: number }[] };
    };
    const fgLine = entry.lines.create.find((line) => line.accountId === 'account-fg')!;
    const lossLine = entry.lines.create.find((line) => line.accountId === 'account-loss')!;
    expect(fgLine.debit).toBe(81_000);
    expect(lossLine.debit).toBe(9_000);
  });
});
