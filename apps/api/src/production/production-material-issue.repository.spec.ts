import { ProductionOrderStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  MissingSystemAccountError,
  NoOpenPeriodError,
} from '../finance/accounting/journal-posting';
import {
  InsufficientStockError,
  IssueMaterialData,
  ProductionMaterialIssueConflictError,
  ProductionMaterialIssueRepository,
} from './production-material-issue.repository';

/**
 * A deliberate exception to this codebase's "no repository-level unit tests for atomic
 * transactions" convention — same justification as `goods-receipt.repository.spec.ts`
 * (Sprint 8): money correctness at exact scenarios is worth it. Combines the
 * "in-memory fake `tx`" technique that file established with one addition this file
 * specifically needs — `getTotalWipValue`/`findJournalEntriesByProductionOrder` are
 * called by `ProductionOrderService` directly against `this.prisma`, not from inside a
 * `$transaction`, so the fake here exposes the same model methods both at the
 * top level (`prisma.X`) and inside `$transaction`'s callback (`tx.X`) — the literal
 * same functions operating on the same in-memory maps, since nothing here tests real
 * transactional isolation, only the business logic built on top of it.
 */
interface FakeProductionMaterialIssueItem {
  id: string;
  componentProductId: string;
  quantityIssued: number;
}

interface FakeProductionMaterialIssue {
  id: string;
  organisationId: string;
  productionOrderId: string;
  idempotencyKey: string | null;
  items: FakeProductionMaterialIssueItem[];
}

const PRODUCT = { id: 'product-raw', code: 'PRD-000002', name: 'Plantain', unit: 'Kilogram' };

function makeFakeDb(options: {
  productionOrders: Map<
    string,
    { id: string; organisationId: string; status: ProductionOrderStatus }
  >;
  inventoryStocks?: Map<string, { quantityOnHand: number; averageUnitCost: number }>;
  materialIssues?: Map<string, FakeProductionMaterialIssue>;
  journalEntries?: Map<string, Record<string, unknown>>;
  accounts?: Record<string, string>;
  openPeriod?: { startDate: Date; endDate: Date } | null;
}) {
  const productionOrders = options.productionOrders;
  const inventoryStocks = options.inventoryStocks ?? new Map();
  const materialIssues = options.materialIssues ?? new Map<string, FakeProductionMaterialIssue>();
  const journalEntries = options.journalEntries ?? new Map<string, Record<string, unknown>>();
  const accounts = options.accounts ?? {
    WIP: 'account-wip',
    INVENTORY: 'account-inventory',
  };
  const openPeriod =
    'openPeriod' in options
      ? options.openPeriod
      : { startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') };
  const inventoryTransactions: Record<string, unknown>[] = [];
  let issueSequence = materialIssues.size;
  let journalSequence = journalEntries.size;

  const db = {
    productionOrder: {
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id: string } }) => {
        const order = productionOrders.get(where.id);
        if (!order) throw new Error('not found');
        // Real Prisma returns a fresh object per call — a shallow copy here matters
        // since the caller reads this *before* `updateMany` may mutate the order's
        // status, to compute `transitionedToInProgress`.
        return { ...order };
      }),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; organisationId: string; status: { in: ProductionOrderStatus[] } };
          data: { status: ProductionOrderStatus };
        }) => {
          const order = productionOrders.get(where.id);
          if (!order || order.organisationId !== where.organisationId) return { count: 0 };
          if (!where.status.in.includes(order.status)) return { count: 0 };
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
    productionMaterialIssue: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            productionOrderId_idempotencyKey?: {
              productionOrderId: string;
              idempotencyKey: string;
            };
          };
        }) => {
          const key = where.productionOrderId_idempotencyKey;
          if (!key) return null;
          for (const issue of materialIssues.values()) {
            if (
              issue.productionOrderId === key.productionOrderId &&
              issue.idempotencyKey === key.idempotencyKey
            ) {
              return {
                ...issue,
                items: issue.items.map((item) => ({ ...item, componentProduct: PRODUCT })),
              };
            }
          }
          return null;
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        issueSequence += 1;
        const id = `issue-${issueSequence}`;
        const itemsInput = (
          data.items as { create: { componentProductId: string; quantityIssued: number }[] }
        ).create;
        const items = itemsInput.map((item, index) => ({
          id: `issue-item-${id}-${index}`,
          ...item,
        }));
        const issue: FakeProductionMaterialIssue = {
          id,
          organisationId: data.organisationId as string,
          productionOrderId: data.productionOrderId as string,
          idempotencyKey: (data.idempotencyKey as string | undefined) ?? null,
          items,
        };
        materialIssues.set(id, issue);
        return { ...issue, items: items.map((item) => ({ ...item, componentProduct: PRODUCT })) };
      }),
      findMany: jest.fn(
        async ({ where }: { where: { organisationId: string; productionOrderId: string } }) => {
          return [...materialIssues.values()].filter(
            (issue) =>
              issue.organisationId === where.organisationId &&
              issue.productionOrderId === where.productionOrderId,
          );
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
    journalEntryLine: {
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: {
            journalEntry: {
              organisationId: string;
              sourceType: string;
              sourceId: { in: string[] };
            };
            account: { systemKey: string };
          };
        }) => {
          const lines: { debit: number }[] = [];
          for (const entry of journalEntries.values()) {
            if (
              entry.organisationId !== where.journalEntry.organisationId ||
              entry.sourceType !== where.journalEntry.sourceType ||
              !where.journalEntry.sourceId.in.includes(entry.sourceId as string)
            ) {
              continue;
            }
            const entryLines =
              (entry.lines as { create: { accountId: string; debit: number }[] } | undefined)
                ?.create ?? [];
            for (const line of entryLines) {
              if (line.accountId === accounts[where.account.systemKey]) {
                lines.push({ debit: line.debit });
              }
            }
          }
          return lines;
        },
      ),
    },
  };

  return { db, inventoryStocks, materialIssues, journalEntries, inventoryTransactions };
}

function makePrisma(db: ReturnType<typeof makeFakeDb>['db']) {
  return {
    ...db,
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(db)),
  } as unknown as PrismaService;
}

function makeIssueData(overrides: Partial<IssueMaterialData> = {}): IssueMaterialData {
  return {
    organisationId: 'org-1',
    productionOrderId: 'order-1',
    locationId: 'loc-1',
    productionOrderNumber: 'PROD-000001',
    issuedDate: new Date('2026-08-15'),
    issuedById: 'user-1',
    items: [{ componentProductId: 'product-raw', quantity: 100 }],
    ...overrides,
  };
}

describe('ProductionMaterialIssueRepository (deliberate exception — real transaction logic under test)', () => {
  function setup(
    orderStatus: ProductionOrderStatus = ProductionOrderStatus.PLANNED,
    stockOverrides: { quantityOnHand: number; averageUnitCost: number } = {
      quantityOnHand: 1000,
      averageUnitCost: 1000,
    },
  ) {
    const productionOrders = new Map([
      ['order-1', { id: 'order-1', organisationId: 'org-1', status: orderStatus }],
    ]);
    const inventoryStocks = new Map([
      [
        JSON.stringify({
          organisationId_productId_locationId: {
            organisationId: 'org-1',
            productId: 'product-raw',
            locationId: 'loc-1',
          },
        }),
        stockOverrides,
      ],
    ]);
    const fake = makeFakeDb({ productionOrders, inventoryStocks });
    const repository = new ProductionMaterialIssueRepository(makePrisma(fake.db));
    return { repository, ...fake, productionOrders };
  }

  it('happy path: posts DR WIP / CR Inventory for quantity × current averageUnitCost, and transitions PLANNED → IN_PROGRESS', async () => {
    const { repository, journalEntries, productionOrders } = setup();

    const result = await repository.issue(makeIssueData());

    expect(result.wasCreated).toBe(true);
    expect(result.transitionedToInProgress).toBe(true);
    expect(productionOrders.get('order-1')!.status).toBe(ProductionOrderStatus.IN_PROGRESS);
    expect(result.journalEntry).not.toBeNull();
    expect(result.journalEntry!.totalAmount).toBe(100_000);

    const entry = journalEntries.get(result.journalEntry!.id) as {
      lines: { create: { accountId: string; debit: number; credit: number }[] };
    };
    expect(entry.lines.create).toEqual([
      { accountId: 'account-wip', description: undefined, debit: 100_000, credit: 0 },
      { accountId: 'account-inventory', description: undefined, debit: 0, credit: 100_000 },
    ]);
  });

  it('multiple issues at different average costs each value at the cost current at their own time', async () => {
    const { repository, journalEntries, inventoryStocks } = setup(ProductionOrderStatus.PLANNED, {
      quantityOnHand: 1000,
      averageUnitCost: 1000,
    });

    const first = await repository.issue(
      makeIssueData({ items: [{ componentProductId: 'product-raw', quantity: 100 }] }),
    );
    expect(first.journalEntry!.totalAmount).toBe(100_000);

    // Simulate a Goods Receipt landing between the two issues, moving the average cost.
    const key = JSON.stringify({
      organisationId_productId_locationId: {
        organisationId: 'org-1',
        productId: 'product-raw',
        locationId: 'loc-1',
      },
    });
    inventoryStocks.get(key)!.averageUnitCost = 1200;

    const second = await repository.issue(
      makeIssueData({ items: [{ componentProductId: 'product-raw', quantity: 100 }] }),
    );
    expect(second.journalEntry!.totalAmount).toBe(120_000);
    expect(journalEntries.size).toBe(2);
  });

  it('throws InsufficientStockError when requested quantity exceeds current stock', async () => {
    const { repository } = setup(ProductionOrderStatus.PLANNED, {
      quantityOnHand: 50,
      averageUnitCost: 1000,
    });

    await expect(
      repository.issue(
        makeIssueData({ items: [{ componentProductId: 'product-raw', quantity: 100 }] }),
      ),
    ).rejects.toThrow(InsufficientStockError);
  });

  it('throws ProductionMaterialIssueConflictError when the order is not PLANNED/IN_PROGRESS', async () => {
    const { repository } = setup(ProductionOrderStatus.COMPLETED);

    await expect(repository.issue(makeIssueData())).rejects.toThrow(
      ProductionMaterialIssueConflictError,
    );
  });

  it('idempotency replay returns the original issue and posts exactly one journal entry', async () => {
    const { repository, materialIssues, journalEntries } = setup();
    const data = makeIssueData({ idempotencyKey: 'key-1' });

    const first = await repository.issue(data);
    const second = await repository.issue(data);

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.materialIssue.id).toBe(first.materialIssue.id);
    expect(second.journalEntry?.id).toBe(first.journalEntry?.id);
    expect(materialIssues.size).toBe(1);
    expect(journalEntries.size).toBe(1);
  });

  it('throws NoOpenPeriodError when the issue date falls outside every open period, and creates no journal', async () => {
    const productionOrders = new Map([
      [
        'order-1',
        { id: 'order-1', organisationId: 'org-1', status: ProductionOrderStatus.PLANNED },
      ],
    ]);
    const inventoryStocks = new Map([
      [
        JSON.stringify({
          organisationId_productId_locationId: {
            organisationId: 'org-1',
            productId: 'product-raw',
            locationId: 'loc-1',
          },
        }),
        { quantityOnHand: 1000, averageUnitCost: 1000 },
      ],
    ]);
    const fake = makeFakeDb({ productionOrders, inventoryStocks, openPeriod: null });
    const repository = new ProductionMaterialIssueRepository(makePrisma(fake.db));

    await expect(repository.issue(makeIssueData())).rejects.toThrow(NoOpenPeriodError);
    expect(fake.journalEntries.size).toBe(0);
  });

  it('throws MissingSystemAccountError when the WIP account is not configured for the organisation', async () => {
    const productionOrders = new Map([
      [
        'order-1',
        { id: 'order-1', organisationId: 'org-1', status: ProductionOrderStatus.PLANNED },
      ],
    ]);
    const inventoryStocks = new Map([
      [
        JSON.stringify({
          organisationId_productId_locationId: {
            organisationId: 'org-1',
            productId: 'product-raw',
            locationId: 'loc-1',
          },
        }),
        { quantityOnHand: 1000, averageUnitCost: 1000 },
      ],
    ]);
    const fake = makeFakeDb({
      productionOrders,
      inventoryStocks,
      accounts: { INVENTORY: 'account-inventory' }, // WIP missing
    });
    const repository = new ProductionMaterialIssueRepository(makePrisma(fake.db));

    await expect(repository.issue(makeIssueData())).rejects.toThrow(MissingSystemAccountError);
  });

  it('skips posting entirely when every issued component has a zero average cost', async () => {
    const { repository } = setup(ProductionOrderStatus.PLANNED, {
      quantityOnHand: 1000,
      averageUnitCost: 0,
    });

    const result = await repository.issue(makeIssueData());

    expect(result.journalEntry).toBeNull();
  });

  it('getTotalWipValue sums the WIP debit across every material issue posted against an order', async () => {
    const { repository } = setup(ProductionOrderStatus.PLANNED, {
      quantityOnHand: 1000,
      averageUnitCost: 1000,
    });

    await repository.issue(
      makeIssueData({ items: [{ componentProductId: 'product-raw', quantity: 100 }] }),
    );
    await repository.issue(
      makeIssueData({ items: [{ componentProductId: 'product-raw', quantity: 200 }] }),
    );

    const total = await repository.getTotalWipValue('org-1', 'order-1');
    expect(total).toBe(300_000);
  });
});
