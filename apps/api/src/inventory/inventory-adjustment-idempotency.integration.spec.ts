import { PrismaClient } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { MissingSystemAccountError } from '../finance/accounting/journal-posting';
import { InventoryValuationService } from '../finance/reports/inventory-valuation.service';
import {
  AdjustmentIdempotencyKeyConflictError,
  InventoryStockRepository,
  NegativeStockError,
} from './inventory-stock.repository';

/**
 * Stage 4E.4B — Inventory Adjustment Idempotency.
 *
 * Genuine PostgreSQL proof that `InventoryStockRepository.adjustStock`'s idempotency
 * (pre-check + `P2002`-catch-and-recover around the real `@@unique([organisationId,
 * idempotencyKey])` constraint on `InventoryTransaction`) holds under REAL concurrent
 * requests, not just sequential mocked calls — same "a mock runs the whole callback in
 * one synchronous tick, so it can never demonstrate a genuine lost-update/double-apply
 * race one way or the other" reasoning as `inventory-stock-concurrency.integration.spec.ts`
 * (Sprint 37.1) and the idempotency test already proven this way for transfers in
 * `inventory-transfer.integration.spec.ts` (Phase 2B).
 *
 * Same "dedicated, disposable fixtures created in `beforeAll`/reset in `afterEach`/
 * destroyed in `afterAll`, never real seeded data" convention as both files above — this
 * file creates its own organisation-scoped product, warehouse location, and (for the one
 * test that needs it) its own disposable Customer + Outlet + `CUSTOMER_LOCATION` — not
 * the single shared seeded outlet `inventory-transfer.integration.spec.ts` already holds
 * a `CUSTOMER_LOCATION` against for its entire suite lifetime (an outlet can only ever
 * have one `CUSTOMER_LOCATION` — a real `@@unique` constraint — so sharing it would
 * collide under parallel Jest workers regardless of timing). None of this stock
 * manipulation (including deliberately exhausting stock to provoke the negative-stock
 * failure path) can ever corrupt real dev/demo data or race against another
 * live-verification session using the same database.
 *
 * Deliberately NOT part of the default `pnpm test` run — run via `pnpm run
 * test:integration`.
 */
describe('Stage 4E.4B — Inventory Adjustment Idempotency (real PostgreSQL)', () => {
  const prisma = new PrismaClient();
  const prismaService = prisma as unknown as PrismaService;
  const repository = new InventoryStockRepository(prismaService);

  let organisationId: string;
  let warehouseLocationId: string;
  let productId: string;
  let outletId: string;
  let customerId: string;

  let otherOrganisationId: string;
  let otherOrganisationLocationId: string;
  let otherOrganisationProductId: string;

  let seq = 1;
  function nextKey(prefix: string): string {
    seq += 1;
    return `${prefix}-${Date.now()}-${seq}`;
  }

  beforeAll(async () => {
    const organisation = await prisma.organisation.findFirstOrThrow({
      where: { name: 'Boby Bites' },
      select: { id: true },
    });
    organisationId = organisation.id;

    const warehouse = await prisma.inventoryLocation.create({
      data: { organisationId, name: `TEST-4E4B-WAREHOUSE-${Date.now()}` },
    });
    warehouseLocationId = warehouse.id;

    const product = await prisma.product.create({
      data: {
        organisationId,
        code: `TEST-4E4B-${Date.now()}`,
        name: 'Stage 4E.4B Test Product',
        slug: `test-4e4b-product-${Date.now()}`,
        category: 'OTHERS',
        type: 'FINISHED_PRODUCT',
        unit: 'Unit',
        status: 'ACTIVE',
      },
    });
    productId = product.id;

    // A dedicated, disposable Customer + Outlet — NOT the shared seeded outlet every
    // other integration file's `findFirst` would also find. A `CUSTOMER_LOCATION` is
    // 1:1 with its outlet (see `inventory-location-ownership-foundation.integration.
    // spec.ts`'s own "duplicate CUSTOMER_LOCATION... rejected" test), and
    // `inventory-transfer.integration.spec.ts` already holds a `CUSTOMER_LOCATION`
    // against the single seeded outlet for its ENTIRE suite lifetime — sharing that
    // outlet guaranteed a collision under real parallel Jest workers, independent of
    // timing. Same "own disposable Customer+Outlet" pattern as
    // `collection-point-fulfillment-concurrency.integration.spec.ts` (Sprint 42).
    const customer = await prisma.customer.create({
      data: {
        organisationId,
        customerCode: `TEST-4E4B-CUST-${Date.now()}`,
        customerType: 'RETAILER',
        customerName: 'Stage 4E.4B Test Customer',
        phoneNumber: `0801${Date.now().toString().slice(-7)}`,
      },
    });
    customerId = customer.id;
    const outlet = await prisma.outlet.create({
      data: {
        organisationId,
        customerId,
        outletCode: `TEST-4E4B-OUT-${Date.now()}`,
        outletType: 'RETAIL_SHOP',
        name: 'Stage 4E.4B Test Outlet',
        status: 'ACTIVE',
      },
    });
    outletId = outlet.id;

    // A genuinely separate tenant, to prove the idempotency key is organisation-scoped
    // — same "this codebase's seed only creates one organisation, so a real cross-tenant
    // proof needs its own disposable second one" reasoning as the transfer integration
    // test.
    const otherOrganisation = await prisma.organisation.create({
      data: {
        name: `TEST-4E4B-OTHER-ORG-${Date.now()}`,
        slug: `test-4e4b-other-org-${Date.now()}`,
        organisationCode: `TST4E4B-${Date.now()}`,
        businessEmail: `test-4e4b-${Date.now()}@example.com`,
        country: 'Nigeria',
      },
    });
    otherOrganisationId = otherOrganisation.id;
    const otherOrganisationLocation = await prisma.inventoryLocation.create({
      data: { organisationId: otherOrganisationId, name: 'Other Org Warehouse' },
    });
    otherOrganisationLocationId = otherOrganisationLocation.id;
    const otherOrganisationProduct = await prisma.product.create({
      data: {
        organisationId: otherOrganisationId,
        code: `TEST-4E4B-OTHER-${Date.now()}`,
        name: 'Stage 4E.4B Other-Org Test Product',
        slug: `test-4e4b-other-org-product-${Date.now()}`,
        category: 'OTHERS',
        type: 'FINISHED_PRODUCT',
        unit: 'Unit',
        status: 'ACTIVE',
      },
    });
    otherOrganisationProductId = otherOrganisationProduct.id;
  });

  afterAll(async () => {
    await prisma.inventoryTransaction.deleteMany({
      where: { productId: { in: [productId, otherOrganisationProductId] } },
    });
    await prisma.inventoryStock.deleteMany({
      where: { productId: { in: [productId, otherOrganisationProductId] } },
    });
    await prisma.product.deleteMany({
      where: { id: { in: [productId, otherOrganisationProductId] } },
    });
    await prisma.inventoryLocation.deleteMany({
      where: { id: warehouseLocationId },
    });
    await prisma.outlet.delete({ where: { id: outletId } });
    await prisma.customer.delete({ where: { id: customerId } });
    // Cascades to otherOrganisationLocation (Organisation -> InventoryLocation is
    // `onDelete: Cascade`).
    await prisma.organisation.delete({ where: { id: otherOrganisationId } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    // Fully disposable fixtures — reset state between tests rather than accumulating
    // it, same convention as `inventory-transfer.integration.spec.ts`.
    await prisma.inventoryTransaction.deleteMany({
      where: { productId: { in: [productId, otherOrganisationProductId] } },
    });
    await prisma.inventoryStock.deleteMany({
      where: { productId: { in: [productId, otherOrganisationProductId] } },
    });
  });

  async function getStock(
    ofProductId: string = productId,
    ofLocationId: string = warehouseLocationId,
    ofOrganisationId: string = organisationId,
  ) {
    return prisma.inventoryStock.findUniqueOrThrow({
      where: {
        organisationId_productId_locationId: {
          organisationId: ofOrganisationId,
          productId: ofProductId,
          locationId: ofLocationId,
        },
      },
    });
  }

  describe('First adjustment and sequential retry', () => {
    it('a first positive adjustment creates stock and an InventoryTransaction, reporting wasCreated: true', async () => {
      const idempotencyKey = nextKey('idem');

      const result = await repository.adjustStock({
        organisationId,
        productId,
        locationId: warehouseLocationId,
        quantity: 25,
        reason: 'PHYSICAL_COUNT',
        createdById: 'test-user',
        idempotencyKey,
      });

      expect(result.wasCreated).toBe(true);
      expect(result.stock.quantityOnHand).toBe(25);

      const stock = await getStock();
      expect(stock.quantityOnHand).toBe(25);

      const transactions = await prisma.inventoryTransaction.findMany({
        where: { organisationId, productId, idempotencyKey },
      });
      expect(transactions).toHaveLength(1);
    });

    it('a sequential retry with the same key and identical payload returns the original result without reapplying the delta', async () => {
      const idempotencyKey = nextKey('idem');

      const first = await repository.adjustStock({
        organisationId,
        productId,
        locationId: warehouseLocationId,
        quantity: 10,
        reason: 'PHYSICAL_COUNT',
        createdById: 'test-user',
        idempotencyKey,
      });
      const retry = await repository.adjustStock({
        organisationId,
        productId,
        locationId: warehouseLocationId,
        quantity: 10,
        reason: 'PHYSICAL_COUNT',
        createdById: 'test-user',
        idempotencyKey,
      });

      expect(first.wasCreated).toBe(true);
      expect(retry.wasCreated).toBe(false);
      expect(retry.transaction.id).toBe(first.transaction.id);

      const stock = await getStock();
      expect(stock.quantityOnHand).toBe(10);

      const transactions = await prisma.inventoryTransaction.findMany({
        where: { organisationId, productId, idempotencyKey },
      });
      expect(transactions).toHaveLength(1);
    });

    it('a negative adjustment retried sequentially also applies exactly once', async () => {
      await repository.adjustStock({
        organisationId,
        productId,
        locationId: warehouseLocationId,
        quantity: 50,
        reason: 'PHYSICAL_COUNT',
        createdById: 'test-user',
      });
      const idempotencyKey = nextKey('idem');

      const first = await repository.adjustStock({
        organisationId,
        productId,
        locationId: warehouseLocationId,
        quantity: -20,
        reason: 'DAMAGE',
        createdById: 'test-user',
        idempotencyKey,
      });
      const retry = await repository.adjustStock({
        organisationId,
        productId,
        locationId: warehouseLocationId,
        quantity: -20,
        reason: 'DAMAGE',
        createdById: 'test-user',
        idempotencyKey,
      });

      expect(first.wasCreated).toBe(true);
      expect(retry.wasCreated).toBe(false);

      const stock = await getStock();
      expect(stock.quantityOnHand).toBe(30);
    });
  });

  describe('Conflicting payload', () => {
    it('reusing the same key with a different quantity is rejected, not silently treated as a retry', async () => {
      const idempotencyKey = nextKey('idem');
      await repository.adjustStock({
        organisationId,
        productId,
        locationId: warehouseLocationId,
        quantity: 10,
        reason: 'PHYSICAL_COUNT',
        createdById: 'test-user',
        idempotencyKey,
      });

      await expect(
        repository.adjustStock({
          organisationId,
          productId,
          locationId: warehouseLocationId,
          quantity: 99,
          reason: 'PHYSICAL_COUNT',
          createdById: 'test-user',
          idempotencyKey,
        }),
      ).rejects.toThrow(AdjustmentIdempotencyKeyConflictError);

      const stock = await getStock();
      expect(stock.quantityOnHand).toBe(10);
      const transactions = await prisma.inventoryTransaction.findMany({
        where: { organisationId, productId, idempotencyKey },
      });
      expect(transactions).toHaveLength(1);
    });

    it('reusing the same key with a different reason is rejected', async () => {
      const idempotencyKey = nextKey('idem');
      await repository.adjustStock({
        organisationId,
        productId,
        locationId: warehouseLocationId,
        quantity: 10,
        reason: 'PHYSICAL_COUNT',
        createdById: 'test-user',
        idempotencyKey,
      });

      await expect(
        repository.adjustStock({
          organisationId,
          productId,
          locationId: warehouseLocationId,
          quantity: 10,
          reason: 'DAMAGE',
          createdById: 'test-user',
          idempotencyKey,
        }),
      ).rejects.toThrow(AdjustmentIdempotencyKeyConflictError);
    });
  });

  describe('Organisation scoping', () => {
    it('the same idempotencyKey is independent across different organisations', async () => {
      const idempotencyKey = nextKey('shared');

      const thisOrgResult = await repository.adjustStock({
        organisationId,
        productId,
        locationId: warehouseLocationId,
        quantity: 10,
        reason: 'PHYSICAL_COUNT',
        createdById: 'test-user',
        idempotencyKey,
      });
      const otherOrgResult = await repository.adjustStock({
        organisationId: otherOrganisationId,
        productId: otherOrganisationProductId,
        locationId: otherOrganisationLocationId,
        quantity: 10,
        reason: 'PHYSICAL_COUNT',
        createdById: 'test-user',
        idempotencyKey,
      });

      expect(thisOrgResult.wasCreated).toBe(true);
      expect(otherOrgResult.wasCreated).toBe(true);
      expect(thisOrgResult.transaction.id).not.toBe(otherOrgResult.transaction.id);

      const otherOrgStock = await getStock(
        otherOrganisationProductId,
        otherOrganisationLocationId,
        otherOrganisationId,
      );
      expect(otherOrgStock.quantityOnHand).toBe(10);

      // Clean up the other organisation's stray row (not covered by the shared
      // `afterEach`, which only resets THIS organisation's product).
      await prisma.inventoryTransaction.deleteMany({
        where: { organisationId: otherOrganisationId, productId: otherOrganisationProductId },
      });
      await prisma.inventoryStock.deleteMany({
        where: { organisationId: otherOrganisationId, productId: otherOrganisationProductId },
      });
    });
  });

  describe('Failed adjustments never consume the key', () => {
    it('an insufficient-stock failure leaves the key free for a later, valid retry', async () => {
      await repository.adjustStock({
        organisationId,
        productId,
        locationId: warehouseLocationId,
        quantity: 5,
        reason: 'PHYSICAL_COUNT',
        createdById: 'test-user',
      });
      const idempotencyKey = nextKey('idem');

      await expect(
        repository.adjustStock({
          organisationId,
          productId,
          locationId: warehouseLocationId,
          quantity: -15,
          reason: 'DAMAGE',
          createdById: 'test-user',
          idempotencyKey,
        }),
      ).rejects.toThrow(NegativeStockError);

      const stockAfterFailure = await getStock();
      expect(stockAfterFailure.quantityOnHand).toBe(5);
      const transactionsAfterFailure = await prisma.inventoryTransaction.findMany({
        where: { organisationId, productId, idempotencyKey },
      });
      expect(transactionsAfterFailure).toHaveLength(0);

      const retry = await repository.adjustStock({
        organisationId,
        productId,
        locationId: warehouseLocationId,
        quantity: -3,
        reason: 'DAMAGE',
        createdById: 'test-user',
        idempotencyKey,
      });
      expect(retry.wasCreated).toBe(true);

      const stockAfterRetry = await getStock();
      expect(stockAfterRetry.quantityOnHand).toBe(2);
    });
  });

  describe('Customer-owned stock', () => {
    // A `CUSTOMER_LOCATION` is 1:1 with its outlet, and this codebase's seed only
    // creates ONE organisation/outlet — this fixture is deliberately created and torn
    // down WITHIN this single test (not in `beforeAll`/`afterAll`) so it is never held
    // long enough to collide with `inventory-transfer.integration.spec.ts`'s own
    // CUSTOMER_LOCATION against the very same outlet when both suites run as separate,
    // parallel Jest workers against the same test database.
    it('an idempotent adjustment against an existing CUSTOMER-owned balance preserves ownership/arrangement and applies exactly once', async () => {
      const outletLocation = await prisma.inventoryLocation.create({
        data: {
          organisationId,
          name: `TEST-4E4B-OUTLET-LOCATION-${Date.now()}`,
          locationType: 'CUSTOMER_LOCATION',
          outletId,
        },
      });
      const outletLocationId = outletLocation.id;

      try {
        await repository.recordOpeningStock({
          organisationId,
          productId,
          locationId: outletLocationId,
          quantity: 40,
          ownership: 'CUSTOMER',
          arrangement: 'WHOLESALE',
          createdById: 'test-user',
        });
        const idempotencyKey = nextKey('idem');

        const first = await repository.adjustStock({
          organisationId,
          productId,
          locationId: outletLocationId,
          quantity: -10,
          reason: 'PHYSICAL_COUNT',
          createdById: 'test-user',
          idempotencyKey,
        });
        const retry = await repository.adjustStock({
          organisationId,
          productId,
          locationId: outletLocationId,
          quantity: -10,
          reason: 'PHYSICAL_COUNT',
          createdById: 'test-user',
          idempotencyKey,
        });

        expect(first.wasCreated).toBe(true);
        expect(retry.wasCreated).toBe(false);
        expect(first.stock.ownership).toBe('CUSTOMER');
        expect(first.stock.arrangement).toBe('WHOLESALE');

        const stock = await getStock(productId, outletLocationId);
        expect(stock.quantityOnHand).toBe(30);
        expect(stock.ownership).toBe('CUSTOMER');
      } finally {
        await prisma.inventoryTransaction.deleteMany({ where: { locationId: outletLocationId } });
        await prisma.inventoryStock.deleteMany({ where: { locationId: outletLocationId } });
        await prisma.inventoryLocation.delete({ where: { id: outletLocationId } });
      }
    });
  });

  describe('Genuine PostgreSQL concurrency', () => {
    it('two truly concurrent requests with the same idempotency key apply the stock change exactly once', async () => {
      await repository.adjustStock({
        organisationId,
        productId,
        locationId: warehouseLocationId,
        quantity: 100,
        reason: 'PHYSICAL_COUNT',
        createdById: 'test-user',
      });
      const idempotencyKey = nextKey('race');

      const attempts = await Promise.allSettled([
        repository.adjustStock({
          organisationId,
          productId,
          locationId: warehouseLocationId,
          quantity: 15,
          reason: 'FOUND_STOCK',
          createdById: 'test-user',
          idempotencyKey,
        }),
        repository.adjustStock({
          organisationId,
          productId,
          locationId: warehouseLocationId,
          quantity: 15,
          reason: 'FOUND_STOCK',
          createdById: 'test-user',
          idempotencyKey,
        }),
      ]);

      // Neither request is allowed to be lost to an unhandled rejection — both must
      // resolve (one as the creator, one as the recovered retry), per the brief's
      // "a retry must return the original adjustment result" requirement even under a
      // genuine race.
      expect(attempts.every((a) => a.status === 'fulfilled')).toBe(true);
      const results = attempts.map((a) => (a as PromiseFulfilledResult<unknown>).value) as Array<{
        wasCreated: boolean;
        transaction: { id: string };
      }>;
      expect(results.filter((r) => r.wasCreated)).toHaveLength(1);
      expect(results.filter((r) => !r.wasCreated)).toHaveLength(1);
      expect(results[0]?.transaction.id).toBe(results[1]?.transaction.id);

      // The +15 delta was applied exactly once (100 + 15 = 115), not twice (130) — a
      // lost-update/double-apply race would show 130 here.
      const stock = await getStock();
      expect(stock.quantityOnHand).toBe(115);

      const transactions = await prisma.inventoryTransaction.findMany({
        where: { organisationId, productId, idempotencyKey },
      });
      expect(transactions).toHaveLength(1);
    });

    it('10 truly concurrent requests with the same idempotency key still apply the stock change exactly once', async () => {
      await repository.adjustStock({
        organisationId,
        productId,
        locationId: warehouseLocationId,
        quantity: 200,
        reason: 'PHYSICAL_COUNT',
        createdById: 'test-user',
      });
      const idempotencyKey = nextKey('race-stress');

      const attempts = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          repository.adjustStock({
            organisationId,
            productId,
            locationId: warehouseLocationId,
            quantity: 7,
            reason: 'FOUND_STOCK',
            createdById: 'test-user',
            idempotencyKey,
          }),
        ),
      );

      expect(attempts.every((a) => a.status === 'fulfilled')).toBe(true);
      const results = attempts.map((a) => (a as PromiseFulfilledResult<unknown>).value) as Array<{
        wasCreated: boolean;
        transaction: { id: string };
      }>;
      expect(results.filter((r) => r.wasCreated)).toHaveLength(1);
      expect(new Set(results.map((r) => r.transaction.id)).size).toBe(1);

      const stock = await getStock();
      expect(stock.quantityOnHand).toBe(207);

      const transactions = await prisma.inventoryTransaction.findMany({
        where: { organisationId, productId, idempotencyKey },
      });
      expect(transactions).toHaveLength(1);
    });

    it('concurrent requests with DIFFERENT idempotency keys for the same intended operation are NOT deduplicated (same conventions as a caller never sending a key)', async () => {
      await repository.adjustStock({
        organisationId,
        productId,
        locationId: warehouseLocationId,
        quantity: 100,
        reason: 'PHYSICAL_COUNT',
        createdById: 'test-user',
      });

      const results = await Promise.all([
        repository.adjustStock({
          organisationId,
          productId,
          locationId: warehouseLocationId,
          quantity: 5,
          reason: 'FOUND_STOCK',
          createdById: 'test-user',
          idempotencyKey: nextKey('distinct-a'),
        }),
        repository.adjustStock({
          organisationId,
          productId,
          locationId: warehouseLocationId,
          quantity: 5,
          reason: 'FOUND_STOCK',
          createdById: 'test-user',
          idempotencyKey: nextKey('distinct-b'),
        }),
      ]);

      expect(results.every((r) => r.wasCreated)).toBe(true);
      expect(results[0]?.transaction.id).not.toBe(results[1]?.transaction.id);

      const stock = await getStock();
      expect(stock.quantityOnHand).toBe(110);
    });
  });

  describe('Valuation is preserved (moving-average cost untouched by adjustments)', () => {
    it('averageUnitCost is unaffected by an idempotent adjustment, including on the deduplicated retry', async () => {
      // Establish a non-zero cost basis the way a real costed movement would (an
      // adjustment never sets cost itself — see `applyStockAdjustmentIfNonNegative`'s
      // own "never touches averageUnitCost" invariant, which this stage's idempotency
      // logic wraps around without altering).
      await prisma.inventoryStock.create({
        data: {
          organisationId,
          productId,
          locationId: warehouseLocationId,
          quantityOnHand: 50,
          averageUnitCost: 12.5,
        },
      });
      const idempotencyKey = nextKey('idem');

      const first = await repository.adjustStock({
        organisationId,
        productId,
        locationId: warehouseLocationId,
        quantity: 10,
        reason: 'PHYSICAL_COUNT',
        createdById: 'test-user',
        idempotencyKey,
      });
      const retry = await repository.adjustStock({
        organisationId,
        productId,
        locationId: warehouseLocationId,
        quantity: 10,
        reason: 'PHYSICAL_COUNT',
        createdById: 'test-user',
        idempotencyKey,
      });

      expect(first.stock.averageUnitCost).toBe(12.5);
      expect(retry.stock.averageUnitCost).toBe(12.5);
      const stock = await getStock();
      expect(stock.quantityOnHand).toBe(60);
      expect(stock.averageUnitCost).toBe(12.5);
    });
  });

  describe('Stage 4E.4D — journal posting (real PostgreSQL)', () => {
    const valuationService = new InventoryValuationService(prismaService);

    let fgAccountId: string;
    let adjustmentAccountId: string;

    let unconfiguredOrgId: string;
    let unconfiguredLocationId: string;
    let unconfiguredProductId: string;

    let isolatedOrgId: string;
    let isolatedLocationId: string;
    let isolatedProductId: string;
    let isolatedInventoryAccountId: string;
    let isolatedAdjustmentAccountId: string;

    beforeAll(async () => {
      const fg = await prisma.chartOfAccount.findFirstOrThrow({
        where: { organisationId, systemKey: 'FINISHED_GOODS_INVENTORY' },
        select: { id: true },
      });
      fgAccountId = fg.id;
      const adj = await prisma.chartOfAccount.findFirstOrThrow({
        where: { organisationId, systemKey: 'INVENTORY_ADJUSTMENT' },
        select: { id: true },
      });
      adjustmentAccountId = adj.id;

      // A genuinely separate tenant with NO Chart of Accounts/Accounting Period at
      // all — real proof that a missing system account rolls back the ENTIRE
      // adjustment (stock + InventoryTransaction), not just the journal half of it.
      const unconfiguredOrg = await prisma.organisation.create({
        data: {
          name: `TEST-4E4D-UNCONFIGURED-${Date.now()}`,
          slug: `test-4e4d-unconfigured-${Date.now()}`,
          organisationCode: `TST4E4DU-${Date.now()}`,
          businessEmail: `test-4e4d-unconfigured-${Date.now()}@example.com`,
          country: 'Nigeria',
        },
      });
      unconfiguredOrgId = unconfiguredOrg.id;
      const unconfiguredLocation = await prisma.inventoryLocation.create({
        data: { organisationId: unconfiguredOrgId, name: 'Unconfigured Org Warehouse' },
      });
      unconfiguredLocationId = unconfiguredLocation.id;
      const unconfiguredProduct = await prisma.product.create({
        data: {
          organisationId: unconfiguredOrgId,
          code: `TEST-4E4D-U-${Date.now()}`,
          name: 'Stage 4E.4D Unconfigured-Org Test Product',
          slug: `test-4e4d-unconfigured-product-${Date.now()}`,
          category: 'OTHERS',
          type: 'RAW_MATERIAL',
          unit: 'Unit',
          status: 'ACTIVE',
        },
      });
      unconfiguredProductId = unconfiguredProduct.id;
      // An OPEN period but deliberately NO Chart of Accounts at all — isolates this
      // test to the missing-*account* failure specifically (an org with neither would
      // hit `NoOpenPeriodError` first, since `postSystemJournalEntry` resolves the
      // period before any account).
      await prisma.accountingPeriod.create({
        data: {
          organisationId: unconfiguredOrgId,
          name: 'Stage 4E.4D Unconfigured Test Period',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
          status: 'OPEN',
        },
      });

      // A second, genuinely separate tenant WITH its own disposable Chart of
      // Accounts/Accounting Period — real proof that one organisation's adjustment
      // journal never touches another organisation's GL (tenant isolation extended
      // to the new accounting path, not just the stock/idempotency path the rest of
      // this file already proves).
      const isolatedOrg = await prisma.organisation.create({
        data: {
          name: `TEST-4E4D-ISOLATED-${Date.now()}`,
          slug: `test-4e4d-isolated-${Date.now()}`,
          organisationCode: `TST4E4DI-${Date.now()}`,
          businessEmail: `test-4e4d-isolated-${Date.now()}@example.com`,
          country: 'Nigeria',
        },
      });
      isolatedOrgId = isolatedOrg.id;
      const isolatedLocation = await prisma.inventoryLocation.create({
        data: { organisationId: isolatedOrgId, name: 'Isolated Org Warehouse' },
      });
      isolatedLocationId = isolatedLocation.id;
      const isolatedProduct = await prisma.product.create({
        data: {
          organisationId: isolatedOrgId,
          code: `TEST-4E4D-I-${Date.now()}`,
          name: 'Stage 4E.4D Isolated-Org Test Product',
          slug: `test-4e4d-isolated-product-${Date.now()}`,
          category: 'OTHERS',
          type: 'RAW_MATERIAL',
          unit: 'Unit',
          status: 'ACTIVE',
        },
      });
      isolatedProductId = isolatedProduct.id;
      const isolatedInventoryAccount = await prisma.chartOfAccount.create({
        data: {
          organisationId: isolatedOrgId,
          code: '1300',
          name: 'Inventory',
          type: 'ASSET',
          isSystemAccount: true,
          systemKey: 'INVENTORY',
        },
      });
      isolatedInventoryAccountId = isolatedInventoryAccount.id;
      const isolatedAdjustmentAccount = await prisma.chartOfAccount.create({
        data: {
          organisationId: isolatedOrgId,
          code: '6900',
          name: 'Inventory Adjustment / Shrinkage',
          type: 'EXPENSE',
          isSystemAccount: true,
          systemKey: 'INVENTORY_ADJUSTMENT',
        },
      });
      isolatedAdjustmentAccountId = isolatedAdjustmentAccount.id;
      await prisma.accountingPeriod.create({
        data: {
          organisationId: isolatedOrgId,
          name: 'Stage 4E.4D Isolated Test Period',
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
          status: 'OPEN',
        },
      });
    });

    afterAll(async () => {
      await prisma.inventoryTransaction.deleteMany({
        where: { productId: { in: [unconfiguredProductId, isolatedProductId] } },
      });
      await prisma.inventoryStock.deleteMany({
        where: { productId: { in: [unconfiguredProductId, isolatedProductId] } },
      });
      // `JournalEntryLine.accountId -> ChartOfAccount.id` is not cascade-on-delete —
      // explicitly clear every journal this block posted for the isolated org BEFORE
      // deleting the organisation, or the org's own `ChartOfAccount` rows disappearing
      // underneath still-referencing `JournalEntryLine` rows violates that FK.
      const isolatedJournalEntries = await prisma.journalEntry.findMany({
        where: { organisationId: isolatedOrgId },
        select: { id: true },
      });
      await prisma.journalEntryLine.deleteMany({
        where: { journalEntryId: { in: isolatedJournalEntries.map((j) => j.id) } },
      });
      await prisma.journalEntry.deleteMany({ where: { organisationId: isolatedOrgId } });
      // Cascades to each org's own location/product/chart-of-account/accounting-period.
      await prisma.organisation.delete({ where: { id: unconfiguredOrgId } });
      await prisma.organisation.delete({ where: { id: isolatedOrgId } });
    });

    afterEach(async () => {
      // Dedicated cleanup — this describe block gives `productId`/`warehouseLocationId`
      // a REAL cost via a direct `inventoryStock.create`, which the outer file's own
      // `afterEach` already clears for `productId`; also clear any journal this block
      // posted against it, scoped by `sourceType` so no other domain's journals are
      // ever touched.
      await prisma.journalEntry.deleteMany({
        where: { organisationId, sourceType: 'INVENTORY_ADJUSTMENT' },
      });
    });

    it('commits the stock mutation, the InventoryTransaction, and the JournalEntry atomically', async () => {
      await prisma.inventoryStock.create({
        data: {
          organisationId,
          productId,
          locationId: warehouseLocationId,
          quantityOnHand: 100,
          averageUnitCost: 40,
        },
      });

      const result = await repository.adjustStock({
        organisationId,
        productId,
        locationId: warehouseLocationId,
        quantity: 10,
        reason: 'FOUND_STOCK',
        createdById: 'test-user',
      });

      expect(result.journalEntryId).not.toBeNull();

      const [stock, transaction, journalEntry] = await Promise.all([
        getStock(),
        prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: result.transaction.id } }),
        prisma.journalEntry.findUniqueOrThrow({
          where: { id: result.journalEntryId! },
          include: { lines: true },
        }),
      ]);
      expect(stock.quantityOnHand).toBe(110);
      expect(transaction.quantity).toBe(10);
      expect(journalEntry.sourceType).toBe('INVENTORY_ADJUSTMENT');
      expect(journalEntry.sourceId).toBe(transaction.id);
      const totalDebit = journalEntry.lines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredit = journalEntry.lines.reduce((sum, l) => sum + l.credit, 0);
      expect(totalDebit).toBe(400); // 10 x 40
      expect(totalCredit).toBe(400);
      expect(journalEntry.lines.map((l) => l.accountId)).toContain(fgAccountId);
      expect(journalEntry.lines.map((l) => l.accountId)).toContain(adjustmentAccountId);
    });

    it('rolls back the stock mutation and the InventoryTransaction when the journal cannot be posted (missing system account)', async () => {
      await prisma.inventoryStock.create({
        data: {
          organisationId: unconfiguredOrgId,
          productId: unconfiguredProductId,
          locationId: unconfiguredLocationId,
          quantityOnHand: 50,
          averageUnitCost: 10,
        },
      });

      await expect(
        repository.adjustStock({
          organisationId: unconfiguredOrgId,
          productId: unconfiguredProductId,
          locationId: unconfiguredLocationId,
          quantity: 5,
          reason: 'FOUND_STOCK',
          createdById: 'test-user',
        }),
      ).rejects.toThrow(MissingSystemAccountError);

      const stock = await prisma.inventoryStock.findUniqueOrThrow({
        where: {
          organisationId_productId_locationId: {
            organisationId: unconfiguredOrgId,
            productId: unconfiguredProductId,
            locationId: unconfiguredLocationId,
          },
        },
      });
      expect(stock.quantityOnHand).toBe(50); // unchanged — the +5 never committed.
      const transactions = await prisma.inventoryTransaction.findMany({
        where: { organisationId: unconfiguredOrgId, productId: unconfiguredProductId },
      });
      expect(transactions).toHaveLength(0); // no orphan ledger row survives the rollback.
      const journalEntries = await prisma.journalEntry.findMany({
        where: { organisationId: unconfiguredOrgId },
      });
      expect(journalEntries).toHaveLength(0);
    });

    it('two genuinely concurrent identical requests produce exactly one InventoryTransaction and exactly one JournalEntry', async () => {
      await prisma.inventoryStock.create({
        data: {
          organisationId,
          productId,
          locationId: warehouseLocationId,
          quantityOnHand: 100,
          averageUnitCost: 40,
        },
      });
      const idempotencyKey = nextKey('journal-race');

      const attempts = await Promise.allSettled([
        repository.adjustStock({
          organisationId,
          productId,
          locationId: warehouseLocationId,
          quantity: 15,
          reason: 'FOUND_STOCK',
          createdById: 'test-user',
          idempotencyKey,
        }),
        repository.adjustStock({
          organisationId,
          productId,
          locationId: warehouseLocationId,
          quantity: 15,
          reason: 'FOUND_STOCK',
          createdById: 'test-user',
          idempotencyKey,
        }),
      ]);

      expect(attempts.every((a) => a.status === 'fulfilled')).toBe(true);
      const results = attempts.map(
        (a) => (a as PromiseFulfilledResult<{ journalEntryId: string | null }>).value,
      );
      const distinctJournalIds = new Set(results.map((r) => r.journalEntryId));
      expect(distinctJournalIds.size).toBe(1);
      expect(results[0]?.journalEntryId).not.toBeNull();

      const transactions = await prisma.inventoryTransaction.findMany({
        where: { organisationId, productId, idempotencyKey },
      });
      expect(transactions).toHaveLength(1);
      const journalEntries = await prisma.journalEntry.findMany({
        where: {
          organisationId,
          sourceType: 'INVENTORY_ADJUSTMENT',
          sourceId: transactions[0]!.id,
        },
      });
      expect(journalEntries).toHaveLength(1);
    });

    it('the GL (Finished Goods Inventory) and the inventory valuation move by the same amount for organisation-owned stock', async () => {
      await prisma.inventoryStock.create({
        data: {
          organisationId,
          productId,
          locationId: warehouseLocationId,
          quantityOnHand: 100,
          averageUnitCost: 40,
        },
      });

      const before = await valuationService.getValuation(organisationId, {
        locationId: warehouseLocationId,
      });
      const glBefore = await prisma.journalEntryLine.aggregate({
        where: { accountId: fgAccountId, journalEntry: { organisationId } },
        _sum: { debit: true, credit: true },
      });

      await repository.adjustStock({
        organisationId,
        productId,
        locationId: warehouseLocationId,
        quantity: 10,
        reason: 'FOUND_STOCK',
        createdById: 'test-user',
      });

      const after = await valuationService.getValuation(organisationId, {
        locationId: warehouseLocationId,
      });
      const glAfter = await prisma.journalEntryLine.aggregate({
        where: { accountId: fgAccountId, journalEntry: { organisationId } },
        _sum: { debit: true, credit: true },
      });

      const valuationDelta = after.totals.grandTotal - before.totals.grandTotal;
      const glDelta =
        (glAfter._sum.debit ?? 0) -
        (glAfter._sum.credit ?? 0) -
        ((glBefore._sum.debit ?? 0) - (glBefore._sum.credit ?? 0));
      expect(valuationDelta).toBeCloseTo(400, 5); // 10 x 40
      expect(glDelta).toBeCloseTo(valuationDelta, 5);
    });

    it('customer-owned stock stays visible operationally but is excluded from the company-owned valuation', async () => {
      const outletLocation = await prisma.inventoryLocation.create({
        data: {
          organisationId,
          name: `TEST-4E4D-OUTLET-LOCATION-${Date.now()}`,
          locationType: 'CUSTOMER_LOCATION',
          outletId,
        },
      });
      const outletLocationId = outletLocation.id;

      try {
        await prisma.inventoryStock.create({
          data: {
            organisationId,
            productId,
            locationId: outletLocationId,
            quantityOnHand: 30,
            averageUnitCost: 40,
            ownership: 'CUSTOMER',
            arrangement: 'WHOLESALE',
          },
        });

        // Still operationally visible — the raw, unfiltered repository read every
        // outlet/distribution view actually uses.
        const operationalStock = await repository.findByProductAndLocation(
          organisationId,
          productId,
          outletLocationId,
        );
        expect(operationalStock?.quantityOnHand).toBe(30);

        // Excluded from the company-owned valuation total.
        const valuation = await valuationService.getValuation(organisationId, {
          locationId: outletLocationId,
        });
        expect(valuation.lines).toHaveLength(0);
        expect(valuation.totals.grandTotal).toBe(0);
      } finally {
        await prisma.inventoryTransaction.deleteMany({ where: { locationId: outletLocationId } });
        await prisma.inventoryStock.deleteMany({ where: { locationId: outletLocationId } });
        await prisma.inventoryLocation.delete({ where: { id: outletLocationId } });
      }
    });

    it('a customer-owned adjustment moves stock but never changes the organisation inventory GL', async () => {
      const outletLocation = await prisma.inventoryLocation.create({
        data: {
          organisationId,
          name: `TEST-4E4D-OUTLET-GL-${Date.now()}`,
          locationType: 'CUSTOMER_LOCATION',
          outletId,
        },
      });
      const outletLocationId = outletLocation.id;

      try {
        await prisma.inventoryStock.create({
          data: {
            organisationId,
            productId,
            locationId: outletLocationId,
            quantityOnHand: 30,
            averageUnitCost: 40,
            ownership: 'CUSTOMER',
            arrangement: 'WHOLESALE',
          },
        });

        const glBefore = await prisma.journalEntryLine.aggregate({
          where: {
            journalEntry: { organisationId },
            accountId: { in: [fgAccountId, adjustmentAccountId] },
          },
          _sum: { debit: true, credit: true },
        });

        const result = await repository.adjustStock({
          organisationId,
          productId,
          locationId: outletLocationId,
          quantity: -10,
          reason: 'PHYSICAL_COUNT',
          createdById: 'test-user',
        });

        const glAfter = await prisma.journalEntryLine.aggregate({
          where: {
            journalEntry: { organisationId },
            accountId: { in: [fgAccountId, adjustmentAccountId] },
          },
          _sum: { debit: true, credit: true },
        });

        expect(result.journalEntryId).toBeNull();
        const stock = await repository.findByProductAndLocation(
          organisationId,
          productId,
          outletLocationId,
        );
        expect(stock?.quantityOnHand).toBe(20);
        expect(glAfter._sum.debit ?? 0).toBe(glBefore._sum.debit ?? 0);
        expect(glAfter._sum.credit ?? 0).toBe(glBefore._sum.credit ?? 0);
      } finally {
        await prisma.inventoryTransaction.deleteMany({ where: { locationId: outletLocationId } });
        await prisma.inventoryStock.deleteMany({ where: { locationId: outletLocationId } });
        await prisma.inventoryLocation.delete({ where: { id: outletLocationId } });
      }
    });

    it("tenant isolation: a value-bearing adjustment posts only to its own organisation's GL, never another tenant's", async () => {
      await prisma.inventoryStock.create({
        data: {
          organisationId,
          productId,
          locationId: warehouseLocationId,
          quantityOnHand: 100,
          averageUnitCost: 40,
        },
      });
      await prisma.inventoryStock.create({
        data: {
          organisationId: isolatedOrgId,
          productId: isolatedProductId,
          locationId: isolatedLocationId,
          quantityOnHand: 100,
          averageUnitCost: 15,
        },
      });

      const [bobyBitesResult, isolatedResult] = await Promise.all([
        repository.adjustStock({
          organisationId,
          productId,
          locationId: warehouseLocationId,
          quantity: 10,
          reason: 'FOUND_STOCK',
          createdById: 'test-user',
        }),
        repository.adjustStock({
          organisationId: isolatedOrgId,
          productId: isolatedProductId,
          locationId: isolatedLocationId,
          quantity: 10,
          reason: 'FOUND_STOCK',
          createdById: 'test-user',
        }),
      ]);

      const bobyBitesJournal = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: bobyBitesResult.journalEntryId! },
        include: { lines: true },
      });
      const isolatedJournal = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: isolatedResult.journalEntryId! },
        include: { lines: true },
      });

      expect(bobyBitesJournal.organisationId).toBe(organisationId);
      expect(isolatedJournal.organisationId).toBe(isolatedOrgId);
      expect(bobyBitesJournal.lines.map((l) => l.accountId)).not.toContain(
        isolatedInventoryAccountId,
      );
      expect(bobyBitesJournal.lines.map((l) => l.accountId)).not.toContain(
        isolatedAdjustmentAccountId,
      );
      expect(isolatedJournal.lines.map((l) => l.accountId)).not.toContain(fgAccountId);
      expect(isolatedJournal.lines.map((l) => l.accountId)).not.toContain(adjustmentAccountId);

      await prisma.inventoryTransaction.deleteMany({
        where: { organisationId: isolatedOrgId, productId: isolatedProductId },
      });
      await prisma.inventoryStock.deleteMany({
        where: { organisationId: isolatedOrgId, productId: isolatedProductId },
      });
    });
  });
});
