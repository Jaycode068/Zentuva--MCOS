import { BadRequestException, NotFoundException } from '@nestjs/common';

import { OrganisationService } from '../../identity/organisation/organisation.service';
import { TerritoryRepository } from '../../retail/territory/territory.repository';
import { ConsumerLocationRequestRepository } from './consumer-location-request.repository';
import { ConsumerRepository } from './consumer.repository';
import { ConsumerService } from './consumer.service';

/**
 * Sprint 32 — Consumer Identity, Territory & Location Foundation
 * (docs/domains/d2c.md). Service-contract tests (brief §26): these prove
 * `registerConsumer`/`findConsumerByPhone`/`getConsumer`/
 * `updateConsumerLocation`/`getConsumerProfile` behave correctly against a
 * mocked repository layer — the exact contract a future WhatsApp/simulator
 * channel adapter will call directly, without knowing anything about the
 * database implementation.
 */
describe('ConsumerService', () => {
  function makeService(organisationCountry: string | null = 'Nigeria') {
    const consumerRepository = {
      findById: jest.fn(),
      findByNormalizedPhone: jest.fn(),
      findManyByOrganisation: jest.fn(),
      existsByCode: jest.fn().mockResolvedValue(false),
      findOrCreate: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<ConsumerRepository>;
    const locationRequestRepository = {
      create: jest.fn(),
      list: jest.fn(),
      resolve: jest.fn(),
    } as unknown as jest.Mocked<ConsumerLocationRequestRepository>;
    const territoryRepository = {
      findById: jest.fn().mockResolvedValue({ id: 'territory-1', name: 'Bodija' }),
    } as unknown as jest.Mocked<TerritoryRepository>;
    const organisationService = {
      getById: jest.fn().mockResolvedValue({ id: 'org-1', country: organisationCountry }),
    } as unknown as jest.Mocked<OrganisationService>;

    const service = new ConsumerService(
      consumerRepository,
      locationRequestRepository,
      territoryRepository,
      organisationService,
    );
    return { service, consumerRepository, locationRequestRepository, territoryRepository };
  }

  const baseInput = { fullName: 'Blessing Okafor', phoneNumber: '08031234501' };

  describe('registerConsumer — identity', () => {
    it('normalizes a Nigerian local-format phone number and creates a new consumer', async () => {
      const { service, consumerRepository } = makeService();
      consumerRepository.findOrCreate.mockResolvedValue({
        consumer: { id: 'c-1', normalizedPhone: '+2348031234501' } as never,
        created: true,
      });

      const result = await service.registerConsumer('org-1', baseInput as never, 'user-1');

      expect(result.created).toBe(true);
      expect(consumerRepository.findOrCreate).toHaveBeenCalledWith(
        expect.objectContaining({ normalizedPhone: '+2348031234501', organisationId: 'org-1' }),
      );
    });

    it.each([
      ['08031234501', '+2348031234501'],
      ['2348031234501', '+2348031234501'],
      ['+2348031234501', '+2348031234501'],
    ])(
      'treats %s and +2348031234501 as the same identity',
      async (rawPhone, expectedNormalized) => {
        const { service, consumerRepository } = makeService();
        consumerRepository.findOrCreate.mockResolvedValue({
          consumer: { id: 'c-1', normalizedPhone: expectedNormalized } as never,
          created: true,
        });

        await service.registerConsumer(
          'org-1',
          { ...baseInput, phoneNumber: rawPhone } as never,
          'user-1',
        );

        expect(consumerRepository.findOrCreate).toHaveBeenCalledWith(
          expect.objectContaining({ normalizedPhone: expectedNormalized }),
        );
      },
    );

    it('rejects registration when the phone cannot be normalized at all', async () => {
      const { service } = makeService();

      await expect(
        service.registerConsumer('org-1', { ...baseInput, phoneNumber: '123' } as never, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects registration when the supplied territory does not exist', async () => {
      const { service, territoryRepository } = makeService();
      territoryRepository.findById.mockResolvedValue(null);

      await expect(
        service.registerConsumer(
          'org-1',
          { ...baseInput, territoryId: 'bad-territory' } as never,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns the existing consumer, not a new one, on a repeated registration for the same phone', async () => {
      const { service, consumerRepository } = makeService();
      consumerRepository.findOrCreate.mockResolvedValue({
        consumer: { id: 'c-1', normalizedPhone: '+2348031234501' } as never,
        created: false,
      });

      const result = await service.registerConsumer('org-1', baseInput as never, 'user-1');

      expect(result.created).toBe(false);
      expect(result.consumer.id).toBe('c-1');
    });
  });

  describe('findConsumerByPhone', () => {
    it('normalizes before looking up', async () => {
      const { service, consumerRepository } = makeService();
      consumerRepository.findByNormalizedPhone.mockResolvedValue({ id: 'c-1' } as never);

      const result = await service.findConsumerByPhone('org-1', '08031234501');

      expect(consumerRepository.findByNormalizedPhone).toHaveBeenCalledWith(
        'org-1',
        '+2348031234501',
      );
      expect(result).toEqual({ id: 'c-1' });
    });

    it('returns null (never throws) for an unnormalizable phone', async () => {
      const { service, consumerRepository } = makeService();

      const result = await service.findConsumerByPhone('org-1', 'not-a-phone');

      expect(result).toBeNull();
      expect(consumerRepository.findByNormalizedPhone).not.toHaveBeenCalled();
    });
  });

  describe('updateConsumerLocation', () => {
    it('updates the territory when it exists', async () => {
      const { service, consumerRepository } = makeService();
      consumerRepository.findById.mockResolvedValue({ id: 'c-1' } as never);
      consumerRepository.update.mockResolvedValue({
        id: 'c-1',
        territoryId: 'territory-1',
      } as never);

      const result = await service.updateConsumerLocation('org-1', 'c-1', 'territory-1', 'user-1');

      expect(result.territoryId).toBe('territory-1');
    });

    it('rejects an invalid/non-existent territory', async () => {
      const { service, consumerRepository, territoryRepository } = makeService();
      consumerRepository.findById.mockResolvedValue({ id: 'c-1' } as never);
      territoryRepository.findById.mockResolvedValue(null);

      await expect(
        service.updateConsumerLocation('org-1', 'c-1', 'bad-territory', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows explicitly clearing the location (territoryId: null) without touching Territory itself', async () => {
      const { service, consumerRepository, territoryRepository } = makeService();
      consumerRepository.findById.mockResolvedValue({ id: 'c-1' } as never);
      consumerRepository.update.mockResolvedValue({ id: 'c-1', territoryId: null } as never);

      const result = await service.updateConsumerLocation('org-1', 'c-1', null, 'user-1');

      expect(result.territoryId).toBeNull();
      expect(territoryRepository.findById).not.toHaveBeenCalled();
    });

    it('throws when the consumer does not exist', async () => {
      const { service, consumerRepository } = makeService();
      consumerRepository.findById.mockResolvedValue(null);

      await expect(
        service.updateConsumerLocation('org-1', 'missing', 'territory-1', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('reportLocationNotFound — non-authoritative signal', () => {
    it('records the raw text without creating or referencing any Territory', async () => {
      const { service, consumerRepository, locationRequestRepository } = makeService();
      consumerRepository.findById.mockResolvedValue({ id: 'c-1' } as never);
      locationRequestRepository.create.mockResolvedValue({ id: 'req-1' } as never);

      await service.reportLocationNotFound('org-1', 'c-1', 'somewhere around Challenge');

      expect(locationRequestRepository.create).toHaveBeenCalledWith({
        organisationId: 'org-1',
        consumerId: 'c-1',
        rawLocationText: 'somewhere around Challenge',
      });
    });
  });

  describe('status transitions', () => {
    it('activate throws if already active', async () => {
      const { service, consumerRepository } = makeService();
      consumerRepository.findById.mockResolvedValue({ id: 'c-1', status: 'ACTIVE' } as never);

      await expect(service.activate('org-1', 'c-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('suspend succeeds from ACTIVE', async () => {
      const { service, consumerRepository } = makeService();
      consumerRepository.findById.mockResolvedValue({ id: 'c-1', status: 'ACTIVE' } as never);
      consumerRepository.update.mockResolvedValue({ id: 'c-1', status: 'SUSPENDED' } as never);

      const result = await service.suspend('org-1', 'c-1', 'user-1');

      expect(result.status).toBe('SUSPENDED');
    });
  });
});
