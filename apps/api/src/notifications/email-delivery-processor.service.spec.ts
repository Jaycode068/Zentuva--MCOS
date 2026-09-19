import { ConflictException, NotFoundException } from '@nestjs/common';
import { EmailDelivery } from '@prisma/client';

import { MAX_EMAIL_ATTEMPTS } from './email-delivery-processing.constants';
import { EmailDeliveryProcessorService } from './email-delivery-processor.service';
import { EmailDeliveryRepository } from './email-delivery.repository';
import { EmailProvider } from './ports/email-provider.port';

describe('EmailDeliveryProcessorService', () => {
  function makeDelivery(overrides: Partial<EmailDelivery> = {}): EmailDelivery {
    return {
      id: 'delivery-1',
      organisationId: 'org-1',
      notificationId: 'notif-1',
      recipientUserId: 'user-1',
      recipientEmail: 'grace@example.com',
      recipientDisplayName: 'Grace Effiong',
      fromEmail: 'noreply@zentuva.test',
      fromName: 'Zentuva',
      templateKey: 'WORKFLOW_APPROVAL_REQUIRED',
      category: 'WORKFLOW_APPROVALS',
      subject: 'Approval required',
      textBody: 'text body',
      htmlBody: '<p>html</p>',
      status: 'PROCESSING',
      attempts: 0,
      firstAttemptedAt: null,
      lastAttemptedAt: null,
      sentAt: null,
      nextRetryAt: null,
      leaseAt: new Date(),
      providerName: null,
      providerMessageId: null,
      lastErrorCategory: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      channel: 'EMAIL',
      ...overrides,
    } as EmailDelivery;
  }

  function makeService(claimed: EmailDelivery[] = []) {
    const repository = {
      claimBatch: jest.fn().mockResolvedValue(claimed),
      stampFirstAttempt: jest.fn().mockResolvedValue(undefined),
      markSent: jest.fn().mockResolvedValue(true),
      markFailed: jest.fn().mockResolvedValue(true),
      manualRetry: jest.fn().mockResolvedValue(true),
      findById: jest.fn().mockResolvedValue(claimed[0] ?? null),
      findManyByOrganisation: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    } as unknown as jest.Mocked<EmailDeliveryRepository>;

    const provider = { name: 'local', send: jest.fn() } as unknown as jest.Mocked<EmailProvider>;

    const service = new EmailDeliveryProcessorService(repository, provider);
    return { service, repository, provider };
  }

  it('sends an accepted message and marks the delivery SENT with the provider message id', async () => {
    const delivery = makeDelivery();
    const { service, repository, provider } = makeService([delivery]);
    provider.send.mockResolvedValue({ outcome: 'ACCEPTED', providerMessageId: 'msg-123' });

    const result = await service.processPendingDeliveries('org-1');

    expect(result).toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(repository.stampFirstAttempt).toHaveBeenCalledWith('delivery-1');
    expect(repository.markSent).toHaveBeenCalledWith('org-1', 'delivery-1', {
      providerName: 'local',
      providerMessageId: 'msg-123',
    });
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: 'grace@example.com',
        fromEmail: 'noreply@zentuva.test',
        correlationId: 'delivery-1',
      }),
    );
  });

  it('schedules a retry (not terminal) on the first retryable failure', async () => {
    const delivery = makeDelivery({ attempts: 0 });
    const { service, repository, provider } = makeService([delivery]);
    provider.send.mockResolvedValue({
      outcome: 'RETRYABLE_FAILURE',
      errorCategory: 'SMTP_CONNECTION',
      errorMessage: 'Connection refused',
    });

    const result = await service.processPendingDeliveries('org-1');

    expect(result).toEqual({ processed: 1, sent: 0, failed: 1 });
    expect(repository.markFailed).toHaveBeenCalledWith(
      'org-1',
      'delivery-1',
      expect.objectContaining({ terminal: false, errorCategory: 'SMTP_CONNECTION' }),
    );
    const call = repository.markFailed.mock.calls[0]![2];
    expect(call.nextRetryAt).toBeInstanceOf(Date);
  });

  it('marks a delivery FAILED immediately on a terminal provider outcome, regardless of attempt count', async () => {
    const delivery = makeDelivery({ attempts: 0 });
    const { service, repository, provider } = makeService([delivery]);
    provider.send.mockResolvedValue({
      outcome: 'TERMINAL_FAILURE',
      errorCategory: 'SMTP_AUTH',
      errorMessage: 'Auth failed',
    });

    await service.processPendingDeliveries('org-1');

    expect(repository.markFailed).toHaveBeenCalledWith(
      'org-1',
      'delivery-1',
      expect.objectContaining({ terminal: true, nextRetryAt: null }),
    );
  });

  it('marks a delivery FAILED (terminal) once MAX_EMAIL_ATTEMPTS is reached even for a retryable outcome', async () => {
    const delivery = makeDelivery({ attempts: MAX_EMAIL_ATTEMPTS - 1 });
    const { service, repository, provider } = makeService([delivery]);
    provider.send.mockResolvedValue({
      outcome: 'RETRYABLE_FAILURE',
      errorCategory: 'SMTP_TRANSIENT',
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
    provider.send
      .mockResolvedValueOnce({ outcome: 'ACCEPTED', providerMessageId: 'msg-1' })
      .mockResolvedValueOnce({ outcome: 'TERMINAL_FAILURE', errorCategory: 'SMTP_AUTH' });

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
