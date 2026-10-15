import { PrismaClient } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { InventoryStockRepository } from '../inventory/inventory-stock.repository';
import { verifyConnectedToTestDatabase } from '../testing/test-db-guard';
import {
  OutletOwnershipTransitionError,
  SalesFulfilmentRepository,
} from './sales-fulfilment.repository';

/**
 * Phase 2C — Customer Outlet Inventory Integration (docs/customer-location-inventory-
 * architecture-audit.md, docs/sprint-customer-location-inventory-phase-2c-completion-
 * report.md §3). Against REAL PostgreSQL. Same "fully disposable fixtures, real
 * seeded reference data reused only where it's never mutated" convention Phase 2B's
 * own integration tests established — a real seeded Outlet/Customer/accounting period
 * are reused (read-only); everything this file WRITES (product, locations, sales
 * order, fulfilments, the outlet's dedicated location) is created and destroyed here.
 *
 * Deliberately NOT part of the default `pnpm test` run — run via
 * `pnpm run test:integration`.
 */
describe('Phase 2C — B2B fulfilment to outlet stock (real PostgreSQL)', () => {
  const prisma = new PrismaClient();
  const prismaService = prisma as unknown as PrismaService;
  const fulfilmentRepository = new SalesFulfilmentRepository(prismaService);
  const stockRepository = new InventoryStockRepository(prismaService);

  let organisationId: string;
  let warehouseLocationId: string;
  let outletLocationId: string;
  let outletId: string;
  let customerId: string;
  let productId: string;
  let seq = 0;

  function nextCode(prefix: string): string {
    seq += 1;
    return `${prefix}-${Date.now()}-${seq}`;
  }

  async function createOrder(quantity: number) {
    const order = await prisma.salesOrder.create({
      data: {
        organisationId,
        orderCode: nextCode('SO-TEST'),
        customerId,
        outletId,
        source: 'B2B',
        status: 'CONFIRMED',
        orderDate: new Date(),
        subtotal: quantity * 100,
        total: quantity * 100,
        items: {
          create: [{ productId, quantity, unitPrice: 100, lineTotal: quantity * 100 }],
        },
      },
      include: { items: true },
    });
    return { order, item: order.items[0]! };
  }

  beforeAll(async () => {
    const organisation = await prisma.organisation.findFirstOrThrow({
      where: { name: 'Boby Bites' },
    });
    organisationId = organisation.id;

    const outlet = await prisma.outlet.findFirstOrThrow({
      where: { organisationId },
      select: { id: true, customerId: true },
    });
    outletId = outlet.id;
    customerId = outlet.customerId;

    const warehouse = await prisma.inventoryLocation.create({
      data: { organisationId, name: `TEST-P2C-WAREHOUSE-${Date.now()}` },
    });
    warehouseLocationId = warehouse.id;

    const outletLocation = await prisma.inventoryLocation.create({
      data: {
        organisationId,
        name: `TEST-P2C-OUTLET-LOC-${Date.now()}`,
        locationType: 'CUSTOMER_LOCATION',
        outletId,
      },
    });
    outletLocationId = outletLocation.id;

    const product = await prisma.product.create({
      data: {
        organisationId,
        code: `TEST-P2C-${Date.now()}`,
        name: 'Phase 2C Test Product',
        slug: `test-p2c-${Date.now()}`,
        category: 'OTHERS',
        type: 'FINISHED_PRODUCT',
        unit: 'Unit',
        status: 'ACTIVE',
      },
    });
    productId = product.id;
  });

  // CAUTION — found the hard way during this phase's own development: a journal-entry
  // cleanup query scoped only by `sourceType: 'SALES_FULFILMENT'` (without ALSO
  // restricting `sourceId` to this test's own disposable fulfilment ids) deleted every
  // REAL, pre-existing Sales Fulfilment journal entry for the organisation — 18 of them,
  // since they share the same `sourceType`. They were reconstructed afterward (same
  // amounts/dates/references, replayed through the real `postSystemJournalEntry`). The
  // Phase 2C Financial Integrity Review (docs/sprint-phase-2c-financial-integrity-review.md)
  // found this recovery independently verified for only 3 of the 18 entries and explicitly
  // did NOT certify it as byte-identical — do not restate that claim here.
  // `cleanupTestData` below always resolves the EXACT disposable fulfilment ids first and
  // scopes every deletion to them specifically — never a bare `sourceType` filter — so
  // this specific query pattern cannot recur. As a second, independent layer, this
  // function also refuses to run at all unless `verifyConnectedToTestDatabase` confirms
  // the connection is the isolated, unprivileged test database (see
  // docs/sprint-test-database-isolation-completion-report.md) — it throws before any
  // `deleteMany` below if that cannot be established, even if this file is ever invoked
  // outside its normal jest.integration.config.js bootstrap.
  async function cleanupTestData() {
    await verifyConnectedToTestDatabase(prisma);
    const locationIds = [warehouseLocationId, outletLocationId];
    const testFulfilments = await prisma.salesFulfilment.findMany({
      where: { organisationId, locationId: { in: locationIds } },
      select: { id: true },
    });
    const testFulfilmentIds = testFulfilments.map((f) => f.id);

    await prisma.salesFulfilmentItem.deleteMany({
      where: { salesFulfilmentId: { in: testFulfilmentIds } },
    });
    await prisma.journalEntryLine.deleteMany({
      where: {
        journalEntry: {
          organisationId,
          sourceType: 'SALES_FULFILMENT',
          sourceId: { in: testFulfilmentIds },
        },
      },
    });
    await prisma.journalEntry.deleteMany({
      where: {
        organisationId,
        sourceType: 'SALES_FULFILMENT',
        sourceId: { in: testFulfilmentIds },
      },
    });
    await prisma.salesFulfilment.deleteMany({ where: { id: { in: testFulfilmentIds } } });
    await prisma.salesOrderItem.deleteMany({ where: { productId } });
    await prisma.salesOrder.deleteMany({
      where: { organisationId, items: { some: { productId } } },
    });
    await prisma.inventoryTransaction.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.inventoryStock.deleteMany({ where: { productId } });
  }

  afterAll(async () => {
    await cleanupTestData();
    await prisma.inventoryLocation.deleteMany({
      where: { id: { in: [warehouseLocationId, outletLocationId] } },
    });
    await prisma.product.delete({ where: { id: productId } });
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  async function seedWarehouseStock(quantity: number, cost: number) {
    await stockRepository.recordOpeningStock({
      organisationId,
      productId,
      locationId: warehouseLocationId,
      quantity,
      ownership: 'ORGANISATION',
      arrangement: 'WHOLESALE',
      createdById: 'test-user',
    });
    await prisma.inventoryStock.update({
      where: {
        organisationId_productId_locationId: {
          organisationId,
          productId,
          locationId: warehouseLocationId,
        },
      },
      data: { averageUnitCost: cost },
    });
  }

  it('fulfils a B2B order: decrements the warehouse once, posts COGS once, and recognises the SAME quantity as CUSTOMER-owned stock at the outlet — no value created or destroyed', async () => {
    await seedWarehouseStock(50, 30);
    const { order, item } = await createOrder(20);

    const journalCountBefore = await prisma.journalEntry.count({ where: { organisationId } });

    const result = await fulfilmentRepository.create({
      organisationId,
      salesOrderId: order.id,
      salesOrderNumber: order.orderCode,
      locationId: warehouseLocationId,
      destinationLocationId: outletLocationId,
      fulfilmentDate: new Date(),
      fulfilledById: 'test-user',
      items: [{ salesOrderItemId: item.id, productId, quantity: 20 }],
    });

    expect(result.wasCreated).toBe(true);
    expect(result.journalEntry).not.toBeNull();
    expect(result.journalEntry!.totalAmount).toBe(600); // 20 * 30

    const warehouseStock = await prisma.inventoryStock.findUniqueOrThrow({
      where: {
        organisationId_productId_locationId: {
          organisationId,
          productId,
          locationId: warehouseLocationId,
        },
      },
    });
    expect(warehouseStock.quantityOnHand).toBe(30); // 50 - 20

    const outletStock = await prisma.inventoryStock.findUniqueOrThrow({
      where: {
        organisationId_productId_locationId: {
          organisationId,
          productId,
          locationId: outletLocationId,
        },
      },
    });
    expect(outletStock.quantityOnHand).toBe(20);
    expect(outletStock.ownership).toBe('CUSTOMER');
    expect(outletStock.arrangement).toBe('WHOLESALE');
    expect(outletStock.averageUnitCost).toBe(30); // carried from the warehouse's cost

    // Value conservation: nothing created or destroyed — the organisation's own
    // valuation (warehouse, ORGANISATION-owned) correctly DROPS by exactly the
    // transferred value, while the outlet's CUSTOMER-owned position (excluded from
    // company valuation) absorbs it.
    expect(warehouseStock.quantityOnHand * warehouseStock.averageUnitCost).toBe(900); // 30*30
    expect(outletStock.quantityOnHand * outletStock.averageUnitCost).toBe(600); // 20*30 — but CUSTOMER-owned, excluded from company valuation by the reporting layer's own definition

    // Exactly one DELIVERY ledger row, sharing the fulfilment's own id with the ISSUE row.
    const transactions = await prisma.inventoryTransaction.findMany({
      where: { referenceType: 'SalesFulfilment', referenceId: result.fulfilment.id },
    });
    expect(transactions).toHaveLength(2);
    expect(transactions.map((t) => t.transactionType).sort()).toEqual(['DELIVERY', 'ISSUE']);

    // Exactly one JournalEntry — no duplicate COGS from the outlet-stock recognition.
    const journalCountAfter = await prisma.journalEntry.count({ where: { organisationId } });
    expect(journalCountAfter).toBe(journalCountBefore + 1);
  });

  it('retrying with the same idempotencyKey does not duplicate the warehouse decrement, outlet delivery, or COGS posting', async () => {
    await seedWarehouseStock(50, 30);
    const { order, item } = await createOrder(10);
    const idempotencyKey = nextCode('idem');

    const first = await fulfilmentRepository.create({
      organisationId,
      salesOrderId: order.id,
      salesOrderNumber: order.orderCode,
      locationId: warehouseLocationId,
      destinationLocationId: outletLocationId,
      fulfilmentDate: new Date(),
      fulfilledById: 'test-user',
      idempotencyKey,
      items: [{ salesOrderItemId: item.id, productId, quantity: 10 }],
    });
    const second = await fulfilmentRepository.create({
      organisationId,
      salesOrderId: order.id,
      salesOrderNumber: order.orderCode,
      locationId: warehouseLocationId,
      destinationLocationId: outletLocationId,
      fulfilmentDate: new Date(),
      fulfilledById: 'test-user',
      idempotencyKey,
      items: [{ salesOrderItemId: item.id, productId, quantity: 10 }],
    });

    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(false);
    expect(second.fulfilment.id).toBe(first.fulfilment.id);

    const outletStock = await prisma.inventoryStock.findUniqueOrThrow({
      where: {
        organisationId_productId_locationId: {
          organisationId,
          productId,
          locationId: outletLocationId,
        },
      },
    });
    expect(outletStock.quantityOnHand).toBe(10);
  });

  it('a fulfilment with NO reliable destination (no outletId) behaves exactly as pre-Phase-2C: no outlet stock, no DELIVERY row', async () => {
    await seedWarehouseStock(50, 30);
    const order = await prisma.salesOrder.create({
      data: {
        organisationId,
        orderCode: nextCode('SO-TEST'),
        customerId,
        outletId: null,
        source: 'B2B',
        status: 'CONFIRMED',
        orderDate: new Date(),
        subtotal: 1000,
        total: 1000,
        items: { create: [{ productId, quantity: 10, unitPrice: 100, lineTotal: 1000 }] },
      },
      include: { items: true },
    });

    const result = await fulfilmentRepository.create({
      organisationId,
      salesOrderId: order.id,
      salesOrderNumber: order.orderCode,
      locationId: warehouseLocationId,
      destinationLocationId: undefined,
      fulfilmentDate: new Date(),
      fulfilledById: 'test-user',
      items: [{ salesOrderItemId: order.items[0]!.id, productId, quantity: 10 }],
    });

    expect(result.fulfilment.destinationLocation).toBeNull();
    const outletStock = await prisma.inventoryStock.findUnique({
      where: {
        organisationId_productId_locationId: {
          organisationId,
          productId,
          locationId: outletLocationId,
        },
      },
    });
    expect(outletStock).toBeNull();
    const deliveryRows = await prisma.inventoryTransaction.findMany({
      where: {
        referenceType: 'SalesFulfilment',
        referenceId: result.fulfilment.id,
        transactionType: 'DELIVERY',
      },
    });
    expect(deliveryRows).toHaveLength(0);
  });

  it('rejects (and rolls back the warehouse decrement + COGS) when the outlet already holds this product under a different ownership/arrangement', async () => {
    await seedWarehouseStock(50, 30);
    // Pre-existing CONSIGNMENT-arranged stock at the outlet, under ORGANISATION
    // ownership — incompatible with the CUSTOMER/WHOLESALE this fulfilment would try
    // to write.
    await stockRepository.recordOpeningStock({
      organisationId,
      productId,
      locationId: outletLocationId,
      quantity: 5,
      ownership: 'ORGANISATION',
      arrangement: 'CONSIGNMENT',
      createdById: 'test-user',
    });
    const { order, item } = await createOrder(10);
    const journalCountBefore = await prisma.journalEntry.count({ where: { organisationId } });

    await expect(
      fulfilmentRepository.create({
        organisationId,
        salesOrderId: order.id,
        salesOrderNumber: order.orderCode,
        locationId: warehouseLocationId,
        destinationLocationId: outletLocationId,
        fulfilmentDate: new Date(),
        fulfilledById: 'test-user',
        items: [{ salesOrderItemId: item.id, productId, quantity: 10 }],
      }),
    ).rejects.toThrow(OutletOwnershipTransitionError);

    const warehouseStock = await prisma.inventoryStock.findUniqueOrThrow({
      where: {
        organisationId_productId_locationId: {
          organisationId,
          productId,
          locationId: warehouseLocationId,
        },
      },
    });
    expect(warehouseStock.quantityOnHand).toBe(50); // untouched — rolled back

    const journalCountAfter = await prisma.journalEntry.count({ where: { organisationId } });
    expect(journalCountAfter).toBe(journalCountBefore); // no COGS posted either
  });

  it('concurrent fulfilment attempts against the same limited warehouse stock: the database never oversells, and the outlet never receives more than what actually left the warehouse', async () => {
    await seedWarehouseStock(15, 30);
    const orderA = await createOrder(10);
    const orderB = await createOrder(10);

    const attempts = await Promise.allSettled([
      fulfilmentRepository.create({
        organisationId,
        salesOrderId: orderA.order.id,
        salesOrderNumber: orderA.order.orderCode,
        locationId: warehouseLocationId,
        destinationLocationId: outletLocationId,
        fulfilmentDate: new Date(),
        fulfilledById: 'test-user',
        items: [{ salesOrderItemId: orderA.item.id, productId, quantity: 10 }],
      }),
      fulfilmentRepository.create({
        organisationId,
        salesOrderId: orderB.order.id,
        salesOrderNumber: orderB.order.orderCode,
        locationId: warehouseLocationId,
        destinationLocationId: outletLocationId,
        fulfilmentDate: new Date(),
        fulfilledById: 'test-user',
        items: [{ salesOrderItemId: orderB.item.id, productId, quantity: 10 }],
      }),
    ]);
    const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    const warehouseStock = await prisma.inventoryStock.findUniqueOrThrow({
      where: {
        organisationId_productId_locationId: {
          organisationId,
          productId,
          locationId: warehouseLocationId,
        },
      },
    });
    expect(warehouseStock.quantityOnHand).toBe(5); // 15 - 10, never negative

    const outletStock = await prisma.inventoryStock.findUniqueOrThrow({
      where: {
        organisationId_productId_locationId: {
          organisationId,
          productId,
          locationId: outletLocationId,
        },
      },
    });
    expect(outletStock.quantityOnHand).toBe(10); // exactly what actually left the warehouse
  });
});
