import { AuditService } from '../../identity/audit/audit.service';
import { ConsumerService } from '../../d2c/consumer/consumer.service';
import { SalesOrderService } from '../../sales/sales-order.service';
import { PromotionRepository, PromotionWithRelations } from '../promotion/promotion.repository';
import { PromotionEvaluationService } from './promotion-evaluation.service';
import { RewardGrantRepository } from './reward-grant.repository';

/**
 * Sprint 40 — Configurable Promotions, Loyalty, Rewards & Consumer Incentives
 * (docs/domains/d2c.md). Covers the brief's own "First-Order Tests" (§32) directly
 * against the real condition-evaluation logic — every repository/service this file
 * composes is mocked, the business rules under test are this service's own real code.
 */
describe('PromotionEvaluationService', () => {
  const orgId = 'org-1';
  const consumerId = 'consumer-1';
  const salesOrderId = 'so-1';

  const consumer = { id: consumerId, territoryId: 'territory-1' };
  const d2cOrder = {
    id: salesOrderId,
    source: 'D2C',
    status: 'CONFIRMED',
    total: 6000,
    consumerId,
    items: [{ productId: 'product-1', quantity: 4 }],
  };

  function makePromotion(overrides: Partial<PromotionWithRelations> = {}): PromotionWithRelations {
    return {
      id: 'promo-1',
      organisationId: orgId,
      name: 'First Order October',
      description: null,
      status: 'ACTIVE',
      startsAt: new Date('2026-10-01'),
      endsAt: new Date('2026-10-31'),
      activatedAt: new Date('2026-10-01'),
      createdById: null,
      updatedById: null,
      createdAt: new Date('2026-10-01'),
      updatedAt: new Date('2026-10-01'),
      conditions: [
        {
          id: 'cond-1',
          type: 'FIRST_QUALIFYING_ORDER',
          minOrderValue: null,
          productId: null,
          minQuantity: null,
          territoryId: null,
        },
        {
          id: 'cond-2',
          type: 'MINIMUM_ORDER_VALUE',
          minOrderValue: 5000,
          productId: null,
          minQuantity: null,
          territoryId: null,
        },
      ],
      benefits: [
        {
          id: 'ben-1',
          type: 'BONUS_POINTS',
          pointsValue: 200,
          freeProductId: null,
          freeProductQuantity: null,
        },
      ],
      ...overrides,
    } as PromotionWithRelations;
  }

  function makeService() {
    const promotionRepository = {
      findManyActiveEffective: jest.fn(),
    } as unknown as jest.Mocked<PromotionRepository>;
    const rewardGrantRepository = {
      createWithEarn: jest.fn(),
    } as unknown as jest.Mocked<RewardGrantRepository>;
    const salesOrderService = {
      getById: jest.fn().mockResolvedValue(d2cOrder),
      countOtherQualifyingD2COrders: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<SalesOrderService>;
    const consumerService = {
      getById: jest.fn().mockResolvedValue(consumer),
    } as unknown as jest.Mocked<ConsumerService>;
    const auditService = { record: jest.fn() } as unknown as jest.Mocked<AuditService>;

    const service = new PromotionEvaluationService(
      promotionRepository,
      rewardGrantRepository,
      salesOrderService,
      consumerService,
      auditService,
    );
    return {
      service,
      promotionRepository,
      rewardGrantRepository,
      salesOrderService,
      consumerService,
      auditService,
    };
  }

  it('1. a first qualifying D2C order receives the configured benefit', async () => {
    const { service, promotionRepository, rewardGrantRepository, auditService } = makeService();
    const promotion = makePromotion();
    promotionRepository.findManyActiveEffective.mockResolvedValue([promotion]);
    rewardGrantRepository.createWithEarn.mockResolvedValue({
      grant: { id: 'grant-1' } as never,
      wasCreated: true,
    });

    const grants = await service.evaluateOrderQualification(orgId, consumerId, salesOrderId);

    expect(grants).toHaveLength(1);
    expect(rewardGrantRepository.createWithEarn).toHaveBeenCalledWith(
      expect.objectContaining({
        promotionId: 'promo-1',
        consumerId,
        qualifyingSalesOrderId: salesOrderId,
        benefitTypeSnapshot: 'BONUS_POINTS',
        pointsAwardedSnapshot: 200,
      }),
    );
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'consumer_reward_grant.granted' }),
    );
  });

  it('2. a non-qualifying order (wrong territory) receives no benefit', async () => {
    const { service, promotionRepository, rewardGrantRepository } = makeService();
    const promotion = makePromotion({
      conditions: [
        {
          id: 'c1',
          type: 'TERRITORY',
          minOrderValue: null,
          productId: null,
          minQuantity: null,
          territoryId: 'territory-OTHER',
        },
      ] as never,
    });
    promotionRepository.findManyActiveEffective.mockResolvedValue([promotion]);

    const grants = await service.evaluateOrderQualification(orgId, consumerId, salesOrderId);

    expect(grants).toHaveLength(0);
    expect(rewardGrantRepository.createWithEarn).not.toHaveBeenCalled();
  });

  it('3. an order below the configured minimum value receives no benefit', async () => {
    const { service, promotionRepository, salesOrderService, rewardGrantRepository } =
      makeService();
    salesOrderService.getById.mockResolvedValue({ ...d2cOrder, total: 1000 } as never);
    const promotion = makePromotion();
    promotionRepository.findManyActiveEffective.mockResolvedValue([promotion]);

    const grants = await service.evaluateOrderQualification(orgId, consumerId, salesOrderId);

    expect(grants).toHaveLength(0);
    expect(rewardGrantRepository.createWithEarn).not.toHaveBeenCalled();
  });

  it('4. a consumer with a prior qualifying order cannot receive FIRST_QUALIFYING_ORDER twice', async () => {
    const { service, promotionRepository, salesOrderService, rewardGrantRepository } =
      makeService();
    salesOrderService.countOtherQualifyingD2COrders.mockResolvedValue(1);
    const promotion = makePromotion();
    promotionRepository.findManyActiveEffective.mockResolvedValue([promotion]);

    const grants = await service.evaluateOrderQualification(orgId, consumerId, salesOrderId);

    expect(grants).toHaveLength(0);
    expect(rewardGrantRepository.createWithEarn).not.toHaveBeenCalled();
  });

  it('5. a duplicate event (repository reports wasCreated=false) does not re-audit as a new grant', async () => {
    const { service, promotionRepository, rewardGrantRepository, auditService } = makeService();
    const promotion = makePromotion();
    promotionRepository.findManyActiveEffective.mockResolvedValue([promotion]);
    rewardGrantRepository.createWithEarn.mockResolvedValue({
      grant: { id: 'grant-existing' } as never,
      wasCreated: false,
    });

    const grants = await service.evaluateOrderQualification(orgId, consumerId, salesOrderId);

    expect(grants).toHaveLength(1);
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it('6. concurrent qualifying requests: idempotency is delegated to the repository, which this service always calls exactly once per qualifying promotion', async () => {
    const { service, promotionRepository, rewardGrantRepository } = makeService();
    const promotion = makePromotion();
    promotionRepository.findManyActiveEffective.mockResolvedValue([promotion]);
    rewardGrantRepository.createWithEarn.mockResolvedValue({
      grant: { id: 'grant-1' } as never,
      wasCreated: true,
    });

    await Promise.all([
      service.evaluateOrderQualification(orgId, consumerId, salesOrderId),
      service.evaluateOrderQualification(orgId, consumerId, salesOrderId),
    ]);

    // Each top-level call independently evaluates and calls createWithEarn once per
    // qualifying promotion — the ACTUAL duplicate-prevention guarantee lives in
    // `RewardGrantRepository.createWithEarn`'s database-backed unique constraint
    // (proven for real concurrent transactions in
    // `promotions-concurrency.integration.spec.ts`), not in this service refusing to
    // call it twice.
    expect(rewardGrantRepository.createWithEarn).toHaveBeenCalledTimes(2);
  });

  it('7. a promotion outside its validity window is never even considered (findManyActiveEffective already excludes it)', async () => {
    const { service, promotionRepository, rewardGrantRepository } = makeService();
    promotionRepository.findManyActiveEffective.mockResolvedValue([]);

    const grants = await service.evaluateOrderQualification(orgId, consumerId, salesOrderId);

    expect(grants).toHaveLength(0);
    expect(rewardGrantRepository.createWithEarn).not.toHaveBeenCalled();
  });

  it('8. snapshots the evaluated terms onto the grant — changing the promotion later cannot alter what was already granted (the snapshot IS the mechanism)', async () => {
    const { service, promotionRepository, rewardGrantRepository } = makeService();
    const promotion = makePromotion();
    promotionRepository.findManyActiveEffective.mockResolvedValue([promotion]);
    rewardGrantRepository.createWithEarn.mockResolvedValue({
      grant: { id: 'grant-1' } as never,
      wasCreated: true,
    });

    await service.evaluateOrderQualification(orgId, consumerId, salesOrderId);

    expect(rewardGrantRepository.createWithEarn).toHaveBeenCalledWith(
      expect.objectContaining({
        promotionNameSnapshot: 'First Order October',
        conditionsSnapshot: expect.arrayContaining([
          expect.objectContaining({ type: 'FIRST_QUALIFYING_ORDER' }),
          expect.objectContaining({ type: 'MINIMUM_ORDER_VALUE', minOrderValue: 5000 }),
        ]),
      }),
    );
  });

  it('9. a different tenant cannot evaluate this promotion — findManyActiveEffective is itself tenant-scoped, never re-checked here', async () => {
    const { service, promotionRepository, rewardGrantRepository } = makeService();
    promotionRepository.findManyActiveEffective.mockResolvedValue([]);

    await service.evaluateOrderQualification('org-2', consumerId, salesOrderId);

    expect(promotionRepository.findManyActiveEffective).toHaveBeenCalledWith(
      'org-2',
      expect.any(Date),
    );
    expect(rewardGrantRepository.createWithEarn).not.toHaveBeenCalled();
  });

  it('10. an existing B2B order never qualifies for anything, even if a promotion is active', async () => {
    const { service, salesOrderService, promotionRepository, rewardGrantRepository } =
      makeService();
    salesOrderService.getById.mockResolvedValue({ ...d2cOrder, source: 'B2B' } as never);
    promotionRepository.findManyActiveEffective.mockResolvedValue([makePromotion()]);

    const grants = await service.evaluateOrderQualification(orgId, consumerId, salesOrderId);

    expect(grants).toHaveLength(0);
    expect(promotionRepository.findManyActiveEffective).not.toHaveBeenCalled();
    expect(rewardGrantRepository.createWithEarn).not.toHaveBeenCalled();
  });

  it('a DRAFT (unpaid/unconfirmed) order never qualifies', async () => {
    const { service, salesOrderService, rewardGrantRepository } = makeService();
    salesOrderService.getById.mockResolvedValue({ ...d2cOrder, status: 'DRAFT' } as never);

    const grants = await service.evaluateOrderQualification(orgId, consumerId, salesOrderId);

    expect(grants).toHaveLength(0);
    expect(rewardGrantRepository.createWithEarn).not.toHaveBeenCalled();
  });

  it('PRODUCT_QUANTITY: sums matching line quantities and compares against the configured minimum', async () => {
    const { service, promotionRepository, salesOrderService, rewardGrantRepository } =
      makeService();
    salesOrderService.getById.mockResolvedValue({
      ...d2cOrder,
      items: [
        { productId: 'product-X', quantity: 2 },
        { productId: 'product-X', quantity: 2 },
        { productId: 'product-Y', quantity: 10 },
      ],
    } as never);
    const promotion = makePromotion({
      conditions: [
        {
          id: 'c1',
          type: 'PRODUCT_QUANTITY',
          minOrderValue: null,
          productId: 'product-X',
          minQuantity: 3,
          territoryId: null,
        },
      ] as never,
    });
    promotionRepository.findManyActiveEffective.mockResolvedValue([promotion]);
    rewardGrantRepository.createWithEarn.mockResolvedValue({
      grant: { id: 'grant-1' } as never,
      wasCreated: true,
    });

    const grants = await service.evaluateOrderQualification(orgId, consumerId, salesOrderId);

    expect(grants).toHaveLength(1); // 2 + 2 = 4 >= 3
  });

  it('multiple simultaneously-qualifying promotions each independently produce a grant (the documented no-stacking-suppression default)', async () => {
    const { service, promotionRepository, rewardGrantRepository } = makeService();
    const promotionA = makePromotion({ id: 'promo-A', name: 'Promotion A' });
    const promotionB = makePromotion({ id: 'promo-B', name: 'Promotion B' });
    promotionRepository.findManyActiveEffective.mockResolvedValue([promotionA, promotionB]);
    rewardGrantRepository.createWithEarn
      .mockResolvedValueOnce({ grant: { id: 'grant-A' } as never, wasCreated: true })
      .mockResolvedValueOnce({ grant: { id: 'grant-B' } as never, wasCreated: true });

    const grants = await service.evaluateOrderQualification(orgId, consumerId, salesOrderId);

    expect(grants).toHaveLength(2);
    expect(rewardGrantRepository.createWithEarn).toHaveBeenCalledTimes(2);
  });
});
