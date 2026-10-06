import { PrismaClient } from '@prisma/client';

import { LoyaltyLedgerRepository } from './loyalty/loyalty-ledger.repository';
import { RewardGrantRepository } from './reward/reward-grant.repository';

/**
 * Sprint 40 — Configurable Promotions, Loyalty, Rewards & Consumer Incentives
 * (docs/domains/d2c.md "Idempotency and Duplicate Reward Prevention" / "Concurrency
 * Requirements"). Genuine PostgreSQL concurrency tests for `RewardGrantRepository
 * .createWithEarn` and `LoyaltyLedgerRepository.applyAdjustment` — the exact
 * `inventory-stock-concurrency.integration.spec.ts` precedent (Sprint 37.1) applied to
 * this sprint's own atomic primitives. A mocked repository runs to completion in one
 * synchronous tick with nothing else able to interleave, so it can never prove or
 * disprove a genuine lost-update/duplicate-grant race; this file connects to the SAME
 * database `apps/api/.env` already points the running application at and fires real
 * concurrent `Promise.all` requests against real Postgres rows and real transactions.
 *
 * Deliberately NOT part of the default `pnpm test` run (see `jest.integration.config.js`)
 * — run explicitly with `pnpm run test:integration`. Uses dedicated, disposable
 * `Consumer`/`Promotion`/`SalesOrder` fixtures created in `beforeAll`/each test and
 * destroyed in `afterAll`, never real seeded data.
 */
describe('Promotions & Loyalty Concurrency (real PostgreSQL, genuine concurrent transactions)', () => {
  const prisma = new PrismaClient();
  const rewardGrantRepository = new RewardGrantRepository(prisma as never);
  const loyaltyLedgerRepository = new LoyaltyLedgerRepository(prisma as never);

  let organisationId: string;
  const consumerIds: string[] = [];
  const promotionIds: string[] = [];
  const salesOrderIds: string[] = [];

  beforeAll(async () => {
    const organisation = await prisma.organisation.findFirstOrThrow({ select: { id: true } });
    organisationId = organisation.id;
  });

  afterAll(async () => {
    await prisma.loyaltyLedgerEntry.deleteMany({ where: { consumerId: { in: consumerIds } } });
    await prisma.loyaltyAccount.deleteMany({ where: { consumerId: { in: consumerIds } } });
    await prisma.consumerRewardGrant.deleteMany({ where: { consumerId: { in: consumerIds } } });
    await prisma.salesOrder.deleteMany({ where: { id: { in: salesOrderIds } } });
    await prisma.promotionBenefit.deleteMany({ where: { promotionId: { in: promotionIds } } });
    await prisma.promotionCondition.deleteMany({ where: { promotionId: { in: promotionIds } } });
    await prisma.promotion.deleteMany({ where: { id: { in: promotionIds } } });
    await prisma.consumer.deleteMany({ where: { id: { in: consumerIds } } });
    await prisma.$disconnect();
  });

  async function makeConsumer(): Promise<string> {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const consumer = await prisma.consumer.create({
      data: {
        organisationId,
        consumerCode: `CONC-${suffix}`,
        fullName: 'Sprint 40 Concurrency Test Consumer',
        phoneNumber: `0800${suffix.slice(-7)}`,
        normalizedPhone: `+234800${suffix.slice(-7)}`,
      },
    });
    consumerIds.push(consumer.id);
    return consumer.id;
  }

  /** An ACTIVE `BONUS_POINTS` promotion — the minimum fixture `createWithEarn` needs.
   *  Created directly via Prisma (bypassing `PromotionService`) matching the inventory
   *  integration test's own "disposable fixture, not real business-service creation"
   *  convention. */
  async function makeActivePromotion(pointsValue: number): Promise<string> {
    const promotion = await prisma.promotion.create({
      data: {
        organisationId,
        name: `Sprint 40 Concurrency Test Promotion ${Date.now()}`,
        status: 'ACTIVE',
        startsAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        endsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        activatedAt: new Date(),
        conditions: { create: [{ organisationId, type: 'FIRST_QUALIFYING_ORDER' }] },
        benefits: { create: [{ organisationId, type: 'BONUS_POINTS', pointsValue }] },
      },
    });
    promotionIds.push(promotion.id);
    return promotion.id;
  }

  async function makeQualifyingOrder(consumerId: string): Promise<string> {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const order = await prisma.salesOrder.create({
      data: {
        organisationId,
        orderCode: `SO-CONC-${suffix}`,
        consumerId,
        source: 'D2C',
        status: 'CONFIRMED',
        orderDate: new Date(),
        subtotal: 6000,
        total: 6000,
      },
    });
    salesOrderIds.push(order.id);
    return order.id;
  }

  function grantData(
    consumerId: string,
    promotionId: string,
    salesOrderId: string,
    pointsValue: number,
  ) {
    return {
      organisationId,
      consumerId,
      promotionId,
      qualifyingSalesOrderId: salesOrderId,
      promotionNameSnapshot: 'Sprint 40 Concurrency Test Promotion',
      benefitTypeSnapshot: 'BONUS_POINTS' as const,
      pointsAwardedSnapshot: pointsValue,
      freeProductIdSnapshot: null,
      freeProductQuantitySnapshot: null,
      conditionsSnapshot: [{ type: 'FIRST_QUALIFYING_ORDER' }],
    };
  }

  // docs/domains/d2c.md "Concurrency Requirements" — First-order reward race.
  it('First-order reward race: two concurrent qualifying events for the SAME consumer+promotion produce exactly one grant and exactly one points award', async () => {
    const consumerId = await makeConsumer();
    const promotionId = await makeActivePromotion(200);
    const [orderA, orderB] = await Promise.all([
      makeQualifyingOrder(consumerId),
      makeQualifyingOrder(consumerId),
    ]);

    const results = await Promise.all([
      rewardGrantRepository.createWithEarn(grantData(consumerId, promotionId, orderA, 200)),
      rewardGrantRepository.createWithEarn(grantData(consumerId, promotionId, orderB, 200)),
    ]);

    const createdCount = results.filter((r) => r.wasCreated).length;
    expect(createdCount).toBe(1);
    // Both calls resolve to the SAME grant row, whichever won the race.
    expect(results[0].grant.id).toBe(results[1].grant.id);

    const grantRows = await prisma.consumerRewardGrant.findMany({
      where: { organisationId, promotionId, consumerId },
    });
    expect(grantRows).toHaveLength(1);

    const ledgerRows = await prisma.loyaltyLedgerEntry.findMany({
      where: { organisationId, consumerId, type: 'EARN' },
    });
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]?.amount).toBe(200);

    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { consumerId } });
    expect(account.balance).toBe(200); // never 400 — no duplicate points.
  });

  // docs/domains/d2c.md "Reward Limits" — the SAME mechanism as the race above, proven
  // under higher contention to make the "once per consumer per promotion" limit itself
  // the explicit assertion, not just idempotency.
  it('Promotion grant limit race: five concurrent qualifying attempts for the same consumer+promotion never exceed the once-per-consumer limit', async () => {
    const consumerId = await makeConsumer();
    const promotionId = await makeActivePromotion(150);
    const orders = await Promise.all(
      Array.from({ length: 5 }, () => makeQualifyingOrder(consumerId)),
    );

    const results = await Promise.all(
      orders.map((orderId) =>
        rewardGrantRepository.createWithEarn(grantData(consumerId, promotionId, orderId, 150)),
      ),
    );

    const createdCount = results.filter((r) => r.wasCreated).length;
    expect(createdCount).toBe(1);

    const grantRows = await prisma.consumerRewardGrant.findMany({
      where: { organisationId, promotionId, consumerId },
    });
    expect(grantRows).toHaveLength(1);

    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { consumerId } });
    expect(account.balance).toBe(150); // 1 x 150, never 5 x 150 = 750.
  });

  // docs/domains/d2c.md "Concurrency Requirements" — Redemption/adjustment race. Positive
  // direction: concurrent credits must all apply and sum correctly (no lost update).
  it('Adjustment race (credits): five concurrent +50 adjustments against a fresh account all apply — final balance is 250', async () => {
    const consumerId = await makeConsumer();

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        loyaltyLedgerRepository.applyAdjustment({
          organisationId,
          consumerId,
          amount: 50,
          reason: `Concurrency test credit ${i}`,
          actorUserId: 'test-admin',
        }),
      ),
    );

    expect(results.every((r) => r !== null)).toBe(true);
    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { consumerId } });
    expect(account.balance).toBe(250);

    const ledgerRows = await prisma.loyaltyLedgerEntry.findMany({
      where: { organisationId, consumerId, type: 'ADJUSTMENT' },
    });
    expect(ledgerRows).toHaveLength(5);
  });

  // Negative direction: concurrent debits against a LIMITED balance must never take the
  // balance negative — only as many succeed as the balance actually allows, exactly the
  // `applyStockAdjustmentIfNonNegative` guarantee (Sprint 37.1) applied here to points.
  it('Adjustment race (debits): five concurrent -30 adjustments against a balance of 100 never go negative', async () => {
    const consumerId = await makeConsumer();
    // Seed a starting balance via one EARN-shaped credit (a real adjustment).
    await loyaltyLedgerRepository.applyAdjustment({
      organisationId,
      consumerId,
      amount: 100,
      reason: 'Seed balance for debit race test',
      actorUserId: 'test-admin',
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        loyaltyLedgerRepository.applyAdjustment({
          organisationId,
          consumerId,
          amount: -30,
          reason: `Concurrency test debit ${i}`,
          actorUserId: 'test-admin',
        }),
      ),
    );

    const succeededCount = results.filter((r) => r !== null).length;
    // floor(100 / 30) = 3 whole debits fit; the remaining 2 must be rejected.
    expect(succeededCount).toBe(3);

    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { consumerId } });
    expect(account.balance).toBe(10);
    expect(account.balance).toBeGreaterThanOrEqual(0);
    // The core invariant: initial = remaining + successfully debited.
    expect(100).toBe(account.balance + succeededCount * 30);
  });

  it('a debit against a non-existent loyalty account is rejected cleanly, never creating a negative-balance account', async () => {
    const consumerId = await makeConsumer();

    const result = await loyaltyLedgerRepository.applyAdjustment({
      organisationId,
      consumerId,
      amount: -50,
      reason: 'Should fail — no account exists yet',
      actorUserId: 'test-admin',
    });

    expect(result).toBeNull();
    const account = await prisma.loyaltyAccount.findUnique({ where: { consumerId } });
    expect(account).toBeNull();
  });
});
