import { PrismaClient } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { InventoryLocationRepository } from './inventory-location.repository';
import {
  InventoryStockRepository,
  OpeningStockAlreadyRecordedError,
} from './inventory-stock.repository';
import {
  InsufficientStockError,
  InventoryTransferRepository,
  OwnershipMismatchError,
  TransferNotReversibleError,
} from './inventory-transfer.repository';

/**
 * Phase 2B — Customer Outlet Stock Tracking & Transfers
 * (docs/customer-location-inventory-architecture-audit.md §11, docs/sprint-customer-
 * location-inventory-phase-2b-completion-report.md). Against REAL PostgreSQL. Same
 * "dedicated, disposable fixtures created in `beforeAll`, destroyed in `afterAll`,
 * never real seeded data" convention as `inventory-stock-concurrency.integration.spec.ts`
 * (Sprint 37.1) — this file creates its OWN products, warehouse-type source locations,
 * and a disposable `CUSTOMER_LOCATION` against a real seeded outlet, so none of its
 * stock manipulation (including deliberately setting low/zero balances to provoke
 * failure paths) can ever corrupt real dev/demo data or race against another
 * live-verification session using the same database.
 *
 * Deliberately NOT part of the default `pnpm test` run — run via
 * `pnpm run test:integration`.
 */
describe('Phase 2B — Inventory Transfer & Opening Stock (real PostgreSQL)', () => {
  const prisma = new PrismaClient();
  const prismaService = prisma as unknown as PrismaService;
  const stockRepository = new InventoryStockRepository(prismaService);
  const transferRepository = new InventoryTransferRepository(prismaService);
  const locationRepository = new InventoryLocationRepository(prismaService);

  let organisationId: string;
  let warehouseLocationId: string;
  let secondWarehouseLocationId: string;
  let productAId: string;
  let productBId: string;
  let outletId: string;
  let outletLocationId: string;

  let otherOrganisationId: string;
  let otherOrganisationLocationId: string;

  let seq = 1;
  function nextRef(prefix: string): string {
    seq += 1;
    return `${prefix}-${Date.now()}-${seq}`;
  }

  beforeAll(async () => {
    const organisation = await prisma.organisation.findFirstOrThrow({
      where: { name: 'Boby Bites' },
      select: { id: true },
    });
    organisationId = organisation.id;

    const [warehouse, secondWarehouse] = await Promise.all([
      prisma.inventoryLocation.create({
        data: { organisationId, name: `TEST-PHASE-2B-WAREHOUSE-${Date.now()}` },
      }),
      prisma.inventoryLocation.create({
        data: { organisationId, name: `TEST-PHASE-2B-WAREHOUSE-2-${Date.now()}` },
      }),
    ]);
    warehouseLocationId = warehouse.id;
    secondWarehouseLocationId = secondWarehouse.id;

    const [productA, productB] = await Promise.all([
      prisma.product.create({
        data: {
          organisationId,
          code: `TEST-P2B-A-${Date.now()}`,
          name: 'Phase 2B Test Product A',
          slug: `test-p2b-a-${Date.now()}`,
          category: 'OTHERS',
          type: 'FINISHED_PRODUCT',
          unit: 'Unit',
          status: 'ACTIVE',
        },
      }),
      prisma.product.create({
        data: {
          organisationId,
          code: `TEST-P2B-B-${Date.now()}`,
          name: 'Phase 2B Test Product B',
          slug: `test-p2b-b-${Date.now()}`,
          category: 'OTHERS',
          type: 'FINISHED_PRODUCT',
          unit: 'Unit',
          status: 'ACTIVE',
        },
      }),
    ]);
    productAId = productA.id;
    productBId = productB.id;

    const outlet = await prisma.outlet.findFirst({
      where: { organisationId },
      select: { id: true },
    });
    if (!outlet) {
      throw new Error('This test requires at least one seeded outlet.');
    }
    outletId = outlet.id;

    const outletLocation = await prisma.inventoryLocation.create({
      data: {
        organisationId,
        name: `TEST-PHASE-2B-OUTLET-LOCATION-${Date.now()}`,
        locationType: 'CUSTOMER_LOCATION',
        outletId,
      },
    });
    outletLocationId = outletLocation.id;

    // A genuinely separate tenant — this codebase's seed only creates one organisation
    // ("Boby Bites"), so a real cross-tenant proof needs its own disposable second one
    // rather than skipping the assertion.
    const otherOrganisation = await prisma.organisation.create({
      data: {
        name: `TEST-PHASE-2B-OTHER-ORG-${Date.now()}`,
        slug: `test-phase-2b-other-org-${Date.now()}`,
        organisationCode: `TST-${Date.now()}`,
        businessEmail: `test-phase-2b-${Date.now()}@example.com`,
        country: 'Nigeria',
      },
    });
    otherOrganisationId = otherOrganisation.id;
    const otherOrganisationLocation = await prisma.inventoryLocation.create({
      data: { organisationId: otherOrganisationId, name: 'Other Org Warehouse' },
    });
    otherOrganisationLocationId = otherOrganisationLocation.id;
  });

  afterAll(async () => {
    const locationIds = [warehouseLocationId, secondWarehouseLocationId, outletLocationId];
    await prisma.inventoryTransaction.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.inventoryTransfer.deleteMany({
      where: {
        OR: [
          { sourceLocationId: { in: locationIds } },
          { destinationLocationId: { in: locationIds } },
        ],
      },
    });
    await prisma.inventoryStock.deleteMany({
      where: { productId: { in: [productAId, productBId] } },
    });
    await prisma.inventoryLocation.deleteMany({ where: { id: { in: locationIds } } });
    await prisma.product.deleteMany({ where: { id: { in: [productAId, productBId] } } });
    // Cascades to otherOrganisationLocation (Organisation -> InventoryLocation is
    // `onDelete: Cascade`).
    await prisma.organisation.delete({ where: { id: otherOrganisationId } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    // Fully disposable fixtures — reset every test's state between tests rather than
    // accumulating it, including re-seeding the two source warehouses back to a known
    // balance for product A.
    const allLocationIds = [warehouseLocationId, secondWarehouseLocationId, outletLocationId];
    await prisma.inventoryTransaction.deleteMany({ where: { locationId: { in: allLocationIds } } });
    await prisma.inventoryTransfer.deleteMany({
      where: {
        OR: [
          { sourceLocationId: { in: allLocationIds } },
          { destinationLocationId: { in: allLocationIds } },
        ],
      },
    });
    await prisma.inventoryStock.deleteMany({
      where: { productId: { in: [productAId, productBId] } },
    });
  });

  async function seedWarehouseStock(locationId: string, productId: string, quantity: number) {
    await stockRepository.recordOpeningStock({
      organisationId,
      productId,
      locationId,
      quantity,
      ownership: 'ORGANISATION',
      arrangement: 'WHOLESALE',
      createdById: 'test-user',
    });
  }

  describe('Opening stock', () => {
    it('records a fresh opening balance with ownership/arrangement', async () => {
      const result = await stockRepository.recordOpeningStock({
        organisationId,
        productId: productAId,
        locationId: outletLocationId,
        quantity: 42,
        ownership: 'CUSTOMER',
        arrangement: 'WHOLESALE',
        createdById: 'test-user',
        notes: 'Physical count at outlet',
      });
      expect(result.stock.quantityOnHand).toBe(42);
      expect(result.stock.ownership).toBe('CUSTOMER');
      expect(result.stock.averageUnitCost).toBe(0);
      expect(result.transaction.referenceType).toBe('OpeningStock');
    });

    it('rejects a second opening-balance attempt for the same (location, product) rather than merging', async () => {
      await stockRepository.recordOpeningStock({
        organisationId,
        productId: productAId,
        locationId: outletLocationId,
        quantity: 10,
        ownership: 'CUSTOMER',
        arrangement: 'WHOLESALE',
        createdById: 'test-user',
      });

      await expect(
        stockRepository.recordOpeningStock({
          organisationId,
          productId: productAId,
          locationId: outletLocationId,
          quantity: 999,
          ownership: 'ORGANISATION',
          arrangement: 'CONSIGNMENT',
          createdById: 'test-user',
        }),
      ).rejects.toThrow(OpeningStockAlreadyRecordedError);

      const stock = await prisma.inventoryStock.findUnique({
        where: {
          organisationId_productId_locationId: {
            organisationId,
            productId: productAId,
            locationId: outletLocationId,
          },
        },
      });
      expect(stock?.quantityOnHand).toBe(10);
      expect(stock?.ownership).toBe('CUSTOMER');
    });

    it('a confirmed opening balance of ZERO is distinct from no balance at all', async () => {
      const result = await stockRepository.recordOpeningStock({
        organisationId,
        productId: productAId,
        locationId: outletLocationId,
        quantity: 0,
        ownership: 'CUSTOMER',
        arrangement: 'WHOLESALE',
        createdById: 'test-user',
      });
      expect(result.stock.quantityOnHand).toBe(0);
      const stock = await prisma.inventoryStock.findUnique({
        where: {
          organisationId_productId_locationId: {
            organisationId,
            productId: productAId,
            locationId: outletLocationId,
          },
        },
      });
      expect(stock).not.toBeNull();
    });

    it('concurrent opening-stock submissions for the same location/product: exactly one succeeds, no double count', async () => {
      const attempts = await Promise.allSettled([
        stockRepository.recordOpeningStock({
          organisationId,
          productId: productAId,
          locationId: outletLocationId,
          quantity: 50,
          ownership: 'CUSTOMER',
          arrangement: 'WHOLESALE',
          createdById: 'test-user',
        }),
        stockRepository.recordOpeningStock({
          organisationId,
          productId: productAId,
          locationId: outletLocationId,
          quantity: 75,
          ownership: 'CUSTOMER',
          arrangement: 'WHOLESALE',
          createdById: 'test-user',
        }),
      ]);
      const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
      const rejected = attempts.filter((a) => a.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const stock = await prisma.inventoryStock.findUnique({
        where: {
          organisationId_productId_locationId: {
            organisationId,
            productId: productAId,
            locationId: outletLocationId,
          },
        },
      });
      expect([50, 75]).toContain(stock?.quantityOnHand);
    });
  });

  describe('Transfers', () => {
    it('moves stock between two valid same-organisation locations, decrementing source and incrementing destination', async () => {
      await seedWarehouseStock(warehouseLocationId, productAId, 100);

      const { transfer, wasCreated } = await transferRepository.create({
        organisationId,
        transferNumber: nextRef('TRF-TEST'),
        productId: productAId,
        sourceLocationId: warehouseLocationId,
        destinationLocationId: outletLocationId,
        quantity: 20,
        createdById: 'test-user',
      });
      expect(wasCreated).toBe(true);
      expect(transfer.ownership).toBe('ORGANISATION');
      expect(transfer.arrangement).toBe('WHOLESALE');

      const source = await prisma.inventoryStock.findUniqueOrThrow({
        where: {
          organisationId_productId_locationId: {
            organisationId,
            productId: productAId,
            locationId: warehouseLocationId,
          },
        },
      });
      expect(source.quantityOnHand).toBe(80);

      const destination = await prisma.inventoryStock.findUniqueOrThrow({
        where: {
          organisationId_productId_locationId: {
            organisationId,
            productId: productAId,
            locationId: outletLocationId,
          },
        },
      });
      expect(destination.quantityOnHand).toBe(20);
      expect(destination.averageUnitCost).toBe(0);
      expect(destination.ownership).toBe('ORGANISATION');

      const transactions = await prisma.inventoryTransaction.findMany({
        where: { referenceType: { in: ['TransferOut', 'TransferIn'] }, referenceId: transfer.id },
      });
      expect(transactions).toHaveLength(2);
      expect(transactions.every((t) => t.quantity === 20)).toBe(true);
    });

    it('retrying the same idempotencyKey does not duplicate the movement', async () => {
      await seedWarehouseStock(warehouseLocationId, productAId, 100);
      const idempotencyKey = nextRef('idem');

      const first = await transferRepository.create({
        organisationId,
        transferNumber: nextRef('TRF-TEST'),
        productId: productAId,
        sourceLocationId: warehouseLocationId,
        destinationLocationId: outletLocationId,
        quantity: 15,
        idempotencyKey,
        createdById: 'test-user',
      });
      const second = await transferRepository.create({
        organisationId,
        transferNumber: nextRef('TRF-TEST'),
        productId: productAId,
        sourceLocationId: warehouseLocationId,
        destinationLocationId: outletLocationId,
        quantity: 15,
        idempotencyKey,
        createdById: 'test-user',
      });
      expect(first.wasCreated).toBe(true);
      expect(second.wasCreated).toBe(false);
      expect(second.transfer.id).toBe(first.transfer.id);

      const destination = await prisma.inventoryStock.findUniqueOrThrow({
        where: {
          organisationId_productId_locationId: {
            organisationId,
            productId: productAId,
            locationId: outletLocationId,
          },
        },
      });
      expect(destination.quantityOnHand).toBe(15);

      const transferCount = await prisma.inventoryTransfer.count({
        where: { idempotencyKey, organisationId },
      });
      expect(transferCount).toBe(1);
    });

    it('a transfer exceeding available source stock fails and leaves both balances untouched (no partial movement)', async () => {
      await seedWarehouseStock(warehouseLocationId, productAId, 10);

      await expect(
        transferRepository.create({
          organisationId,
          transferNumber: nextRef('TRF-TEST'),
          productId: productAId,
          sourceLocationId: warehouseLocationId,
          destinationLocationId: outletLocationId,
          quantity: 11,
          createdById: 'test-user',
        }),
      ).rejects.toThrow(InsufficientStockError);

      const source = await prisma.inventoryStock.findUniqueOrThrow({
        where: {
          organisationId_productId_locationId: {
            organisationId,
            productId: productAId,
            locationId: warehouseLocationId,
          },
        },
      });
      expect(source.quantityOnHand).toBe(10);

      const destination = await prisma.inventoryStock.findUnique({
        where: {
          organisationId_productId_locationId: {
            organisationId,
            productId: productAId,
            locationId: outletLocationId,
          },
        },
      });
      expect(destination).toBeNull();
    });

    it("a cross-tenant destination succeeds at the repository layer but never touches the other organisation's stock — proving the SERVICE layer location lookup, not the repository, is the real tenant-isolation boundary", async () => {
      await seedWarehouseStock(warehouseLocationId, productAId, 50);

      const { transfer } = await transferRepository.create({
        organisationId,
        transferNumber: nextRef('TRF-TEST'),
        productId: productAId,
        sourceLocationId: warehouseLocationId,
        // A real location id, but belonging to a DIFFERENT organisation.
        destinationLocationId: otherOrganisationLocationId,
        quantity: 5,
        createdById: 'test-user',
      });
      expect(transfer).toBeDefined();

      const otherOrgStock = await prisma.inventoryStock.findMany({
        where: { organisationId: otherOrganisationId, locationId: otherOrganisationLocationId },
      });
      expect(otherOrgStock).toHaveLength(0);
      const thisOrgStockAtForeignLocation = await prisma.inventoryStock.findFirst({
        where: { organisationId, locationId: otherOrganisationLocationId },
      });
      expect(thisOrgStockAtForeignLocation).not.toBeNull();
      expect(thisOrgStockAtForeignLocation?.quantityOnHand).toBe(5);

      // Clean up this test's own stray cross-location row.
      await prisma.inventoryTransaction.deleteMany({
        where: { organisationId, locationId: otherOrganisationLocationId },
      });
      await prisma.inventoryTransfer.deleteMany({
        where: { organisationId, destinationLocationId: otherOrganisationLocationId },
      });
      await prisma.inventoryStock.deleteMany({
        where: { organisationId, locationId: otherOrganisationLocationId },
      });
    });

    it('rejects a transfer into a destination already holding this product under a different ownership/arrangement, and rolls back the source decrement', async () => {
      await seedWarehouseStock(warehouseLocationId, productBId, 50);
      await stockRepository.recordOpeningStock({
        organisationId,
        productId: productBId,
        locationId: outletLocationId,
        quantity: 5,
        ownership: 'CUSTOMER',
        arrangement: 'WHOLESALE',
        createdById: 'test-user',
      });

      await expect(
        transferRepository.create({
          organisationId,
          transferNumber: nextRef('TRF-TEST'),
          productId: productBId,
          sourceLocationId: warehouseLocationId,
          destinationLocationId: outletLocationId,
          quantity: 1,
          createdById: 'test-user',
        }),
      ).rejects.toThrow(OwnershipMismatchError);

      const source = await prisma.inventoryStock.findUniqueOrThrow({
        where: {
          organisationId_productId_locationId: {
            organisationId,
            productId: productBId,
            locationId: warehouseLocationId,
          },
        },
      });
      expect(source.quantityOnHand).toBe(50);

      const destination = await prisma.inventoryStock.findUniqueOrThrow({
        where: {
          organisationId_productId_locationId: {
            organisationId,
            productId: productBId,
            locationId: outletLocationId,
          },
        },
      });
      expect(destination.quantityOnHand).toBe(5);
      expect(destination.ownership).toBe('CUSTOMER');
    });

    it('concurrent transfers competing for the same limited source stock: the database never oversells', async () => {
      await seedWarehouseStock(warehouseLocationId, productAId, 30);

      const attempts = await Promise.allSettled([
        transferRepository.create({
          organisationId,
          transferNumber: nextRef('TRF-TEST'),
          productId: productAId,
          sourceLocationId: warehouseLocationId,
          destinationLocationId: outletLocationId,
          quantity: 20,
          createdById: 'test-user',
        }),
        transferRepository.create({
          organisationId,
          transferNumber: nextRef('TRF-TEST'),
          productId: productAId,
          sourceLocationId: warehouseLocationId,
          destinationLocationId: outletLocationId,
          quantity: 20,
          createdById: 'test-user',
        }),
      ]);
      const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);

      const source = await prisma.inventoryStock.findUniqueOrThrow({
        where: {
          organisationId_productId_locationId: {
            organisationId,
            productId: productAId,
            locationId: warehouseLocationId,
          },
        },
      });
      expect(source.quantityOnHand).toBe(10);
      expect(source.quantityOnHand).toBeGreaterThanOrEqual(0);
    });

    it('concurrent transfers into the SAME destination from independent sources: no lost update on the destination increment', async () => {
      await Promise.all([
        seedWarehouseStock(warehouseLocationId, productAId, 100),
        seedWarehouseStock(secondWarehouseLocationId, productAId, 100),
      ]);

      const results = await Promise.all([
        transferRepository.create({
          organisationId,
          transferNumber: nextRef('TRF-TEST'),
          productId: productAId,
          sourceLocationId: warehouseLocationId,
          destinationLocationId: outletLocationId,
          quantity: 10,
          createdById: 'test-user',
        }),
        transferRepository.create({
          organisationId,
          transferNumber: nextRef('TRF-TEST'),
          productId: productAId,
          sourceLocationId: secondWarehouseLocationId,
          destinationLocationId: outletLocationId,
          quantity: 10,
          createdById: 'test-user',
        }),
      ]);
      expect(results.every((r) => r.wasCreated)).toBe(true);

      const destination = await prisma.inventoryStock.findUniqueOrThrow({
        where: {
          organisationId_productId_locationId: {
            organisationId,
            productId: productAId,
            locationId: outletLocationId,
          },
        },
      });
      // Both increments of 10 must be reflected — a lost update would leave this at
      // 10, not 20.
      expect(destination.quantityOnHand).toBe(20);
    });
  });

  describe('Reversal', () => {
    async function createTestTransfer(quantity: number) {
      await seedWarehouseStock(warehouseLocationId, productAId, quantity);
      return transferRepository.create({
        organisationId,
        transferNumber: nextRef('TRF-TEST'),
        productId: productAId,
        sourceLocationId: warehouseLocationId,
        destinationLocationId: outletLocationId,
        quantity,
        createdById: 'test-user',
      });
    }

    it('reverses a COMPLETED transfer: restores source, drains destination, marks the original REVERSED', async () => {
      const { transfer } = await createTestTransfer(12);

      const { transfer: reversal } = await transferRepository.reverse(
        organisationId,
        transfer.id,
        nextRef('TRF-REV'),
        'test reversal',
        'test-user',
      );
      expect(reversal.reversalOfTransferId).toBe(transfer.id);
      expect(reversal.sourceLocationId).toBe(outletLocationId);
      expect(reversal.destinationLocationId).toBe(warehouseLocationId);

      const original = await prisma.inventoryTransfer.findUniqueOrThrow({
        where: { id: transfer.id },
      });
      expect(original.status).toBe('REVERSED');

      const sourceAfter = await prisma.inventoryStock.findUniqueOrThrow({
        where: {
          organisationId_productId_locationId: {
            organisationId,
            productId: productAId,
            locationId: warehouseLocationId,
          },
        },
      });
      expect(sourceAfter.quantityOnHand).toBe(12);

      const destinationAfter = await prisma.inventoryStock.findUniqueOrThrow({
        where: {
          organisationId_productId_locationId: {
            organisationId,
            productId: productAId,
            locationId: outletLocationId,
          },
        },
      });
      expect(destinationAfter.quantityOnHand).toBe(0);
    });

    it('rejects a second reversal attempt (sequential)', async () => {
      const { transfer } = await createTestTransfer(8);
      await transferRepository.reverse(
        organisationId,
        transfer.id,
        nextRef('TRF-REV'),
        undefined,
        'test-user',
      );

      await expect(
        transferRepository.reverse(
          organisationId,
          transfer.id,
          nextRef('TRF-REV'),
          undefined,
          'test-user',
        ),
      ).rejects.toThrow(TransferNotReversibleError);
    });

    it('concurrent duplicate reversal attempts: exactly one succeeds', async () => {
      const { transfer } = await createTestTransfer(6);

      const attempts = await Promise.allSettled([
        transferRepository.reverse(
          organisationId,
          transfer.id,
          nextRef('TRF-REV'),
          undefined,
          'test-user',
        ),
        transferRepository.reverse(
          organisationId,
          transfer.id,
          nextRef('TRF-REV'),
          undefined,
          'test-user',
        ),
      ]);
      const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);

      const original = await prisma.inventoryTransfer.findUniqueOrThrow({
        where: { id: transfer.id },
      });
      expect(original.status).toBe('REVERSED');
    });

    it('a reversal attempt that would oversell the destination (some stock already moved on) fails cleanly, leaving the original COMPLETED', async () => {
      const { transfer } = await createTestTransfer(7);
      // Simulate "some of it already moved on" — drain the destination below the
      // original transfer quantity before attempting to reverse.
      await prisma.inventoryStock.update({
        where: {
          organisationId_productId_locationId: {
            organisationId,
            productId: productAId,
            locationId: outletLocationId,
          },
        },
        data: { quantityOnHand: 2 },
      });

      await expect(
        transferRepository.reverse(
          organisationId,
          transfer.id,
          nextRef('TRF-REV'),
          undefined,
          'test-user',
        ),
      ).rejects.toThrow(InsufficientStockError);

      const original = await prisma.inventoryTransfer.findUniqueOrThrow({
        where: { id: transfer.id },
      });
      // The conditional `status` claim and the stock check both live inside the SAME
      // database transaction — when the stock check fails, the whole transaction
      // (including the `status` flip) rolls back together, so re-reading confirms the
      // original is still COMPLETED, never stuck in an inconsistent half-reversed
      // state.
      expect(original.status).toBe('COMPLETED');
    });
  });

  describe('Regression: existing warehouse/B2B operations are unaffected', () => {
    it('the seeded Collection Point outlets still share the same Main Warehouse location', async () => {
      const outlets = await prisma.outlet.findMany({
        where: { organisationId, inventoryLocationId: { not: null } },
        select: { inventoryLocationId: true },
      });
      const distinctLocations = new Set(outlets.map((o) => o.inventoryLocationId));
      expect(distinctLocations.size).toBe(1);
    });

    it('creating a duplicate CUSTOMER_LOCATION for the same outlet is rejected at the database level', async () => {
      await expect(
        prisma.inventoryLocation.create({
          data: {
            organisationId,
            name: `TEST-DUPLICATE-OUTLET-LOCATION-${Date.now()}`,
            locationType: 'CUSTOMER_LOCATION',
            outletId,
          },
        }),
      ).rejects.toThrow();
    });

    it('InventoryValuationService-style aggregation (quantityOnHand * averageUnitCost) still computes structurally across every location, including the new CUSTOMER_LOCATION', async () => {
      await seedWarehouseStock(warehouseLocationId, productAId, 10);
      const stock = await prisma.inventoryStock.findMany({
        where: { organisationId },
        select: { quantityOnHand: true, averageUnitCost: true },
      });
      const total = stock.reduce((sum, row) => sum + row.quantityOnHand * row.averageUnitCost, 0);
      expect(Number.isFinite(total)).toBe(true);
      expect(total).toBeGreaterThanOrEqual(0);
    });

    it('customer-owned opening stock always carries zero averageUnitCost — excluded from company valuation by construction', async () => {
      const result = await stockRepository.recordOpeningStock({
        organisationId,
        productId: productAId,
        locationId: outletLocationId,
        quantity: 100,
        ownership: 'CUSTOMER',
        arrangement: 'WHOLESALE',
        createdById: 'test-user',
      });
      expect(result.stock.averageUnitCost).toBe(0);
      expect(result.stock.quantityOnHand * result.stock.averageUnitCost).toBe(0);
    });
  });

  describe('Location repository: outlet-location lookup (used for duplicate prevention)', () => {
    it('findByOutletId finds the disposable location for this outlet', async () => {
      const found = await locationRepository.findByOutletId(organisationId, outletId);
      expect(found?.id).toBe(outletLocationId);
    });

    it('findByOutletId returns null for an outlet with no dedicated location', async () => {
      const otherOutlet = await prisma.outlet.findFirst({
        where: { organisationId, id: { not: outletId } },
        select: { id: true },
      });
      if (!otherOutlet) {
        return;
      }
      const found = await locationRepository.findByOutletId(organisationId, otherOutlet.id);
      expect(found).toBeNull();
    });
  });
});
