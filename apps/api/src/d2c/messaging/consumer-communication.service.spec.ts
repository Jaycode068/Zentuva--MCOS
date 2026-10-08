import { ConflictException, ForbiddenException } from '@nestjs/common';

import { AuditService } from '../../identity/audit/audit.service';
import { EffectiveAccessResolver } from '../../identity/authorization/effective-access-resolver';
import { WhatsAppProvider } from '../../notifications/ports/whatsapp-provider.port';
import { ConsumerCommunicationService } from './consumer-communication.service';
import { ConsumerWhatsAppDeliveryRepository } from './consumer-whatsapp-delivery.repository';
import { WhatsAppConsumerNotificationService } from './whatsapp-consumer-notification.service';

describe('ConsumerCommunicationService', () => {
  const orgId = 'org-1';

  function makeService(grants: Set<string> = new Set(['d2c.communication.manage'])) {
    const repository = {
      findManyByConsumer: jest.fn(),
      findManyByOrder: jest.fn(),
      claimForRetry: jest.fn(),
    } as unknown as jest.Mocked<ConsumerWhatsAppDeliveryRepository>;
    const provider = {
      name: 'local',
      sendText: jest.fn(),
    } as unknown as jest.Mocked<WhatsAppProvider>;
    const notificationService = {
      attemptSend: jest.fn(),
    } as unknown as jest.Mocked<WhatsAppConsumerNotificationService>;
    const effectiveAccessResolver = {
      resolve: jest.fn().mockResolvedValue({ isOwnerBypass: false, grants }),
    } as unknown as jest.Mocked<EffectiveAccessResolver>;
    const auditService = {
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditService>;

    const service = new ConsumerCommunicationService(
      repository,
      provider,
      notificationService,
      effectiveAccessResolver,
      auditService,
    );
    return {
      service,
      repository,
      provider,
      notificationService,
      effectiveAccessResolver,
      auditService,
    };
  }

  describe('retry', () => {
    const claimed = {
      id: 'delivery-1',
      organisationId: orgId,
      consumerId: 'consumer-1',
      salesOrderId: 'order-1',
      kind: 'COLLECTION_READY',
      recipientPhoneSnapshot: '+2348012345678',
      messageSnapshot: 'Your order is ready',
      status: 'PROCESSING',
    };

    it('claims the delivery and resends the EXACT snapshotted phone/message, never re-deriving them', async () => {
      const { service, repository, notificationService } = makeService();
      repository.claimForRetry.mockResolvedValue(claimed as never);
      notificationService.attemptSend.mockResolvedValue({ ...claimed, status: 'SENT' } as never);

      await service.retry(orgId, 'actor-1', 'delivery-1');

      expect(repository.claimForRetry).toHaveBeenCalledWith(orgId, 'delivery-1');
      expect(notificationService.attemptSend).toHaveBeenCalledWith(
        orgId,
        claimed,
        '+2348012345678',
        'Your order is ready',
        false,
      );
    });

    it('audits the retry action', async () => {
      const { service, repository, notificationService, auditService } = makeService();
      repository.claimForRetry.mockResolvedValue(claimed as never);
      notificationService.attemptSend.mockResolvedValue({ ...claimed, status: 'SENT' } as never);

      await service.retry(orgId, 'actor-1', 'delivery-1');

      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'consumer_whatsapp_delivery.retried',
          entityType: 'ConsumerWhatsAppDelivery',
          entityId: 'delivery-1',
          organisationId: orgId,
          actorUserId: 'actor-1',
        }),
      );
    });

    it('rejects with Conflict when the delivery is not eligible for retry (claim returns null) — never sends', async () => {
      const { service, repository, notificationService } = makeService();
      repository.claimForRetry.mockResolvedValue(null);

      await expect(service.retry(orgId, 'actor-1', 'delivery-1')).rejects.toThrow(
        ConflictException,
      );
      expect(notificationService.attemptSend).not.toHaveBeenCalled();
    });

    it('rejects a caller without d2c.communication.manage — never claims or sends', async () => {
      const { service, repository, notificationService } = makeService(new Set());

      await expect(service.retry(orgId, 'actor-1', 'delivery-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(repository.claimForRetry).not.toHaveBeenCalled();
      expect(notificationService.attemptSend).not.toHaveBeenCalled();
    });

    it('a view-only grant is not sufficient to retry', async () => {
      const { service } = makeService(new Set(['d2c.communication.view']));
      await expect(service.retry(orgId, 'actor-1', 'delivery-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('listForConsumer / listForOrder', () => {
    it('a view-only grant is sufficient to list', async () => {
      const { service, repository } = makeService(new Set(['d2c.communication.view']));
      repository.findManyByConsumer.mockResolvedValue({ items: [], total: 0 });
      await expect(
        service.listForConsumer(orgId, 'actor-1', 'consumer-1', { page: 1, pageSize: 20 }),
      ).resolves.toEqual({ items: [], total: 0 });
    });

    it('rejects a caller with neither view nor manage', async () => {
      const { service } = makeService(new Set());
      await expect(
        service.listForConsumer(orgId, 'actor-1', 'consumer-1', { page: 1, pageSize: 20 }),
      ).rejects.toThrow(ForbiddenException);
      await expect(service.listForOrder(orgId, 'actor-1', 'order-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
