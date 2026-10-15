import { Prisma } from '@prisma/client';

import {
  AdjustmentIdempotencyKeyConflictError,
  InventoryStockRepository,
  NegativeStockError,
} from './inventory-stock.repository';
import {
  MissingSystemAccountError,
  NoOpenPeriodError,
} from '../finance/accounting/journal-posting';
import { PrismaService } from '../prisma/prisma.service';

/**
 * A deliberate exception to this codebase's "no repository-level unit tests for atomic
 * transactions" convention — same justification as
 * `sales-fulfilment.repository.spec.ts` (Sprint 37.1): `adjustStock` is the fifth call
 * site converted to the atomic conditional-decrement pattern in
 * `inventory-stock-concurrency.util.ts`, and deserves the same focused, real-transaction-
 * callback-level coverage the other four (Sales Fulfilment, Supplier Return, Production
 * Material Issue, Maintenance Part Usage) already have — not just the service-level
 * mock `inventory.service.spec.ts` already exercises. Stage 4E.4D extends this same
 * fake with the `chartOfAccount`/`accountingPeriod`/`journalEntry` fakes
 * `goods-receipt.repository.spec.ts`/`payment.repository.spec.ts` already use, so
 * `postSystemJournalEntry` (a real, unmocked import) succeeds deterministically here
 * too — the new journal-posting decision logic (which account, which side, when to
 * skip) is worth verifying against the real transaction callback, not a
 * re-implementation of it.
 */
interface StockKey {
  organisationId: string;
  productId: string;
  locationId: string;
}

function stockKey(k: StockKey): string {
  return `${k.organisationId}:${k.productId}:${k.locationId}`;
}

const PRODUCT = {
  id: 'product-1',
  code: 'PRD-000001',
  name: 'Plantain Chips',
  unit: 'Pack',
  type: 'FINISHED_PRODUCT',
};
const FINISHED_PRODUCT = PRODUCT;
const RAW_MATERIAL_PRODUCT = {
  id: 'product-2',
  code: 'PRD-000002',
  name: 'Flour',
  unit: 'Kg',
  type: 'RAW_MATERIAL',
};
const LOCATION = { id: 'loc-1', name: 'Main Warehouse' };

function idempotencyKeyMapKey(organisationId: string, idempotencyKey: string): string {
  return `${organisationId}:${idempotencyKey}`;
}

function makeRepository(
  initialStock?: {
    key: StockKey;
    quantityOnHand: number;
    averageUnitCost?: number;
    ownership?: string;
    product?: { type: string };
  },
  accountingOptions: {
    accounts?: Record<string, string>;
    openPeriod?: { startDate: Date; endDate: Date } | null;
  } = {},
) {
  const stock = new Map<
    string,
    {
      quantityOnHand: number;
      averageUnitCost: number;
      ownership: string;
      product: { type: string };
    }
  >();
  const transactions: Record<string, unknown>[] = [];
  // Mirrors the real `@@unique([organisationId, idempotencyKey])` constraint — only
  // ever populated for a non-null key (Postgres treats every NULL as distinct, so a
  // request with no key never collides with anything here, matching `tx.inventoryTransaction.create`'s own skip-the-map-when-no-key behaviour below).
  const transactionsByIdempotencyKey = new Map<string, Record<string, unknown>>();
  let seq = 0;
  // Lets a test force the NEXT N calls to the top-level `inventoryTransaction.findUnique`
  // to miss (return null) regardless of what is actually committed — simulating two
  // requests whose pre-checks both run before either has committed. Counted, not a
  // blanket switch: the recovery lookup `adjustStock` makes AFTER catching a P2002 must
  // still see the real winner, or the P2002-catch-and-recover path itself could never
  // resolve. See the "two genuinely concurrent requests" test.
  let forcedPreCheckMissesRemaining = 0;

  // Stage 4E.4D — same `chartOfAccount`/`accountingPeriod`/`journalEntry` fake shape as
  // `goods-receipt.repository.spec.ts`'s `makeFakeTx`. Defaults provision every account
  // the new posting logic can ever need, and an open period covering every date these
  // tests use, so existing tests (which never pass `accountingOptions`) are unaffected.
  const accounts = accountingOptions.accounts ?? {
    INVENTORY: 'account-inventory',
    FINISHED_GOODS_INVENTORY: 'account-fg-inventory',
    INVENTORY_ADJUSTMENT: 'account-inv-adjustment',
  };
  const openPeriod =
    'openPeriod' in accountingOptions
      ? accountingOptions.openPeriod
      : { startDate: new Date('2026-08-01'), endDate: new Date('2026-08-31') };
  const journalEntries = new Map<string, Record<string, unknown>>();
  let journalSequence = 0;

  if (initialStock) {
    stock.set(stockKey(initialStock.key), {
      quantityOnHand: initialStock.quantityOnHand,
      averageUnitCost: initialStock.averageUnitCost ?? 0,
      ownership: initialStock.ownership ?? 'ORGANISATION',
      product: initialStock.product ?? PRODUCT,
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
          return { ...row, product: { ...PRODUCT, ...row.product }, location: LOCATION };
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
          const created = {
            quantityOnHand: create.quantityOnHand,
            averageUnitCost: 0,
            ownership: 'ORGANISATION',
            product: PRODUCT,
          };
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
        const idempotencyKey = data.idempotencyKey as string | undefined;
        if (idempotencyKey) {
          const mapKey = idempotencyKeyMapKey(data.organisationId as string, idempotencyKey);
          if (transactionsByIdempotencyKey.has(mapKey)) {
            // Mirrors the real `@@unique([organisationId, idempotencyKey])` index —
            // a second committed row for the same key is a constraint violation, not
            // a value the fake should silently accept.
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
              code: 'P2002',
              clientVersion: '5.22.0',
            });
          }
        }
        seq += 1;
        const row = { id: `txn-${seq}`, createdAt: new Date('2026-08-15'), ...data };
        transactions.push(row);
        if (idempotencyKey) {
          transactionsByIdempotencyKey.set(
            idempotencyKeyMapKey(data.organisationId as string, idempotencyKey),
            row,
          );
        }
        return row;
      }),
    },
    // Stage 4E.4D — same fake shape as `goods-receipt.repository.spec.ts`'s
    // `makeFakeTx`, so the real, unmocked `postSystemJournalEntry` succeeds (or fails)
    // deterministically against these in-memory accounts/period/journal maps.
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
              return entry;
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

  const prisma = {
    // Real Postgres rolls every mutation inside `$transaction` back together on any
    // throw — this fake has no real transaction to rely on, so it snapshots `stock`/
    // `transactions`/`journalEntries` beforehand and restores all three on a throw,
    // closing the gap that would otherwise let a test observe a stock mutation, an
    // `InventoryTransaction`, or a `JournalEntry` whose own transaction never actually
    // committed (e.g. a missing-account or closed-period failure reached only after
    // the stock mutation and ledger row already applied in this fake).
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => {
      const stockSnapshot = new Map(
        Array.from(stock.entries(), ([key, value]) => [key, { ...value }] as const),
      );
      const transactionsSnapshot = [...transactions];
      const transactionsByKeySnapshot = new Map(transactionsByIdempotencyKey);
      const journalEntriesSnapshot = new Map(journalEntries);
      try {
        return await cb(tx);
      } catch (error) {
        stock.clear();
        for (const [key, value] of stockSnapshot) stock.set(key, value);
        transactions.length = 0;
        transactions.push(...transactionsSnapshot);
        transactionsByIdempotencyKey.clear();
        for (const [key, value] of transactionsByKeySnapshot)
          transactionsByIdempotencyKey.set(key, value);
        journalEntries.clear();
        for (const [key, value] of journalEntriesSnapshot) journalEntries.set(key, value);
        throw error;
      }
    }),
    inventoryTransaction: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: {
            organisationId_idempotencyKey: { organisationId: string; idempotencyKey: string };
          };
        }) => {
          if (forcedPreCheckMissesRemaining > 0) {
            forcedPreCheckMissesRemaining -= 1;
            return null;
          }
          const { organisationId, idempotencyKey } = where.organisationId_idempotencyKey;
          return (
            transactionsByIdempotencyKey.get(
              idempotencyKeyMapKey(organisationId, idempotencyKey),
            ) ?? null
          );
        },
      ),
    },
    // Used only by `resolveExistingAdjustment`'s re-fetch after an idempotent
    // retry/race is resolved — reads the same `stock` map `tx.inventoryStock` mutates.
    inventoryStock: {
      findUniqueOrThrow: tx.inventoryStock.findUniqueOrThrow,
    },
    // Used only by `resolveExistingAdjustment`'s "what did the original call post?"
    // lookup on a retry — reads the same `journalEntries` map `tx.journalEntry` writes.
    journalEntry: {
      findUnique: tx.journalEntry.findUnique,
    },
  } as unknown as PrismaService;

  const repository = new InventoryStockRepository(prisma);
  return {
    repository,
    stock,
    transactions,
    journalEntries,
    accounts,
    forcePreCheckMisses: (count: number) => {
      forcedPreCheckMissesRemaining = count;
    },
  };
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

  // Added Stage 4E.4B — Inventory Adjustment Idempotency.
  describe('idempotencyKey', () => {
    it('first call with a key applies the adjustment and reports wasCreated: true', async () => {
      const { repository, stock } = makeRepository({ key: baseData, quantityOnHand: 100 });

      const result = await repository.adjustStock({
        ...baseData,
        quantity: 10,
        idempotencyKey: 'key-1',
      });

      expect(result.wasCreated).toBe(true);
      expect(result.stock.quantityOnHand).toBe(110);
      expect(stock.get(stockKey(baseData))!.quantityOnHand).toBe(110);
    });

    it('a sequential retry with the same key and identical payload does not reapply the stock change', async () => {
      const { repository, stock } = makeRepository({ key: baseData, quantityOnHand: 100 });

      const first = await repository.adjustStock({
        ...baseData,
        quantity: 10,
        idempotencyKey: 'key-1',
      });
      const retry = await repository.adjustStock({
        ...baseData,
        quantity: 10,
        idempotencyKey: 'key-1',
      });

      expect(retry.wasCreated).toBe(false);
      expect(retry.transaction.id).toBe(first.transaction.id);
      expect(retry.stock.quantityOnHand).toBe(110);
      // Applied exactly once — a second identical request never moves stock again.
      expect(stock.get(stockKey(baseData))!.quantityOnHand).toBe(110);
    });

    it('reusing the same key with a conflicting quantity is rejected, not silently treated as a retry', async () => {
      const { repository, stock } = makeRepository({ key: baseData, quantityOnHand: 100 });

      await repository.adjustStock({ ...baseData, quantity: 10, idempotencyKey: 'key-1' });

      await expect(
        repository.adjustStock({ ...baseData, quantity: 20, idempotencyKey: 'key-1' }),
      ).rejects.toThrow(AdjustmentIdempotencyKeyConflictError);
      // The rejected conflicting request must not have touched stock beyond the
      // original, successfully-applied adjustment.
      expect(stock.get(stockKey(baseData))!.quantityOnHand).toBe(110);
    });

    it('reusing the same key with a conflicting reason is rejected', async () => {
      const { repository } = makeRepository({ key: baseData, quantityOnHand: 100 });

      await repository.adjustStock({ ...baseData, quantity: 10, idempotencyKey: 'key-1' });

      await expect(
        repository.adjustStock({
          ...baseData,
          quantity: 10,
          reason: 'DAMAGE',
          idempotencyKey: 'key-1',
        }),
      ).rejects.toThrow(AdjustmentIdempotencyKeyConflictError);
    });

    it('the same key is independent across different organisations', async () => {
      const { repository, stock } = makeRepository({ key: baseData, quantityOnHand: 100 });
      stock.set(stockKey({ ...baseData, organisationId: 'org-2' }), {
        quantityOnHand: 100,
        averageUnitCost: 0,
        ownership: 'ORGANISATION',
        product: PRODUCT,
      });

      const org1Result = await repository.adjustStock({
        ...baseData,
        quantity: 10,
        idempotencyKey: 'shared-key',
      });
      const org2Result = await repository.adjustStock({
        ...baseData,
        organisationId: 'org-2',
        quantity: 10,
        idempotencyKey: 'shared-key',
      });

      expect(org1Result.wasCreated).toBe(true);
      expect(org2Result.wasCreated).toBe(true);
      expect(org1Result.transaction.id).not.toBe(org2Result.transaction.id);
      expect(stock.get(stockKey(baseData))!.quantityOnHand).toBe(110);
      expect(stock.get(stockKey({ ...baseData, organisationId: 'org-2' }))!.quantityOnHand).toBe(
        110,
      );
    });

    it('a failed (negative-stock) adjustment never consumes the key — a later valid retry with the same key succeeds', async () => {
      const { repository, stock } = makeRepository({ key: baseData, quantityOnHand: 5 });

      await expect(
        repository.adjustStock({ ...baseData, quantity: -15, idempotencyKey: 'key-1' }),
      ).rejects.toThrow(NegativeStockError);
      expect(stock.get(stockKey(baseData))!.quantityOnHand).toBe(5);

      // Same key, now a valid (smaller) adjustment — must be treated as a brand-new
      // request, not blocked by the previous failed attempt.
      const retry = await repository.adjustStock({
        ...baseData,
        quantity: -3,
        idempotencyKey: 'key-1',
      });

      expect(retry.wasCreated).toBe(true);
      expect(retry.stock.quantityOnHand).toBe(2);
    });

    it('no idempotencyKey supplied: every call is independent, same as before this stage', async () => {
      const { repository, stock } = makeRepository({ key: baseData, quantityOnHand: 100 });

      const first = await repository.adjustStock({ ...baseData, quantity: 10 });
      const second = await repository.adjustStock({ ...baseData, quantity: 10 });

      expect(first.wasCreated).toBe(true);
      expect(second.wasCreated).toBe(true);
      expect(first.transaction.id).not.toBe(second.transaction.id);
      expect(stock.get(stockKey(baseData))!.quantityOnHand).toBe(120);
    });

    it('two genuinely concurrent requests with the same key (both miss the pre-check) still apply the stock change exactly once', async () => {
      const { repository, stock, forcePreCheckMisses } = makeRepository({
        key: baseData,
        quantityOnHand: 100,
      });

      // Simulates the true race the pre-check alone cannot close: both requests'
      // pre-checks run before either has committed, so both see "no existing
      // transaction" and both proceed to attempt the mutation + create. The fake's
      // `tx.inventoryTransaction.create` still enforces the real unique-index
      // semantics (see `makeRepository`), so exactly one `create()` can win; the
      // loser must hit the P2002-catch-and-recover path, not a duplicate stock
      // mutation. Exactly 2 forced misses — one per request's own pre-check; the
      // loser's post-P2002 recovery lookup (a 3rd call) must see the real winner, or
      // the recovery path itself could never resolve.
      forcePreCheckMisses(2);
      const first = await repository.adjustStock({
        ...baseData,
        quantity: 10,
        idempotencyKey: 'race-key',
      });
      const second = await repository.adjustStock({
        ...baseData,
        quantity: 10,
        idempotencyKey: 'race-key',
      });

      const outcomes = [first, second];
      expect(outcomes.filter((r) => r.wasCreated)).toHaveLength(1);
      expect(outcomes.filter((r) => !r.wasCreated)).toHaveLength(1);
      expect(first.transaction.id).toBe(second.transaction.id);
      // The delta of +10 was applied exactly once, not twice.
      expect(stock.get(stockKey(baseData))!.quantityOnHand).toBe(110);
    });
  });

  describe('Stage 4E.4D — journal posting', () => {
    it('a positive, value-bearing adjustment debits Inventory and credits Inventory Adjustment', async () => {
      const { repository, journalEntries, accounts } = makeRepository({
        key: baseData,
        quantityOnHand: 100,
        averageUnitCost: 25,
        product: RAW_MATERIAL_PRODUCT,
      });

      const result = await repository.adjustStock({
        ...baseData,
        reason: 'FOUND_STOCK',
        quantity: 10,
      });

      expect(result.journalEntryId).not.toBeNull();
      const entry = journalEntries.get(result.journalEntryId!) as { lines: { create: unknown[] } };
      const lines = entry.lines.create as { accountId: string; debit: number; credit: number }[];
      expect(lines).toEqual([
        { accountId: accounts.INVENTORY, description: undefined, debit: 250, credit: 0 },
        { accountId: accounts.INVENTORY_ADJUSTMENT, description: undefined, debit: 0, credit: 250 },
      ]);
    });

    it('a negative, value-bearing adjustment debits Inventory Adjustment and credits Inventory', async () => {
      const { repository, journalEntries, accounts } = makeRepository({
        key: baseData,
        quantityOnHand: 100,
        averageUnitCost: 25,
        product: RAW_MATERIAL_PRODUCT,
      });

      const result = await repository.adjustStock({
        ...baseData,
        reason: 'DAMAGE',
        quantity: -10,
      });

      expect(result.journalEntryId).not.toBeNull();
      const entry = journalEntries.get(result.journalEntryId!) as { lines: { create: unknown[] } };
      const lines = entry.lines.create as { accountId: string; debit: number; credit: number }[];
      expect(lines).toEqual([
        { accountId: accounts.INVENTORY_ADJUSTMENT, description: undefined, debit: 250, credit: 0 },
        { accountId: accounts.INVENTORY, description: undefined, debit: 0, credit: 250 },
      ]);
    });

    it('a finished-product adjustment posts against Finished Goods Inventory, not the raw-material Inventory account', async () => {
      const { repository, journalEntries, accounts } = makeRepository({
        key: baseData,
        quantityOnHand: 100,
        averageUnitCost: 25,
        product: FINISHED_PRODUCT,
      });

      const result = await repository.adjustStock({
        ...baseData,
        reason: 'FOUND_STOCK',
        quantity: 10,
      });

      const entry = journalEntries.get(result.journalEntryId!) as { lines: { create: unknown[] } };
      const lines = entry.lines.create as { accountId: string }[];
      expect(lines.map((l) => l.accountId)).toContain(accounts.FINISHED_GOODS_INVENTORY);
      expect(lines.map((l) => l.accountId)).not.toContain(accounts.INVENTORY);
    });

    it('a raw-material adjustment posts against the general Inventory account, not Finished Goods Inventory', async () => {
      const { repository, journalEntries, accounts } = makeRepository({
        key: baseData,
        quantityOnHand: 100,
        averageUnitCost: 25,
        product: RAW_MATERIAL_PRODUCT,
      });

      const result = await repository.adjustStock({
        ...baseData,
        reason: 'FOUND_STOCK',
        quantity: 10,
      });

      const entry = journalEntries.get(result.journalEntryId!) as { lines: { create: unknown[] } };
      const lines = entry.lines.create as { accountId: string }[];
      expect(lines.map((l) => l.accountId)).toContain(accounts.INVENTORY);
      expect(lines.map((l) => l.accountId)).not.toContain(accounts.FINISHED_GOODS_INVENTORY);
    });

    it('a zero-cost adjustment creates the InventoryTransaction but posts no journal', async () => {
      const { repository, transactions } = makeRepository({
        key: baseData,
        quantityOnHand: 100,
        averageUnitCost: 0,
      });

      const result = await repository.adjustStock({
        ...baseData,
        reason: 'FOUND_STOCK',
        quantity: 10,
      });

      expect(result.journalEntryId).toBeNull();
      expect(result.stock.quantityOnHand).toBe(110);
      expect(transactions).toHaveLength(1);
    });

    it('a CUSTOMER-owned adjustment moves stock but never posts to the company inventory accounts, even at a real cost', async () => {
      const { repository, transactions } = makeRepository({
        key: baseData,
        quantityOnHand: 100,
        averageUnitCost: 25,
        ownership: 'CUSTOMER',
      });

      const result = await repository.adjustStock({
        ...baseData,
        reason: 'PHYSICAL_COUNT',
        quantity: -10,
      });

      expect(result.journalEntryId).toBeNull();
      expect(result.stock.quantityOnHand).toBe(90);
      expect(transactions).toHaveLength(1);
    });

    it('DATA_CORRECTION is value-bearing like any other reason — not exempt by its label', async () => {
      const { repository } = makeRepository({
        key: baseData,
        quantityOnHand: 100,
        averageUnitCost: 25,
      });

      const result = await repository.adjustStock({
        ...baseData,
        reason: 'DATA_CORRECTION',
        quantity: 10,
      });

      expect(result.journalEntryId).not.toBeNull();
    });

    it('OTHER is value-bearing like any other reason — not exempt by its label', async () => {
      const { repository } = makeRepository({
        key: baseData,
        quantityOnHand: 100,
        averageUnitCost: 25,
      });

      const result = await repository.adjustStock({
        ...baseData,
        reason: 'OTHER',
        quantity: 10,
      });

      expect(result.journalEntryId).not.toBeNull();
    });

    it('rounds the posted amount to 2 decimal places and keeps both lines exactly equal', async () => {
      const { repository, journalEntries } = makeRepository({
        key: baseData,
        quantityOnHand: 100,
        // 7 x 3.333 = 23.331 -> rounds to 23.33.
        averageUnitCost: 3.333,
      });

      const result = await repository.adjustStock({
        ...baseData,
        reason: 'FOUND_STOCK',
        quantity: 7,
      });

      const entry = journalEntries.get(result.journalEntryId!) as { lines: { create: unknown[] } };
      const lines = entry.lines.create as { debit: number; credit: number }[];
      expect(lines[0]!.debit).toBe(23.33);
      expect(lines[1]!.credit).toBe(23.33);
    });

    it('a missing system account rolls back the stock mutation and the InventoryTransaction together', async () => {
      const { repository, stock, transactions } = makeRepository(
        { key: baseData, quantityOnHand: 100, averageUnitCost: 25 },
        { accounts: { INVENTORY: 'account-inventory' } }, // INVENTORY_ADJUSTMENT deliberately missing.
      );

      await expect(
        repository.adjustStock({ ...baseData, reason: 'FOUND_STOCK', quantity: 10 }),
      ).rejects.toThrow(MissingSystemAccountError);

      expect(stock.get(stockKey(baseData))!.quantityOnHand).toBe(100);
      expect(transactions).toHaveLength(0);
    });

    it('a closed/missing accounting period rolls back the stock mutation and the InventoryTransaction together', async () => {
      const { repository, stock, transactions } = makeRepository(
        { key: baseData, quantityOnHand: 100, averageUnitCost: 25 },
        { openPeriod: null },
      );

      await expect(
        repository.adjustStock({ ...baseData, reason: 'FOUND_STOCK', quantity: 10 }),
      ).rejects.toThrow(NoOpenPeriodError);

      expect(stock.get(stockKey(baseData))!.quantityOnHand).toBe(100);
      expect(transactions).toHaveLength(0);
    });

    it('a sequential retry returns the same journalEntryId without posting a second journal', async () => {
      const { repository, journalEntries } = makeRepository({
        key: baseData,
        quantityOnHand: 100,
        averageUnitCost: 25,
      });
      const idempotencyKey = 'journal-retry-key';

      const first = await repository.adjustStock({
        ...baseData,
        reason: 'FOUND_STOCK',
        quantity: 10,
        idempotencyKey,
      });
      const retry = await repository.adjustStock({
        ...baseData,
        reason: 'FOUND_STOCK',
        quantity: 10,
        idempotencyKey,
      });

      expect(retry.journalEntryId).toBe(first.journalEntryId);
      expect(journalEntries.size).toBe(1);
    });

    it('a retry of a zero-cost (no-journal) adjustment also returns journalEntryId: null, not a fabricated one', async () => {
      const { repository } = makeRepository({
        key: baseData,
        quantityOnHand: 100,
        averageUnitCost: 0,
      });
      const idempotencyKey = 'journal-retry-zero-cost';

      const first = await repository.adjustStock({
        ...baseData,
        reason: 'FOUND_STOCK',
        quantity: 10,
        idempotencyKey,
      });
      const retry = await repository.adjustStock({
        ...baseData,
        reason: 'FOUND_STOCK',
        quantity: 10,
        idempotencyKey,
      });

      expect(first.journalEntryId).toBeNull();
      expect(retry.journalEntryId).toBeNull();
    });
  });
});
