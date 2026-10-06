import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { WhatsAppWebhookEventRepository } from './whatsapp-webhook-event.repository';

describe('WhatsAppWebhookEventRepository', () => {
  function makeRepository(createImpl: () => Promise<unknown>) {
    const prisma = {
      whatsAppWebhookEvent: { create: jest.fn(createImpl) },
    } as unknown as PrismaService;
    return new WhatsAppWebhookEventRepository(prisma);
  }

  it('returns true the first time an externalMessageId is claimed', async () => {
    const repository = makeRepository(() => Promise.resolve({}));
    await expect(repository.tryClaim('wamid.ABC', 'INBOUND_MESSAGE')).resolves.toBe(true);
  });

  it('returns false on a unique-constraint violation (already claimed / redelivery)', async () => {
    const error = Object.assign(new Error('duplicate'), { code: 'P2002' });
    Object.setPrototypeOf(error, Prisma.PrismaClientKnownRequestError.prototype);
    const repository = makeRepository(() => Promise.reject(error));
    await expect(repository.tryClaim('wamid.ABC', 'INBOUND_MESSAGE')).resolves.toBe(false);
  });

  it('rethrows any other database error rather than silently treating it as a duplicate', async () => {
    const repository = makeRepository(() => Promise.reject(new Error('connection lost')));
    await expect(repository.tryClaim('wamid.ABC', 'INBOUND_MESSAGE')).rejects.toThrow(
      'connection lost',
    );
  });
});
