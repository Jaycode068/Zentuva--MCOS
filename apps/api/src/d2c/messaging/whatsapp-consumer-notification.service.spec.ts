import { ConsumerService } from '../consumer/consumer.service';
import { ConsumerWhatsAppDeliveryRepository } from './consumer-whatsapp-delivery.repository';
import { WhatsAppConsumerNotificationService } from './whatsapp-consumer-notification.service';
import { WhatsAppProvider } from '../../notifications/ports/whatsapp-provider.port';

describe('WhatsAppConsumerNotificationService', () => {
  function makeService() {
    const provider = {
      sendText: jest.fn().mockResolvedValue({ outcome: 'ACCEPTED', providerMessageId: 'wamid.1' }),
      sendTemplate: jest.fn(),
      sendImage: jest.fn(),
      name: 'local',
    } as unknown as jest.Mocked<WhatsAppProvider>;
    const consumerService = {
      getById: jest.fn().mockResolvedValue({ id: 'consumer-1', normalizedPhone: '+2348012345678' }),
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
    const service = new WhatsAppConsumerNotificationService(provider, consumerService, repository);
    return { service, provider, consumerService, repository };
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
});
