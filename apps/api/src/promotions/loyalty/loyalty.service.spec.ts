import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ConsumerService } from '../../d2c/consumer/consumer.service';
import { LoyaltyAccountRepository } from './loyalty-account.repository';
import { LoyaltyLedgerRepository } from './loyalty-ledger.repository';
import { LoyaltyService } from './loyalty.service';

describe('LoyaltyService', () => {
  const orgId = 'org-1';
  const consumerId = 'consumer-1';

  function makeService() {
    const loyaltyAccountRepository = {
      findByConsumerId: jest.fn(),
      findManyPaginated: jest.fn(),
    } as unknown as jest.Mocked<LoyaltyAccountRepository>;
    const loyaltyLedgerRepository = {
      findManyByConsumer: jest.fn(),
      applyAdjustment: jest.fn(),
    } as unknown as jest.Mocked<LoyaltyLedgerRepository>;
    const consumerService = {
      getById: jest.fn(),
    } as unknown as jest.Mocked<ConsumerService>;

    const service = new LoyaltyService(
      loyaltyAccountRepository,
      loyaltyLedgerRepository,
      consumerService,
    );
    return { service, loyaltyAccountRepository, loyaltyLedgerRepository, consumerService };
  }

  describe('adjust', () => {
    it('rejects an adjustment for a consumer outside this tenant', async () => {
      const { service, consumerService } = makeService();
      consumerService.getById.mockResolvedValue(null);

      await expect(
        service.adjust(orgId, consumerId, { amount: 100, reason: 'Goodwill' }, 'admin-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('translates a null (insufficient balance) result into a 400', async () => {
      const { service, consumerService, loyaltyLedgerRepository } = makeService();
      consumerService.getById.mockResolvedValue({ id: consumerId } as never);
      loyaltyLedgerRepository.applyAdjustment.mockResolvedValue(null);

      await expect(
        service.adjust(orgId, consumerId, { amount: -500, reason: 'Correction' }, 'admin-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('applies a valid adjustment and returns the ledger entry', async () => {
      const { service, consumerService, loyaltyLedgerRepository } = makeService();
      consumerService.getById.mockResolvedValue({ id: consumerId } as never);
      loyaltyLedgerRepository.applyAdjustment.mockResolvedValue({
        id: 'entry-1',
        amount: 100,
        balanceAfter: 300,
      } as never);

      const result = await service.adjust(
        orgId,
        consumerId,
        { amount: 100, reason: 'Goodwill gesture' },
        'admin-1',
      );

      expect(result.id).toBe('entry-1');
      expect(loyaltyLedgerRepository.applyAdjustment).toHaveBeenCalledWith({
        organisationId: orgId,
        consumerId,
        amount: 100,
        reason: 'Goodwill gesture',
        actorUserId: 'admin-1',
      });
    });
  });

  describe('getAccount', () => {
    it('returns null for a consumer who has never earned anything — not an error', async () => {
      const { service, loyaltyAccountRepository } = makeService();
      loyaltyAccountRepository.findByConsumerId.mockResolvedValue(null);

      const result = await service.getAccount(orgId, consumerId);
      expect(result).toBeNull();
    });
  });
});
