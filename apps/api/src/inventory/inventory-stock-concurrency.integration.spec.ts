import { PrismaClient } from '@prisma/client';

import {
  applyStockAdjustmentIfNonNegative,
  decrementStockIfAvailable,
} from './inventory-stock-concurrency.util';

/**
 * Sprint 37.1 — Inventory Fulfillment Concurrency Integrity Hardening.
 *
 * Genuine PostgreSQL concurrency tests for the atomic primitives in
 * `inventory-stock-concurrency.util.ts` — the exact defect class live-verified against
 * the real dev database during Sprint 37 (docs/domains/d2c.md §78: two orders racing
 * for the same limited stock could both be marked fulfilled while stock was decremented
 * only once) cannot be proven or disproven by a mock; a mocked mutation runs to
 * completion in one synchronous tick with nothing else able to interleave, so it can
 * never demonstrate a genuine lost-update race one way or the other. This file connects
 * to the SAME database `apps/api/.env` already points the running application at
 * (whatever `DATABASE_URL` resolves to for this environment) and fires real concurrent
 * `Promise.all` requests against real Postgres rows.
 *
 * Deliberately NOT part of the default `pnpm test` run (see `jest.config.js`'s
 * `testPathIgnorePatterns` and the new `jest.integration.config.js`) — every other spec
 * in this codebase is fully mocked and runs in milliseconds with no database at all;
 * requiring a live Postgres connection for the default suite would break that for every
 * other contributor and CI runner. Run explicitly with `pnpm run test:integration`.
 *
 * Uses a dedicated, disposable `Product`/`InventoryLocation` pair created in
 * `beforeAll` and destroyed in `afterAll` — never a real seeded product, so this test's
 * own stock manipulation can never corrupt or race against unrelated dev/demo data or
 * any other live-verification session using the same database.
 */
describe('Inventory Stock Concurrency (real PostgreSQL, genuine concurrent transactions)', () => {
  const prisma = new PrismaClient();
  let organisationId: string;
  let locationId: string;
  let productId: string;
  let productId2: string;

  beforeAll(async () => {
    const organisation = await prisma.organisation.findFirstOrThrow({ select: { id: true } });
    organisationId = organisation.id;

    const location = await prisma.inventoryLocation.create({
      data: {
        organisationId,
        name: `Sprint 37.1 Concurrency Test Location ${Date.now()}`,
      },
    });
    locationId = location.id;

    const [product, product2] = await Promise.all([
      prisma.product.create({
        data: {
          organisationId,
          code: `TEST-CONC-${Date.now()}`,
          name: 'Sprint 37.1 Concurrency Test Product',
          slug: `sprint-37-1-concurrency-test-product-${Date.now()}`,
          category: 'OTHERS',
          type: 'FINISHED_PRODUCT',
          unit: 'Unit',
          status: 'ACTIVE',
        },
      }),
      prisma.product.create({
        data: {
          organisationId,
          code: `TEST-CONC2-${Date.now()}`,
          name: 'Sprint 37.1 Concurrency Test Product 2',
          slug: `sprint-37-1-concurrency-test-product-2-${Date.now()}`,
          category: 'OTHERS',
          type: 'FINISHED_PRODUCT',
          unit: 'Unit',
          status: 'ACTIVE',
        },
      }),
    ]);
    productId = product.id;
    productId2 = product2.id;
  });

  afterAll(async () => {
    await prisma.inventoryTransaction.deleteMany({
      where: { productId: { in: [productId, productId2] } },
    });
    await prisma.inventoryStock.deleteMany({
      where: { productId: { in: [productId, productId2] } },
    });
    await prisma.product.deleteMany({ where: { id: { in: [productId, productId2] } } });
    await prisma.inventoryLocation.delete({ where: { id: locationId } });
    await prisma.$disconnect();
  });

  async function seedStock(quantityOnHand: number, ofProductId: string = productId): Promise<void> {
    await prisma.inventoryStock.upsert({
      where: {
        organisationId_productId_locationId: { organisationId, productId: ofProductId, locationId },
      },
      create: { organisationId, productId: ofProductId, locationId, quantityOnHand },
      update: { quantityOnHand },
    });
  }

  async function getQuantityOnHandFor(ofProductId: string): Promise<number> {
    const stock = await prisma.inventoryStock.findUniqueOrThrow({
      where: {
        organisationId_productId_locationId: { organisationId, productId: ofProductId, locationId },
      },
      select: { quantityOnHand: true },
    });
    return stock.quantityOnHand;
  }

  async function getQuantityOnHand(): Promise<number> {
    const stock = await prisma.inventoryStock.findUniqueOrThrow({
      where: { organisationId_productId_locationId: { organisationId, productId, locationId } },
      select: { quantityOnHand: true },
    });
    return stock.quantityOnHand;
  }

  /** Runs `decrementStockIfAvailable` inside its own real `$transaction`, exactly the
   *  way every production call site does — never a bare, transaction-less call. */
  async function decrementInOwnTransaction(quantity: number): Promise<boolean> {
    return prisma.$transaction((tx) =>
      decrementStockIfAvailable(tx, { organisationId, productId, locationId }, quantity),
    );
  }

  // Brief Section 10, Test A — two orders, insufficient total stock.
  it('Test A: two concurrent 15-unit decrements against 23 in stock — exactly 1 succeeds, exactly 1 fails, no lost update', async () => {
    await seedStock(23);

    const results = await Promise.allSettled([
      decrementInOwnTransaction(15),
      decrementInOwnTransaction(15),
    ]);

    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value === true);
    const failed = results.filter((r) => r.status === 'fulfilled' && r.value === false);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);

    const finalQuantity = await getQuantityOnHand();
    expect(finalQuantity).toBe(8);
    expect(finalQuantity).toBeGreaterThanOrEqual(0);
  });

  // Brief Section 10, Test B — two orders, exactly enough total stock.
  it('Test B: two concurrent 15-unit decrements against exactly 30 in stock — both succeed, final quantity is 0', async () => {
    await seedStock(30);

    const results = await Promise.all([
      decrementInOwnTransaction(15),
      decrementInOwnTransaction(15),
    ]);

    expect(results).toEqual([true, true]);
    const finalQuantity = await getQuantityOnHand();
    expect(finalQuantity).toBe(0);
  });

  // Brief Section 10, Test C — more demand than stock, three-way contention.
  it('Test C: three concurrent 15-unit decrements against 30 in stock — exactly 2 succeed, exactly 1 fails, final quantity is 0', async () => {
    await seedStock(30);

    const results = await Promise.all([
      decrementInOwnTransaction(15),
      decrementInOwnTransaction(15),
      decrementInOwnTransaction(15),
    ]);

    const succeededCount = results.filter((r) => r === true).length;
    const failedCount = results.filter((r) => r === false).length;
    expect(succeededCount).toBe(2);
    expect(failedCount).toBe(1);
    const finalQuantity = await getQuantityOnHand();
    expect(finalQuantity).toBe(0);
  });

  // Brief Section 10, Test D — a single request exceeding available stock.
  it('Test D: a single 15-unit decrement against only 10 in stock fails cleanly, stock unchanged', async () => {
    await seedStock(10);

    const succeeded = await decrementInOwnTransaction(15);

    expect(succeeded).toBe(false);
    expect(await getQuantityOnHand()).toBe(10);
  });

  // Brief Section 12 — a larger-scale stress test, same invariant at higher contention.
  it('Stress: 10 concurrent 15-unit decrements against 100 in stock — successes exhaust stock exactly, never negative', async () => {
    await seedStock(100);

    const results = await Promise.all(
      Array.from({ length: 10 }, () => decrementInOwnTransaction(15)),
    );

    const succeededCount = results.filter((r) => r === true).length;
    const failedCount = results.filter((r) => r === false).length;
    // floor(100 / 15) = 6 whole decrements fit; the remaining 4 must fail.
    expect(succeededCount).toBe(6);
    expect(failedCount).toBe(4);
    const finalQuantity = await getQuantityOnHand();
    expect(finalQuantity).toBe(10);
    expect(finalQuantity).toBeGreaterThanOrEqual(0);
    // The core invariant (brief §24): initial = remaining + successfully consumed.
    expect(100).toBe(finalQuantity + succeededCount * 15);
  });

  // The bidirectional adjustment primitive — same guarantee, both directions of delta.
  it('applyStockAdjustmentIfNonNegative: 5 concurrent -30 adjustments against 100 in stock never go negative', async () => {
    await seedStock(100);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        prisma.$transaction((tx) =>
          applyStockAdjustmentIfNonNegative(tx, { organisationId, productId, locationId }, -30),
        ),
      ),
    );

    const succeededCount = results.filter((r) => r === true).length;
    expect(succeededCount).toBe(3);
    const finalQuantity = await getQuantityOnHand();
    expect(finalQuantity).toBe(10);
    expect(finalQuantity).toBeGreaterThanOrEqual(0);
  });

  // Brief Section 9/Section 10 Test F — a multi-item transaction where a LATER item's
  // decrement fails must roll back an EARLIER item's already-applied decrement in the
  // SAME transaction. This is genuinely different from Tests A-D (concurrency across
  // separate transactions) — it verifies real Postgres transaction atomicity across
  // multiple sequential statements inside ONE transaction, which a mock (no real COMMIT/
  // ROLLBACK) cannot prove either way. `SalesFulfilmentRepository.create()`'s own
  // multi-item loop calls `decrementStockIfAvailable` exactly this way — once per item,
  // inside its single `$transaction` — so this proves the exact shape production code
  // relies on, without needing to also stand up a full SalesOrder/accounting fixture.
  it('Test F: a mid-transaction failure rolls back an earlier, already-applied decrement in the same transaction', async () => {
    await seedStock(50, productId); // plenty
    await seedStock(5, productId2); // not enough for the second item below

    await expect(
      prisma.$transaction(async (tx) => {
        const firstOk = await decrementStockIfAvailable(
          tx,
          { organisationId, productId, locationId },
          20,
        );
        if (!firstOk) throw new Error('unexpected: first item should have succeeded');
        const secondOk = await decrementStockIfAvailable(
          tx,
          { organisationId, productId: productId2, locationId },
          10, // more than the 5 available
        );
        if (!secondOk) {
          throw new Error('insufficient stock for second item — the whole transaction must abort');
        }
      }),
    ).rejects.toThrow('insufficient stock for second item');

    // The first item's decrement must have been rolled back along with everything
    // else in the transaction — never left partially applied.
    expect(await getQuantityOnHandFor(productId)).toBe(50);
    expect(await getQuantityOnHandFor(productId2)).toBe(5);
  });
});
