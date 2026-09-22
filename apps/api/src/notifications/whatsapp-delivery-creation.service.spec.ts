import { Notification } from '@prisma/client';

import { NotificationRepository } from './notification.repository';
import { WhatsAppDeliveryCreationService } from './whatsapp-delivery-creation.service';
import { WhatsAppDeliveryRepository } from './whatsapp-delivery.repository';
import { WhatsAppEligibilityService } from './whatsapp-eligibility.service';

describe('WhatsAppDeliveryCreationService', () => {
  function makeNotification(id: string, overrides: Partial<Notification> = {}): Notification {
    return {
      id,
      organisationId: 'org-1',
      recipientUserId: 'user-1',
      type: 'WORKFLOW_APPROVAL_REQUIRED',
      channel: 'IN_APP',
      title: 'Approval required',
      body: 'PO-000123 is awaiting your approval.',
      status: 'UNREAD',
      readAt: null,
      sourceEventId: 'event-1',
      sourceType: 'PURCHASE_ORDER',
      sourceId: 'po-1',
      actionUrl: '/settings/workflows/instances/instance-1',
      metadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as Notification;
  }

  function makeService() {
    const notificationRepository = {
      findPendingForWhatsAppEvaluation: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<NotificationRepository>;

    const eligibilityService = {
      evaluate: jest.fn(),
    } as unknown as jest.Mocked<WhatsAppEligibilityService>;

    const whatsappDeliveryRepository = {
      create: jest
        .fn()
        .mockImplementation((data) => Promise.resolve({ id: 'delivery-1', ...data })),
    } as unknown as jest.Mocked<WhatsAppDeliveryRepository>;

    const service = new WhatsAppDeliveryCreationService(
      notificationRepository,
      eligibilityService,
      whatsappDeliveryRepository,
    );
    return { service, notificationRepository, eligibilityService, whatsappDeliveryRepository };
  }

  it('creates a delivery record for an eligible notification, snapshotting phone/template', async () => {
    const { service, notificationRepository, eligibilityService, whatsappDeliveryRepository } =
      makeService();
    notificationRepository.findPendingForWhatsAppEvaluation.mockResolvedValue([
      makeNotification('n1'),
    ]);
    eligibilityService.evaluate.mockResolvedValue({
      eligible: true,
      recipientPhone: '+2348012345678',
      recipientDisplayName: 'Grace Effiong',
      template: {
        name: 'zentuva_approval_required',
        language: 'en_US',
        parameters: { recipientName: 'Grace Effiong', documentNumber: 'PO-000123' },
      },
    });

    const result = await service.createPendingDeliveries('org-1');

    expect(result).toEqual({ evaluated: 1, created: 1, ineligible: 0 });
    expect(whatsappDeliveryRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: 'org-1',
        notificationId: 'n1',
        recipientPhoneSnapshot: '+2348012345678',
        recipientDisplayNameSnapshot: 'Grace Effiong',
        templateName: 'zentuva_approval_required',
        templateLanguage: 'en_US',
        templateParameterSnapshot: { recipientName: 'Grace Effiong', documentNumber: 'PO-000123' },
        category: 'WORKFLOW_APPROVALS',
      }),
    );
  });

  it('skips creation for an ineligible notification', async () => {
    const { service, notificationRepository, eligibilityService, whatsappDeliveryRepository } =
      makeService();
    notificationRepository.findPendingForWhatsAppEvaluation.mockResolvedValue([
      makeNotification('n1'),
    ]);
    eligibilityService.evaluate.mockResolvedValue({ eligible: false, reason: 'not eligible' });

    const result = await service.createPendingDeliveries('org-1');

    expect(result).toEqual({ evaluated: 1, created: 0, ineligible: 1 });
    expect(whatsappDeliveryRepository.create).not.toHaveBeenCalled();
  });

  it('does not count a delivery towards "created" when the repository reports a duplicate (idempotency)', async () => {
    const { service, notificationRepository, eligibilityService, whatsappDeliveryRepository } =
      makeService();
    notificationRepository.findPendingForWhatsAppEvaluation.mockResolvedValue([
      makeNotification('n1'),
    ]);
    eligibilityService.evaluate.mockResolvedValue({
      eligible: true,
      recipientPhone: '+2348012345678',
      template: { name: 'zentuva_approval_required', language: 'en_US', parameters: {} },
    });
    whatsappDeliveryRepository.create.mockResolvedValue(null); // P2002 -> null convention

    const result = await service.createPendingDeliveries('org-1');
    expect(result.created).toBe(0);
  });

  it('processes each candidate notification independently — one eligible, one ineligible', async () => {
    const { service, notificationRepository, eligibilityService } = makeService();
    notificationRepository.findPendingForWhatsAppEvaluation.mockResolvedValue([
      makeNotification('n1'),
      makeNotification('n2'),
    ]);
    eligibilityService.evaluate
      .mockResolvedValueOnce({
        eligible: true,
        recipientPhone: '+2348012345678',
        template: { name: 'zentuva_approval_required', language: 'en_US', parameters: {} },
      })
      .mockResolvedValueOnce({ eligible: false, reason: 'org disabled' });

    const result = await service.createPendingDeliveries('org-1');
    expect(result).toEqual({ evaluated: 2, created: 1, ineligible: 1 });
  });
});
