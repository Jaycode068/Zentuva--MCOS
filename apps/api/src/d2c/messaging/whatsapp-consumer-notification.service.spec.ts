import { ConsumerService } from '../consumer/consumer.service';
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
    const service = new WhatsAppConsumerNotificationService(provider, consumerService);
    return { service, provider, consumerService };
  }

  it('resolves the consumer and sends via sendText with the normalized phone', async () => {
    const { service, provider } = makeService();
    await service.notify('org-1', 'consumer-1', 'Your order is ready');
    expect(provider.sendText).toHaveBeenCalledWith(
      expect.objectContaining({ toPhoneNumber: '+2348012345678', text: 'Your order is ready' }),
    );
  });

  it('never throws when the consumer is unknown — logs and returns', async () => {
    const { service, consumerService, provider } = makeService();
    consumerService.getById.mockResolvedValue(null as never);
    await expect(service.notify('org-1', 'nonexistent', 'Hi')).resolves.toBeUndefined();
    expect(provider.sendText).not.toHaveBeenCalled();
  });

  it('never throws when the provider rejects the send', async () => {
    const { service, provider } = makeService();
    provider.sendText.mockResolvedValue({
      outcome: 'TERMINAL_FAILURE',
      errorCode: 'WHATSAPP_AUTH',
    });
    await expect(service.notify('org-1', 'consumer-1', 'Hi')).resolves.toBeUndefined();
  });

  it('never throws when the provider itself throws', async () => {
    const { service, provider } = makeService();
    provider.sendText.mockRejectedValue(new Error('network error'));
    await expect(service.notify('org-1', 'consumer-1', 'Hi')).resolves.toBeUndefined();
  });
});
