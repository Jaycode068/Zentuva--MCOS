import { ConflictException, NotFoundException } from '@nestjs/common';
import { WhatsAppDelivery } from '@prisma/client';

import { MAX_WHATSAPP_ATTEMPTS } from './whatsapp-delivery-processing.constants';
import { WhatsAppDeliveryProcessorService } from './whatsapp-delivery-processor.service';
import { WhatsAppDeliveryRepository } from './whatsapp-delivery.repository';
import { WhatsAppProvider } from './ports/whatsapp-provider.port';

describe('WhatsAppDeliveryProcessorService', () => {
  function makeDelivery(overrides: Partial<WhatsAppDelivery> = {}): WhatsAppDelivery {
    return {
      id: 'delivery-1',
      organisationId: 'org-1',
      notificationId: 'notif-1',
      recipientUserId: 'user-1',
      recipientPhoneSnapshot: '+2348012345678',
      recipientDisplayNameSnapshot: 'Grace Effiong',
      templateName: 'zentuva_approval_required',
      templateLanguage: 'en_US',
      templateParameterSnapshot: { recipientName: 'Grace Effiong' },
      category: 'WORKFLOW_APPROVALS',
      status: 'PROCESSING',
      attempts: 0,
      processingStartedAt: new Date(),
      processedAt: null,
      nextRetryAt: null,
      providerName: null,
      providerMessageId: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      channel: 'WHATSAPP',
      ...overrides,
    } as WhatsAppDelivery;
  }

  function makeService(claimed: WhatsAppDelivery[] = []) {
    const repository = {
      claimBatch: jest.fn().mockResolvedValue(claimed),
      markSent: jest.fn().mockResolvedValue(true),
      markFailed: jest.fn().mockResolvedValue(true),
      manualRetry: jest.fn().mockResolvedValue(true),
      findById: jest.fn().mockResolvedValue(claimed[0] ?? null),
      findManyByOrganisation: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<WhatsAppDeliveryRepository>;

    const provider = {
      name: 'local',
      sendTemplate: jest.fn(),
    } as unknown as jest.Mocked<WhatsAppProvider>;

    const service = new WhatsAppDeliveryProcessorService(repository, provider);
    return { service, repository, provider };
  }

  it('sends an accepted message and marks the delivery SENT with the provider message id', async () => {
    const delivery = makeDelivery();
    const { service, repository, provider } = makeService([delivery]);
    provider.sendTemplate.mockResolvedValue({
      outcome: 'ACCEPTED',
      providerMessageId: 'wamid.123',
    });

    const result = await service.processPendingDeliveries('org-1');

    expect(result).toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(repository.markSent).toHaveBeenCalledWith('org-1', 'delivery-1', {
      providerName: 'local',
      providerMessageId: 'wamid.123',
    });
    expect(provider.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        toPhoneNumber: '+2348012345678',
        templateName: 'zentuva_approval_required',
        correlationId: 'delivery-1',
      }),
    );
  });

  it('schedules a retry (not terminal) on the first retryable failure', async () => {
    const delivery = makeDelivery({ attempts: 0 });
    const { service, repository, provider } = makeService([delivery]);
    provider.sendTemplate.mockResolvedValue({
      outcome: 'RETRYABLE_FAILURE',
      errorCode: 'WHATSAPP_RATE_LIMITED',
      errorMessage: 'Rate limited',
    });

    const result = await service.processPendingDeliveries('org-1');

    expect(result).toEqual({ processed: 1, sent: 0, failed: 1 });
    expect(repository.markFailed).toHaveBeenCalledWith(
      'org-1',
      'delivery-1',
      expect.objectContaining({ terminal: false, errorCode: 'WHATSAPP_RATE_LIMITED' }),
    );
    const call = repository.markFailed.mock.calls[0]![2];
    expect(call.nextRetryAt).toBeInstanceOf(Date);
  });

  it('marks a delivery FAILED immediately on a terminal provider outcome, regardless of attempt count', async () => {
    const delivery = makeDelivery({ attempts: 0 });
    const { service, repository, provider } = makeService([delivery]);
    provider.sendTemplate.mockResolvedValue({
      outcome: 'TERMINAL_FAILURE',
      errorCode: 'WHATSAPP_AUTH',
      errorMessage: 'Auth failed',
    });

    await service.processPendingDeliveries('org-1');

    expect(repository.markFailed).toHaveBeenCalledWith(
      'org-1',
      'delivery-1',
      expect.objectContaining({ terminal: true, nextRetryAt: null }),
    );
  });

  it('marks a delivery FAILED (terminal) once MAX_WHATSAPP_ATTEMPTS is reached even for a retryable outcome', async () => {
    const delivery = makeDelivery({ attempts: MAX_WHATSAPP_ATTEMPTS - 1 });
    const { service, repository, provider } = makeService([delivery]);
    provider.sendTemplate.mockResolvedValue({
      outcome: 'RETRYABLE_FAILURE',
      errorCode: 'WHATSAPP_SERVER_ERROR',
    });

    await service.processPendingDeliveries('org-1');

    expect(repository.markFailed).toHaveBeenCalledWith(
      'org-1',
      'delivery-1',
      expect.objectContaining({ terminal: true }),
    );
  });

  it('processes multiple claimed deliveries independently — one success, one failure', async () => {
    const d1 = makeDelivery({ id: 'delivery-1' });
    const d2 = makeDelivery({ id: 'delivery-2' });
    const { service, provider } = makeService([d1, d2]);
    provider.sendTemplate
      .mockResolvedValueOnce({ outcome: 'ACCEPTED', providerMessageId: 'wamid.1' })
      .mockResolvedValueOnce({ outcome: 'TERMINAL_FAILURE', errorCode: 'WHATSAPP_AUTH' });

    const result = await service.processPendingDeliveries('org-1');
    expect(result).toEqual({ processed: 2, sent: 1, failed: 1 });
  });

  it('processes zero deliveries safely when nothing is claimable', async () => {
    const { service } = makeService([]);
    const result = await service.processPendingDeliveries('org-1');
    expect(result).toEqual({ processed: 0, sent: 0, failed: 0 });
  });

  describe('manual retry', () => {
    it('delegates to the repository and returns the refreshed row on success', async () => {
      const delivery = makeDelivery({ status: 'FAILED' });
      const { service, repository } = makeService([delivery]);
      repository.findById.mockResolvedValue(delivery);

      const result = await service.retryDelivery('org-1', 'delivery-1');
      expect(repository.manualRetry).toHaveBeenCalledWith('org-1', 'delivery-1');
      expect(result).toEqual(delivery);
    });

    it('throws ConflictException when the delivery is not eligible for retry', async () => {
      const { service, repository } = makeService([]);
      repository.manualRetry.mockResolvedValue(false);
      await expect(service.retryDelivery('org-1', 'delivery-1')).rejects.toThrow(ConflictException);
    });
  });

  describe('getById', () => {
    it('throws NotFoundException for a missing or cross-tenant delivery', async () => {
      const { service, repository } = makeService([]);
      repository.findById.mockResolvedValue(null);
      await expect(service.getById('org-1', 'nope')).rejects.toThrow(NotFoundException);
    });
  });
});
