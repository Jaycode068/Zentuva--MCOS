import { ConfigService } from '@nestjs/config';

import { ConsumerService } from '../consumer/consumer.service';
import { ConsumerWhatsAppDeliveryRepository } from './consumer-whatsapp-delivery.repository';
import { WhatsAppConsumerNotificationService } from './whatsapp-consumer-notification.service';
import { WhatsAppProvider } from '../../notifications/ports/whatsapp-provider.port';

describe('WhatsAppConsumerNotificationService', () => {
  function makeService(options: { configValues?: Record<string, unknown> } = {}) {
    const provider = {
      sendText: jest.fn().mockResolvedValue({ outcome: 'ACCEPTED', providerMessageId: 'wamid.1' }),
      sendTemplate: jest
        .fn()
        .mockResolvedValue({ outcome: 'ACCEPTED', providerMessageId: 'wamid.2' }),
      sendImage: jest.fn(),
      name: 'local',
    } as unknown as jest.Mocked<WhatsAppProvider>;
    const consumerService = {
      getById: jest.fn().mockResolvedValue({ id: 'consumer-1', normalizedPhone: '+2348012345678' }),
      // Default: "the consumer messaged in just now" — preserves every pre-existing
      // test's original intent (they are not about the messaging window) by keeping
      // every COLLECTION_READY/COLLECTION_CONFIRMED send inside the window by default.
      getLastInboundMessageAt: jest.fn().mockResolvedValue(new Date()),
    } as unknown as jest.Mocked<ConsumerService>;
    const repository = {
      create: jest
        .fn()
        .mockImplementation((data) => Promise.resolve({ id: 'delivery-1', attempts: 0, ...data })),
      markSent: jest
        .fn()
        .mockImplementation((organisationId, id, data) =>
          Promise.resolve({ id, status: 'SENT', ...data }),
        ),
      markFailed: jest
        .fn()
        .mockImplementation((organisationId, id, data) =>
          Promise.resolve({ id, status: 'FAILED', ...data }),
        ),
    } as unknown as jest.Mocked<ConsumerWhatsAppDeliveryRepository>;
    const config = {
      get: jest.fn((key: string) => options.configValues?.[key]),
    } as unknown as jest.Mocked<ConfigService>;
    const service = new WhatsAppConsumerNotificationService(
      provider,
      consumerService,
      repository,
      config,
    );
    return { service, provider, consumerService, repository, config };
  }

  const request = {
    organisationId: 'org-1',
    consumerId: 'consumer-1',
    salesOrderId: 'order-1',
    kind: 'COLLECTION_READY' as const,
    message: 'Your order is ready',
  };

  it('resolves the consumer, creates a delivery row, and sends via sendText with the normalized phone', async () => {
    const { service, provider, repository } = makeService();
    await service.notify(request);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: 'org-1',
        consumerId: 'consumer-1',
        salesOrderId: 'order-1',
        kind: 'COLLECTION_READY',
        recipientPhoneSnapshot: '+2348012345678',
        messageSnapshot: 'Your order is ready',
      }),
    );
    expect(provider.sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        toPhoneNumber: '+2348012345678',
        text: 'Your order is ready',
        correlationId: 'delivery-1',
      }),
    );
  });

  it('marks the delivery SENT on an accepted send', async () => {
    const { service, repository } = makeService();
    await service.notify(request);
    expect(repository.markSent).toHaveBeenCalledWith(
      'org-1',
      'delivery-1',
      expect.objectContaining({
        providerName: 'local',
        providerMessageId: 'wamid.1',
        isFirstAttempt: true,
      }),
    );
    expect(repository.markFailed).not.toHaveBeenCalled();
  });

  it('marks the delivery FAILED when the provider rejects the send — never throws', async () => {
    const { service, provider, repository } = makeService();
    provider.sendText.mockResolvedValue({
      outcome: 'TERMINAL_FAILURE',
      errorCode: 'WHATSAPP_AUTH',
    });
    await expect(service.notify(request)).resolves.toBeUndefined();
    expect(repository.markFailed).toHaveBeenCalledWith(
      'org-1',
      'delivery-1',
      expect.objectContaining({ errorCode: 'WHATSAPP_AUTH', isFirstAttempt: true }),
    );
  });

  it('marks the delivery FAILED when the provider itself throws — never throws', async () => {
    const { service, provider, repository } = makeService();
    provider.sendText.mockRejectedValue(new Error('network error'));
    await expect(service.notify(request)).resolves.toBeUndefined();
    expect(repository.markFailed).toHaveBeenCalledWith(
      'org-1',
      'delivery-1',
      expect.objectContaining({ errorCode: 'WHATSAPP_UNEXPECTED', isFirstAttempt: true }),
    );
  });

  it('never throws when the consumer is unknown — logs and returns, creates no delivery row', async () => {
    const { service, consumerService, provider, repository } = makeService();
    consumerService.getById.mockResolvedValue(null as never);
    await expect(service.notify(request)).resolves.toBeUndefined();
    expect(provider.sendText).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  describe('attemptSend (shared by the retry path)', () => {
    it('marks SENT with isFirstAttempt: false and does not touch firstAttemptedAt semantics twice', async () => {
      const { service, repository } = makeService();
      const delivery = { id: 'delivery-2', attempts: 1 } as never;
      await service.attemptSend('org-1', delivery, '+2348012345678', 'Order collected!', false);
      expect(repository.markSent).toHaveBeenCalledWith(
        'org-1',
        'delivery-2',
        expect.objectContaining({ isFirstAttempt: false }),
      );
    });
  });

  describe('Stage 5C.1 — messaging window and template fallback', () => {
    const windowDelivery = {
      id: 'delivery-3',
      kind: 'COLLECTION_READY',
      consumerId: 'consumer-1',
      attempts: 0,
    } as never;

    it('sends via sendText, unchanged, when the consumer messaged in within the last 24h', async () => {
      const { service, consumerService, provider, repository } = makeService();
      consumerService.getLastInboundMessageAt.mockResolvedValue(
        new Date(Date.now() - 60 * 60 * 1000), // 1h ago
      );
      await service.attemptSend('org-1', windowDelivery, '+2348012345678', 'Ready!', true);
      expect(provider.sendText).toHaveBeenCalledWith(expect.objectContaining({ text: 'Ready!' }));
      expect(provider.sendTemplate).not.toHaveBeenCalled();
      expect(repository.markSent).toHaveBeenCalled();
    });

    it('sends via the configured template, not sendText, when outside the 24h window', async () => {
      const { service, consumerService, provider, repository } = makeService({
        configValues: {
          'whatsapp.d2cCollectionReadyTemplateName': 'zentuva_d2c_collection_ready',
          'whatsapp.d2cCollectionReadyTemplateLanguage': 'en_US',
        },
      });
      consumerService.getLastInboundMessageAt.mockResolvedValue(
        new Date(Date.now() - 25 * 60 * 60 * 1000), // 25h ago — outside the window
      );
      await service.attemptSend('org-1', windowDelivery, '+2348012345678', 'Ready!', true);
      expect(provider.sendTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          templateName: 'zentuva_d2c_collection_ready',
          templateLanguage: 'en_US',
          bodyParameters: ['Ready!'],
        }),
      );
      expect(provider.sendText).not.toHaveBeenCalled();
      expect(repository.markSent).toHaveBeenCalled();
    });

    it('fails closed — never calls sendText or sendTemplate — when outside the window and no template is configured', async () => {
      const { service, consumerService, provider, repository } = makeService();
      consumerService.getLastInboundMessageAt.mockResolvedValue(
        new Date(Date.now() - 25 * 60 * 60 * 1000),
      );
      await service.attemptSend('org-1', windowDelivery, '+2348012345678', 'Ready!', true);
      expect(provider.sendText).not.toHaveBeenCalled();
      expect(provider.sendTemplate).not.toHaveBeenCalled();
      expect(repository.markFailed).toHaveBeenCalledWith(
        'org-1',
        'delivery-3',
        expect.objectContaining({ errorCode: 'WHATSAPP_TEMPLATE_NOT_CONFIGURED' }),
      );
    });

    it('never has had an inbound message recorded at all — treated as outside the window, fails closed without a template', async () => {
      const { service, consumerService, provider, repository } = makeService();
      consumerService.getLastInboundMessageAt.mockResolvedValue(null);
      await service.attemptSend('org-1', windowDelivery, '+2348012345678', 'Ready!', true);
      expect(provider.sendText).not.toHaveBeenCalled();
      expect(repository.markFailed).toHaveBeenCalledWith(
        'org-1',
        'delivery-3',
        expect.objectContaining({ errorCode: 'WHATSAPP_TEMPLATE_NOT_CONFIGURED' }),
      );
    });

    it('CONVERSATION_REPLY is never window-checked — always sendText, regardless of last-inbound time', async () => {
      const { service, consumerService, provider } = makeService();
      consumerService.getLastInboundMessageAt.mockResolvedValue(
        new Date(Date.now() - 999 * 60 * 60 * 1000), // long outside any window
      );
      const replyDelivery = {
        id: 'delivery-4',
        kind: 'CONVERSATION_REPLY',
        consumerId: 'consumer-1',
        attempts: 0,
      } as never;
      await service.attemptSend('org-1', replyDelivery, '+2348012345678', 'Hello!', true);
      expect(provider.sendText).toHaveBeenCalled();
      expect(consumerService.getLastInboundMessageAt).not.toHaveBeenCalled();
    });

    it('a retry re-evaluates the window fresh — a retry outside the window still fails closed even though the original attempt was within it', async () => {
      const { service, consumerService, provider, repository } = makeService();
      // First attempt: within the window, sends fine.
      consumerService.getLastInboundMessageAt.mockResolvedValueOnce(new Date());
      await service.attemptSend('org-1', windowDelivery, '+2348012345678', 'Ready!', true);
      expect(provider.sendText).toHaveBeenCalledTimes(1);

      // Retry, hours later: now outside the window, no template configured.
      consumerService.getLastInboundMessageAt.mockResolvedValueOnce(
        new Date(Date.now() - 30 * 60 * 60 * 1000),
      );
      await service.attemptSend('org-1', windowDelivery, '+2348012345678', 'Ready!', false);
      expect(provider.sendText).toHaveBeenCalledTimes(1); // not called again
      expect(repository.markFailed).toHaveBeenCalledWith(
        'org-1',
        'delivery-3',
        expect.objectContaining({
          errorCode: 'WHATSAPP_TEMPLATE_NOT_CONFIGURED',
          isFirstAttempt: false,
        }),
      );
    });
  });
});
