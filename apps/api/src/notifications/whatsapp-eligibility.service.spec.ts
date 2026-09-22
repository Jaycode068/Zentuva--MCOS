import { ConfigService } from '@nestjs/config';
import { Notification } from '@prisma/client';

import { OrganisationService } from '../identity/organisation/organisation.service';
import { UserService } from '../identity/user/user.service';
import { NotificationPreferenceService } from './notification-preference.service';
import { WhatsAppEligibilityService } from './whatsapp-eligibility.service';

describe('WhatsAppEligibilityService', () => {
  function makeNotification(overrides: Partial<Notification> = {}): Notification {
    return {
      id: 'notif-1',
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

  function makeService(
    opts: {
      orgSettings?: Record<string, unknown>;
      orgCountry?: string;
      userStatus?: string;
      userPhone?: string | null;
      whatsappEnabled?: boolean;
    } = {},
  ) {
    const organisationService = {
      getById: jest.fn().mockResolvedValue({
        id: 'org-1',
        name: 'Boby Bites',
        country: opts.orgCountry ?? 'Nigeria',
        settings: opts.orgSettings ?? { whatsapp: { enabled: true } },
      }),
    } as unknown as jest.Mocked<OrganisationService>;

    const userService = {
      getById: jest.fn().mockResolvedValue({
        id: 'user-1',
        status: opts.userStatus ?? 'ACTIVE',
        phoneNumber: opts.userPhone === undefined ? '08012345678' : opts.userPhone,
        firstName: 'Grace',
        lastName: 'Effiong',
      }),
    } as unknown as jest.Mocked<UserService>;

    const preferenceService = {
      isWhatsAppEnabled: jest.fn().mockResolvedValue(opts.whatsappEnabled ?? true),
    } as unknown as jest.Mocked<NotificationPreferenceService>;

    const config = {
      get: jest.fn((key: string) => {
        if (key === 'whatsapp.approvalTemplateName') return 'zentuva_approval_required';
        if (key === 'whatsapp.approvalTemplateLanguage') return 'en_US';
        if (key === 'email.webPublicUrl') return 'http://localhost:3000';
        return undefined;
      }),
    } as unknown as ConfigService;

    const service = new WhatsAppEligibilityService(
      organisationService,
      userService,
      preferenceService,
      config,
      [],
    );
    return { service, organisationService, userService, preferenceService, config };
  }

  it('is eligible when every condition is satisfied, with correctly rendered template parameters', async () => {
    const { service } = makeService();
    const result = await service.evaluate('org-1', makeNotification());
    expect(result.eligible).toBe(true);
    expect(result.recipientPhone).toBe('+2348012345678');
    expect(result.recipientDisplayName).toBe('Grace Effiong');
    expect(result.template?.name).toBe('zentuva_approval_required');
    expect(result.template?.language).toBe('en_US');
    expect(result.template?.parameters.recipientName).toBe('Grace Effiong');
    expect(result.template?.parameters.documentType).toBe('Purchase Order');
    // No WORKFLOW_SUBJECT_HANDLERS injected in this test — describeSubject
    // falls back to its own documented "#<last 8 chars of subjectId>" shape.
    expect(result.template?.parameters.documentNumber).toBe('#po-1');
    expect(result.template?.parameters.approvalUrl).toBe(
      'http://localhost:3000/settings/workflows/instances/instance-1',
    );
  });

  it('excludes a notification type outside the WhatsApp-eligible category list (only APPROVAL_REQUIRED this sprint)', async () => {
    const { service } = makeService();
    const result = await service.evaluate(
      'org-1',
      makeNotification({ type: 'WORKFLOW_STEP_APPROVED' }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/No WhatsApp template/);
  });

  it('is ineligible when the recipient user cannot be found', async () => {
    const { service, userService } = makeService();
    userService.getById.mockResolvedValue(null);
    const result = await service.evaluate('org-1', makeNotification());
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/not found/);
  });

  it('is ineligible when the recipient is suspended/inactive', async () => {
    const { service } = makeService({ userStatus: 'INACTIVE' });
    const result = await service.evaluate('org-1', makeNotification());
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/INACTIVE/);
  });

  it('is ineligible when the recipient has no phone number', async () => {
    const { service } = makeService({ userPhone: null });
    const result = await service.evaluate('org-1', makeNotification());
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/No phone number/);
  });

  it('is ineligible when the phone number cannot be normalized (non-Nigeria org, local format)', async () => {
    const { service } = makeService({ orgCountry: 'United States', userPhone: '08012345678' });
    const result = await service.evaluate('org-1', makeNotification());
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/without a recognized organisation country/);
  });

  it('is ineligible when the recipient has not enabled WhatsApp for this category', async () => {
    const { service } = makeService({ whatsappEnabled: false });
    const result = await service.evaluate('org-1', makeNotification());
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/has not enabled WhatsApp/);
  });

  it('is ineligible when the organisation has WhatsApp delivery disabled', async () => {
    const { service } = makeService({ orgSettings: { whatsapp: { enabled: false } } });
    const result = await service.evaluate('org-1', makeNotification());
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/disabled for this organisation/);
  });

  it('is ineligible when the organisation cannot be found', async () => {
    const { service, organisationService } = makeService();
    organisationService.getById.mockResolvedValue(null);
    const result = await service.evaluate('org-1', makeNotification());
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/Organisation not found/);
  });

  it('normalizes an already-international phone number regardless of organisation country', async () => {
    const { service } = makeService({ orgCountry: 'United States', userPhone: '+14155552671' });
    const result = await service.evaluate('org-1', makeNotification());
    expect(result.eligible).toBe(true);
    expect(result.recipientPhone).toBe('+14155552671');
  });
});
