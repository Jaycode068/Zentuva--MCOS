import { ConfigService } from '@nestjs/config';
import { Consumer } from '@prisma/client';

import { ConsumerRepository } from '../consumer/consumer.repository';
import { WhatsAppOrganisationResolverService } from './whatsapp-organisation-resolver.service';

describe('WhatsAppOrganisationResolverService', () => {
  function makeConsumer(organisationId: string, createdAt: Date): Consumer {
    return { organisationId, createdAt } as Consumer;
  }

  function makeService(matches: Consumer[], defaultOrganisationId?: string) {
    const consumerRepository = {
      findManyByNormalizedPhoneAcrossOrganisations: jest.fn().mockResolvedValue(matches),
    } as unknown as ConsumerRepository;
    const config = {
      get: jest.fn(() => defaultOrganisationId),
    } as unknown as ConfigService;
    return new WhatsAppOrganisationResolverService(consumerRepository, config);
  }

  it('resolves to the single matching organisation for a returning contact', async () => {
    const service = makeService([makeConsumer('org-1', new Date('2026-01-01'))]);
    await expect(service.resolveOrganisationId('+2348012345678')).resolves.toBe('org-1');
  });

  it('resolves to the most recently created match when the same phone exists in multiple organisations', async () => {
    const service = makeService([
      makeConsumer('org-old', new Date('2026-01-01')),
      makeConsumer('org-new', new Date('2026-06-01')),
    ]);
    await expect(service.resolveOrganisationId('+2348012345678')).resolves.toBe('org-new');
  });

  it('falls back to WHATSAPP_DEFAULT_ORGANISATION_ID for a brand-new contact', async () => {
    const service = makeService([], 'org-default');
    await expect(service.resolveOrganisationId('+2348012345678')).resolves.toBe('org-default');
  });

  it('returns null for a brand-new contact when no default organisation is configured', async () => {
    const service = makeService([], undefined);
    await expect(service.resolveOrganisationId('+2348012345678')).resolves.toBeNull();
  });
});
