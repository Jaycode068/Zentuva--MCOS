import { PrismaClient } from '@prisma/client';

import { CustomerRepository } from '../../retail/customer/customer.repository';
import { OutletRepository } from '../../retail/outlet/outlet.repository';
import { ProductRepository } from '../../catalogue/product/product.repository';
import { SalesOrderRepository } from '../../sales/sales-order.repository';
import { SalesOrderService } from '../../sales/sales-order.service';

/**
 * Sprint 41 — WhatsApp D2C Ordering & Commerce Conversation (brief §21 "Idempotency
 * and Concurrency... critical"). A genuine PostgreSQL concurrency test for
 * `SalesOrderService.createForConsumer` — the exact atomic primitive
 * `D2COrderingService.confirmOrder` (and therefore the WhatsApp ordering conversation,
 * via `ConversationService.handleAwaitingConfirm`) relies on, unchanged by this sprint.
 * Mirrors `inventory-stock-concurrency.integration.spec.ts` (Sprint 37.1) and
 * `promotions-concurrency.integration.spec.ts` (Sprint 40)'s own "connect to the SAME
 * database, fire real concurrent `Promise.all` requests" technique — a mocked
 * repository runs to completion in one synchronous tick and can never prove or disprove
 * a genuine lost-update/duplicate-order race.
 *
 * Deliberately NOT part of the default `pnpm test` run (see `jest.integration.config.js`)
 * — run explicitly with `pnpm run test:integration`.
 */
describe('D2C Order Confirmation Concurrency (real PostgreSQL, genuine concurrent transactions)', () => {
  const prisma = new PrismaClient();
  const salesOrderRepository = new SalesOrderRepository(prisma as never);
  const customerRepository = new CustomerRepository(prisma as never);
  const outletRepository = new OutletRepository(prisma as never);
  const productRepository = new ProductRepository(prisma as never);
  const salesOrderService = new SalesOrderService(
    salesOrderRepository,
    customerRepository,
    outletRepository,
    productRepository,
  );

  let organisationId: string;
  const consumerIds: string[] = [];
  const productIds: string[] = [];
  const salesOrderIds: string[] = [];

  beforeAll(async () => {
    const organisation = await prisma.organisation.findFirstOrThrow({ select: { id: true } });
    organisationId = organisation.id;
  });

  afterAll(async () => {
    await prisma.salesOrderItem.deleteMany({ where: { salesOrderId: { in: salesOrderIds } } });
    await prisma.salesOrder.deleteMany({ where: { id: { in: salesOrderIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    await prisma.consumer.deleteMany({ where: { id: { in: consumerIds } } });
    await prisma.$disconnect();
  });

  function suffix(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function makeConsumer(): Promise<string> {
    const s = suffix();
    const consumer = await prisma.consumer.create({
      data: {
        organisationId,
        consumerCode: `CONC41-${s}`,
        fullName: 'Sprint 41 Concurrency Test Consumer',
        phoneNumber: `0800${s.slice(-7)}`,
        normalizedPhone: `+234800${s.slice(-7)}`,
      },
    });
    consumerIds.push(consumer.id);
    return consumer.id;
  }

  /** The minimum D2C-orderable product fixture — `ACTIVE`, `FINISHED_PRODUCT`, a real
   *  `sellingPrice` — see `D2COrderingService.isOrderable`. */
  async function makeOrderableProduct(): Promise<string> {
    const s = suffix();
    const product = await prisma.product.create({
      data: {
        organisationId,
        code: `PRD41-${s}`,
        name: 'Sprint 41 Concurrency Test Snack',
        slug: `sprint-41-concurrency-test-snack-${s}`,
        category: 'SNACKS',
        type: 'FINISHED_PRODUCT',
        unit: 'Pack',
        status: 'ACTIVE',
        sellingPrice: 500,
      },
    });
    productIds.push(product.id);
    return product.id;
  }

  it('5 genuinely concurrent confirmOrder calls with the SAME idempotencyKey create exactly ONE SalesOrder', async () => {
    const consumerId = await makeConsumer();
    const productId = await makeOrderableProduct();
    const idempotencyKey = `whatsapp-confirm-${suffix()}`;

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        salesOrderService.createForConsumer(organisationId, {
          consumerId,
          items: [{ productId, quantity: 2 }],
          orderDate: new Date(),
          idempotencyKey,
        }),
      ),
    );
    results.forEach((r) => salesOrderIds.push(r.order.id));

    // Exactly one distinct order id across all 5 concurrent "Confirm Order" attempts —
    // the same multi-turn WhatsApp scenario as a consumer tapping "Confirm" repeatedly,
    // or Meta redelivering the inbound "Confirm" message concurrently with a slow first
    // response (brief §21 "Repeated confirmation" / "Concurrent order confirmation").
    const distinctOrderIds = new Set(results.map((r) => r.order.id));
    expect(distinctOrderIds.size).toBe(1);

    // Exactly ONE of the 5 calls actually created the row; the other 4 observed the
    // P2002 race and recovered by re-fetching the winner (never throwing, never
    // creating a second row).
    expect(results.filter((r) => r.wasCreated)).toHaveLength(1);

    const persisted = await prisma.salesOrder.findMany({
      where: { organisationId, idempotencyKey },
    });
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.total).toBe(1000); // 500 * 2, never doubled/quintupled.

    const items = await prisma.salesOrderItem.findMany({
      where: { salesOrderId: persisted[0]!.id },
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toBe(2);
  });

  it('a DIFFERENT idempotencyKey for the same consumer/cart creates a genuinely separate order — the guarantee is per-checkout, never per-consumer', async () => {
    const consumerId = await makeConsumer();
    const productId = await makeOrderableProduct();

    const first = await salesOrderService.createForConsumer(organisationId, {
      consumerId,
      items: [{ productId, quantity: 1 }],
      orderDate: new Date(),
      idempotencyKey: `whatsapp-confirm-${suffix()}`,
    });
    const second = await salesOrderService.createForConsumer(organisationId, {
      consumerId,
      items: [{ productId, quantity: 1 }],
      orderDate: new Date(),
      idempotencyKey: `whatsapp-confirm-${suffix()}`,
    });
    salesOrderIds.push(first.order.id, second.order.id);

    expect(first.order.id).not.toBe(second.order.id);
    expect(first.wasCreated).toBe(true);
    expect(second.wasCreated).toBe(true);
  });
});
