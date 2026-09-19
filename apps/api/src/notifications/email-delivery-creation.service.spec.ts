import { Notification } from '@prisma/client';

import { EmailDeliveryCreationService } from './email-delivery-creation.service';
import { EmailDeliveryRepository } from './email-delivery.repository';
import { EmailEligibilityService } from './email-eligibility.service';
import { EmailTemplateRenderer } from './email-template-renderer';
import { NotificationRepository } from './notification.repository';

describe('EmailDeliveryCreationService', () => {
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
      findPendingForEmailEvaluation: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<NotificationRepository>;

    const eligibilityService = {
      evaluate: jest.fn(),
    } as unknown as jest.Mocked<EmailEligibilityService>;

    const templateRenderer = {
      render: jest
        .fn()
        .mockReturnValue({ subject: 'Approval required', text: 'text body', html: '<p>html</p>' }),
    } as unknown as jest.Mocked<EmailTemplateRenderer>;

    const emailDeliveryRepository = {
      create: jest
        .fn()
        .mockImplementation((data) => Promise.resolve({ id: 'delivery-1', ...data })),
    } as unknown as jest.Mocked<EmailDeliveryRepository>;

    const service = new EmailDeliveryCreationService(
      notificationRepository,
      eligibilityService,
      templateRenderer,
      emailDeliveryRepository,
    );
    return {
      service,
      notificationRepository,
      eligibilityService,
      templateRenderer,
      emailDeliveryRepository,
    };
  }

  it('creates a delivery record for an eligible notification, rendering the template and snapshotting sender/recipient', async () => {
    const { service, notificationRepository, eligibilityService, emailDeliveryRepository } =
      makeService();
    notificationRepository.findPendingForEmailEvaluation.mockResolvedValue([
      makeNotification('n1'),
    ]);
    eligibilityService.evaluate.mockResolvedValue({
      eligible: true,
      recipientEmail: 'grace@example.com',
      recipientDisplayName: 'Grace Effiong',
      organisationName: 'Boby Bites',
      fromEmail: 'noreply@zentuva.test',
      fromName: 'Zentuva',
    });

    const result = await service.createPendingDeliveries('org-1');

    expect(result).toEqual({ evaluated: 1, created: 1, ineligible: 0 });
    expect(emailDeliveryRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        organisationId: 'org-1',
        notificationId: 'n1',
        recipientEmail: 'grace@example.com',
        fromEmail: 'noreply@zentuva.test',
        fromName: 'Zentuva',
        templateKey: 'WORKFLOW_APPROVAL_REQUIRED',
        category: 'WORKFLOW_APPROVALS',
        subject: 'Approval required',
      }),
    );
  });

  it('skips creation for an ineligible notification without calling the template renderer', async () => {
    const {
      service,
      notificationRepository,
      eligibilityService,
      templateRenderer,
      emailDeliveryRepository,
    } = makeService();
    notificationRepository.findPendingForEmailEvaluation.mockResolvedValue([
      makeNotification('n1'),
    ]);
    eligibilityService.evaluate.mockResolvedValue({ eligible: false, reason: 'not eligible' });

    const result = await service.createPendingDeliveries('org-1');

    expect(result).toEqual({ evaluated: 1, created: 0, ineligible: 1 });
    expect(templateRenderer.render).not.toHaveBeenCalled();
    expect(emailDeliveryRepository.create).not.toHaveBeenCalled();
  });

  it('does not count a delivery towards "created" when the repository reports a duplicate (idempotency)', async () => {
    const { service, notificationRepository, eligibilityService, emailDeliveryRepository } =
      makeService();
    notificationRepository.findPendingForEmailEvaluation.mockResolvedValue([
      makeNotification('n1'),
    ]);
    eligibilityService.evaluate.mockResolvedValue({
      eligible: true,
      recipientEmail: 'grace@example.com',
      organisationName: 'Boby Bites',
      fromEmail: 'noreply@zentuva.test',
      fromName: 'Zentuva',
    });
    emailDeliveryRepository.create.mockResolvedValue(null); // repository's own P2002 -> null convention

    const result = await service.createPendingDeliveries('org-1');

    expect(result.created).toBe(0);
  });

  it('processes each candidate notification independently — one eligible, one ineligible', async () => {
    const { service, notificationRepository, eligibilityService } = makeService();
    notificationRepository.findPendingForEmailEvaluation.mockResolvedValue([
      makeNotification('n1'),
      makeNotification('n2'),
    ]);
    eligibilityService.evaluate
      .mockResolvedValueOnce({
        eligible: true,
        recipientEmail: 'grace@example.com',
        organisationName: 'Boby Bites',
        fromEmail: 'noreply@zentuva.test',
        fromName: 'Zentuva',
      })
      .mockResolvedValueOnce({ eligible: false, reason: 'org disabled' });

    const result = await service.createPendingDeliveries('org-1');
    expect(result).toEqual({ evaluated: 2, created: 1, ineligible: 1 });
  });
});
