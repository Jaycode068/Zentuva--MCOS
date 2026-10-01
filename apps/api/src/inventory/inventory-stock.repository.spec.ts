import { InventoryStockRepository, NegativeStockError } from './inventory-stock.repository';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A deliberate exception to this codebase's "no repository-level unit tests for atomic
 * transactions" convention — same justification as
 * `sales-fulfilment.repository.spec.ts` (Sprint 37.1): `adjustStock` is the fifth call
 * site converted to the atomic conditional-decrement pattern in
 * `inventory-stock-concurrency.util.ts`, and deserves the same focused, real-transaction-
 * callback-level coverage the other four (Sales Fulfilment, Supplier Return, Production
 * Material Issue, Maintenance Part Usage) already have — not just the service-level
 * mock `inventory.service.spec.ts` already exercises.
 */
interface StockKey {
  organisationId: string;
  productId: string;
  locationId: string;
}

function stockKey(k: StockKey): string {
  return `${k.organisationId}:${k.productId}:${k.locationId}`;
}

const PRODUCT = { id: 'product-1', code: 'PRD-000001', name: 'Plantain Chips', unit: 'Pack' };
const LOCATION = { id: 'loc-1', name: 'Main Warehouse' };

function makeRepository(initialStock?: { key: StockKey; quantityOnHand: number }) {
  const stock = new Map<string, { quantityOnHand: number; averageUnitCost: number }>();
  const transactions: Record<string, unknown>[] = [];
  let seq = 0;

  if (initialStock) {
    stock.set(stockKey(initialStock.key), {
      quantityOnHand: initialStock.quantityOnHand,
      averageUnitCost: 0,
    });
  }

  const tx = {
    inventoryStock: {
      findUnique: jest.fn(
        async ({ where }: { where: { organisationId_productId_locationId: StockKey } }) => {
          return stock.get(stockKey(where.organisationId_productId_locationId)) ?? null;
        },
      ),
      findUniqueOrThrow: jest.fn(
        async ({ where }: { where: { organisationId_productId_locationId: StockKey } }) => {
          const row = stock.get(stockKey(where.organisationId_productId_locationId));
          if (!row) throw new Error('not found');
          return { ...row, product: PRODUCT, location: LOCATION };
        },
      ),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { organisationId_productId_locationId: StockKey };
          create: { quantityOnHand: number };
          update: { quantityOnHand: { increment: number } };
        }) => {
          const key = stockKey(where.organisationId_productId_locationId);
          const existing = stock.get(key);
          if (existing) {
            existing.quantityOnHand += update.quantityOnHand.increment;
            return existing;
          }
          const created = { quantityOnHand: create.quantityOnHand, averageUnitCost: 0 };
          stock.set(key, created);
          return created;
        },
      ),
      // Sprint 37.1 — mirrors the real atomic-conditional-decrement semantics
      // `applyStockAdjustmentIfNonNegative` relies on for a negative delta: only
      // mutates (and only reports `count: 1`) when a row exists AND its
      // `quantityOnHand` already satisfies the `gte` filter.
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: StockKey & { quantityOnHand: { gte: number } };
          data: { quantityOnHand: { increment: number } };
        }) => {
          const key = stockKey(where);
          const existing = stock.get(key);
          if (!existing || existing.quantityOnHand < where.quantityOnHand.gte) {
            return { count: 0 };
          }
          existing.quantityOnHand += data.quantityOnHand.increment;
          return { count: 1 };
        },
      ),
    },
    inventoryTransaction: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `txn-${seq}`, ...data };
        transactions.push(row);
        return row;
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;

  const repository = new InventoryStockRepository(prisma);
  return { repository, stock, transactions };
}

describe('InventoryStockRepository.adjustStock (deliberate exception — real transaction logic under test)', () => {
  const baseData = {
    organisationId: 'org-1',
    productId: 'product-1',
    locationId: 'loc-1',
    reason: 'PHYSICAL_COUNT' as const,
    createdById: 'user-1',
  };

  it('applies a positive adjustment against a location with no existing stock row (create path)', async () => {
    const { repository, stock } = makeRepository();

    const result = await repository.adjustStock({ ...baseData, quantity: 10 });

    expect(result.stock.quantityOnHand).toBe(10);
    expect(stock.get(stockKey(baseData))!.quantityOnHand).toBe(10);
  });

  it('applies a negative adjustment when sufficient stock exists', async () => {
    const { repository, stock } = makeRepository({ key: baseData, quantityOnHand: 50 });

    const result = await repository.adjustStock({ ...baseData, quantity: -20 });

    expect(result.stock.quantityOnHand).toBe(30);
    expect(stock.get(stockKey(baseData))!.quantityOnHand).toBe(30);
  });

  it('rejects a negative adjustment that would result in negative stock, leaving stock untouched', async () => {
    const { repository, stock } = makeRepository({ key: baseData, quantityOnHand: 10 });

    await expect(repository.adjustStock({ ...baseData, quantity: -15 })).rejects.toThrow(
      NegativeStockError,
    );
    expect(stock.get(stockKey(baseData))!.quantityOnHand).toBe(10);
  });

  it('rejects a negative adjustment against a location with no stock row at all', async () => {
    const { repository } = makeRepository();

    await expect(repository.adjustStock({ ...baseData, quantity: -1 })).rejects.toThrow(
      NegativeStockError,
    );
  });

  // This mocked fake has no real I/O to interleave on, so `Promise.allSettled` here
  // exercises repeated sequential application of the guard, not genuine database
  // concurrency — that claim is reserved for the real-Postgres integration test in
  // `inventory-stock-concurrency.integration.spec.ts` (Sprint 37.1). What this DOES
  // verify: the guard's logic converges to the correct final state (exactly enough
  // successes to exhaust available stock, the rest correctly rejected, never negative)
  // rather than a bug that mis-counts across repeated calls.
  it('5 repeated negative adjustments against the same row converge to a correct, never-negative final balance', async () => {
    const { repository, stock } = makeRepository({ key: baseData, quantityOnHand: 100 });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => repository.adjustStock({ ...baseData, quantity: -30 })),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    // 100 / 30 = 3 whole decrements fit; the 4th and 5th must be rejected.
    expect(succeeded).toHaveLength(3);
    expect(failed).toHaveLength(2);
    expect(stock.get(stockKey(baseData))!.quantityOnHand).toBe(10);
    expect(stock.get(stockKey(baseData))!.quantityOnHand).toBeGreaterThanOrEqual(0);
  });
});
