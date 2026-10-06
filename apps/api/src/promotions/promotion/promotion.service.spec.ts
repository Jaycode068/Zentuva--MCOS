import { NotFoundException } from '@nestjs/common';

import { ProductRepository } from '../../catalogue/product/product.repository';
import { TerritoryRepository } from '../../retail/territory/territory.repository';
import { PromotionRepository, PromotionWithRelations } from './promotion.repository';
import { PromotionService } from './promotion.service';
import {
  InvalidPromotionConditionError,
  InvalidPromotionTransitionError,
  PromotionNotActivatableError,
  PromotionNotEditableError,
} from './promotion.types';

describe('PromotionService', () => {
  const orgId = 'org-1';

  function makePromotion(overrides: Partial<PromotionWithRelations> = {}): PromotionWithRelations {
    return {
      id: 'promo-1',
      organisationId: orgId,
      name: 'First Order October',
      description: null,
      status: 'DRAFT',
      startsAt: new Date('2026-10-01'),
      endsAt: new Date('2026-10-31'),
      activatedAt: null,
      createdById: 'user-1',
      updatedById: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      conditions: [],
      benefits: [],
      ...overrides,
    } as PromotionWithRelations;
  }

  function makeService() {
    const promotionRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyPaginated: jest.fn(),
      findManyActiveEffective: jest.fn(),
      updateHeader: jest.fn(),
      replaceConditionsAndBenefits: jest.fn(),
      updateStatus: jest.fn(),
    } as unknown as jest.Mocked<PromotionRepository>;
    const productRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<ProductRepository>;
    const territoryRepository = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<TerritoryRepository>;

    const service = new PromotionService(
      promotionRepository,
      productRepository,
      territoryRepository,
    );
    return { service, promotionRepository, productRepository, territoryRepository };
  }

  describe('create', () => {
    it('creates a DRAFT promotion with validated conditions/benefit', async () => {
      const { service, promotionRepository } = makeService();
      promotionRepository.create.mockResolvedValue(makePromotion());

      await service.create(
        orgId,
        {
          name: 'First Order October',
          startsAt: new Date('2026-10-01'),
          endsAt: new Date('2026-10-31'),
          conditions: [{ type: 'MINIMUM_ORDER_VALUE', minOrderValue: 5000 }],
          benefit: { type: 'BONUS_POINTS', pointsValue: 200 },
        },
        'user-1',
      );

      expect(promotionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          organisationId: orgId,
          conditions: [{ type: 'MINIMUM_ORDER_VALUE', minOrderValue: 5000 }],
          benefits: [{ type: 'BONUS_POINTS', pointsValue: 200 }],
        }),
      );
    });

    it('rejects a PRODUCT_QUANTITY condition referencing a product outside this tenant', async () => {
      const { service, productRepository } = makeService();
      productRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          orgId,
          {
            name: 'Buy 3',
            startsAt: new Date('2026-11-01'),
            endsAt: new Date('2026-11-15'),
            conditions: [{ type: 'PRODUCT_QUANTITY', productId: 'ghost-product', minQuantity: 3 }],
          },
          'user-1',
        ),
      ).rejects.toThrow(InvalidPromotionConditionError);
    });

    it('rejects a TERRITORY condition referencing a territory outside this tenant', async () => {
      const { service, territoryRepository } = makeService();
      territoryRepository.findById.mockResolvedValue(null);

      await expect(
        service.create(
          orgId,
          {
            name: 'Ibadan North',
            startsAt: new Date('2026-11-01'),
            endsAt: new Date('2026-11-15'),
            conditions: [{ type: 'TERRITORY', territoryId: 'ghost-territory' }],
          },
          'user-1',
        ),
      ).rejects.toThrow(InvalidPromotionConditionError);
    });
  });

  describe('update', () => {
    it('rejects editing a promotion that has already left DRAFT', async () => {
      const { service, promotionRepository } = makeService();
      promotionRepository.findById.mockResolvedValue(makePromotion({ status: 'ACTIVE' }));

      await expect(
        service.update(orgId, 'promo-1', { name: 'New name' }, 'user-1'),
      ).rejects.toThrow(PromotionNotEditableError);
    });

    it('allows editing a DRAFT promotion', async () => {
      const { service, promotionRepository } = makeService();
      const draft = makePromotion();
      promotionRepository.findById.mockResolvedValue(draft);
      promotionRepository.updateHeader.mockResolvedValue(draft);

      await service.update(orgId, 'promo-1', { name: 'Renamed' }, 'user-1');

      expect(promotionRepository.updateHeader).toHaveBeenCalledWith(
        orgId,
        'promo-1',
        expect.objectContaining({ name: 'Renamed' }),
        'user-1',
      );
    });
  });

  describe('activate', () => {
    it('rejects activating a promotion with no conditions', async () => {
      const { service, promotionRepository } = makeService();
      promotionRepository.findById.mockResolvedValue(
        makePromotion({
          benefits: [
            {
              id: 'b1',
              type: 'BONUS_POINTS',
              pointsValue: 200,
              freeProductId: null,
              freeProductQuantity: null,
            },
          ],
        }),
      );

      await expect(service.activate(orgId, 'promo-1', 'user-1')).rejects.toThrow(
        PromotionNotActivatableError,
      );
    });

    it('rejects activating a promotion with no benefit', async () => {
      const { service, promotionRepository } = makeService();
      promotionRepository.findById.mockResolvedValue(
        makePromotion({
          conditions: [
            {
              id: 'c1',
              type: 'FIRST_QUALIFYING_ORDER',
              minOrderValue: null,
              productId: null,
              minQuantity: null,
              territoryId: null,
            },
          ],
        }),
      );

      await expect(service.activate(orgId, 'promo-1', 'user-1')).rejects.toThrow(
        PromotionNotActivatableError,
      );
    });

    it('activates a complete DRAFT promotion', async () => {
      const { service, promotionRepository } = makeService();
      const complete = makePromotion({
        conditions: [
          {
            id: 'c1',
            type: 'FIRST_QUALIFYING_ORDER',
            minOrderValue: null,
            productId: null,
            minQuantity: null,
            territoryId: null,
          },
        ],
        benefits: [
          {
            id: 'b1',
            type: 'BONUS_POINTS',
            pointsValue: 200,
            freeProductId: null,
            freeProductQuantity: null,
          },
        ],
      });
      promotionRepository.findById.mockResolvedValue(complete);
      promotionRepository.updateStatus.mockResolvedValue(makePromotion({ status: 'ACTIVE' }));

      const result = await service.activate(orgId, 'promo-1', 'user-1');

      expect(result.status).toBe('ACTIVE');
      expect(promotionRepository.updateStatus).toHaveBeenCalledWith(
        orgId,
        'promo-1',
        ['DRAFT'],
        expect.objectContaining({ status: 'ACTIVE' }),
      );
    });

    it('maps a concurrent/already-activated transition to InvalidPromotionTransitionError', async () => {
      const { service, promotionRepository } = makeService();
      const complete = makePromotion({
        conditions: [
          {
            id: 'c1',
            type: 'FIRST_QUALIFYING_ORDER',
            minOrderValue: null,
            productId: null,
            minQuantity: null,
            territoryId: null,
          },
        ],
        benefits: [
          {
            id: 'b1',
            type: 'BONUS_POINTS',
            pointsValue: 200,
            freeProductId: null,
            freeProductQuantity: null,
          },
        ],
      });
      promotionRepository.findById.mockResolvedValue(complete);
      promotionRepository.updateStatus.mockResolvedValue(null);

      await expect(service.activate(orgId, 'promo-1', 'user-1')).rejects.toThrow(
        InvalidPromotionTransitionError,
      );
    });
  });

  describe('pause / resume', () => {
    it('pause: ACTIVE -> PAUSED', async () => {
      const { service, promotionRepository } = makeService();
      promotionRepository.updateStatus.mockResolvedValue(makePromotion({ status: 'PAUSED' }));

      const result = await service.pause(orgId, 'promo-1', 'user-1');
      expect(result.status).toBe('PAUSED');
    });

    it('resume: PAUSED -> ACTIVE', async () => {
      const { service, promotionRepository } = makeService();
      promotionRepository.updateStatus.mockResolvedValue(makePromotion({ status: 'ACTIVE' }));

      const result = await service.resume(orgId, 'promo-1', 'user-1');
      expect(result.status).toBe('ACTIVE');
    });

    it('pause rejects a non-ACTIVE promotion', async () => {
      const { service, promotionRepository } = makeService();
      promotionRepository.updateStatus.mockResolvedValue(null);

      await expect(service.pause(orgId, 'promo-1', 'user-1')).rejects.toThrow(
        InvalidPromotionTransitionError,
      );
    });
  });

  describe('tenant isolation', () => {
    it('getById throws NotFoundException for a promotion belonging to another organisation', async () => {
      const { service, promotionRepository } = makeService();
      promotionRepository.findById.mockResolvedValue(null);

      await expect(service.getById('org-2', 'promo-1')).rejects.toThrow(NotFoundException);
    });
  });
});
