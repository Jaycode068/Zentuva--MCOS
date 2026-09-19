import { ConfigService } from '@nestjs/config';
import { Notification } from '@prisma/client';

import { OrganisationService } from '../identity/organisation/organisation.service';
import { UserService } from '../identity/user/user.service';
import { EmailEligibilityService } from './email-eligibility.service';
import { NotificationPreferenceService } from './notification-preference.service';

describe('EmailEligibilityService', () => {
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
      userStatus?: string;
      userEmail?: string | null;
      emailEnabled?: boolean;
      /** `null` means "explicitly absent" (config.get returns undefined);
       *  `undefined` means "use the default test value." */
      envFromEmail?: string | null;
      envFromName?: string | null;
    } = {},
  ) {
    const organisationService = {
      getById: jest.fn().mockResolvedValue({
        id: 'org-1',
        name: 'Boby Bites',
        displayName: null,
        settings: opts.orgSettings ?? {
          emailDelivery: { enabled: true, senderName: null, senderEmail: null },
        },
      }),
    } as unknown as jest.Mocked<OrganisationService>;

    const userService = {
      getById: jest.fn().mockResolvedValue({
        id: 'user-1',
        status: opts.userStatus ?? 'ACTIVE',
        email: opts.userEmail === undefined ? 'grace@example.com' : opts.userEmail,
        firstName: 'Grace',
        lastName: 'Effiong',
      }),
    } as unknown as jest.Mocked<UserService>;

    const preferenceService = {
      isEmailEnabled: jest.fn().mockResolvedValue(opts.emailEnabled ?? true),
    } as unknown as jest.Mocked<NotificationPreferenceService>;

    const config = {
      get: jest.fn((key: string) => {
        if (key === 'email.fromEmail') {
          return opts.envFromEmail === null
            ? undefined
            : (opts.envFromEmail ?? 'noreply@zentuva.test');
        }
        if (key === 'email.fromName') {
          return opts.envFromName === null ? undefined : (opts.envFromName ?? 'Zentuva');
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    const service = new EmailEligibilityService(
      organisationService,
      userService,
      preferenceService,
      config,
    );
    return { service, organisationService, userService, preferenceService, config };
  }

  it('is eligible when every condition is satisfied', async () => {
    const { service } = makeService();
    const result = await service.evaluate('org-1', makeNotification());
    expect(result.eligible).toBe(true);
    expect(result.recipientEmail).toBe('grace@example.com');
    expect(result.fromEmail).toBe('noreply@zentuva.test');
    expect(result.fromName).toBe('Zentuva');
  });

  it('excludes a notification type outside the email-eligible category list', async () => {
    const { service } = makeService();
    const result = await service.evaluate(
      'org-1',
      makeNotification({ type: 'WORKFLOW_STEP_APPROVED' }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/not an email-eligible category/);
  });

  it('excludes WORKFLOW_CANCELLED — documented as intentionally out of the initial email scope', async () => {
    const { service } = makeService();
    const result = await service.evaluate(
      'org-1',
      makeNotification({ type: 'WORKFLOW_CANCELLED' }),
    );
    expect(result.eligible).toBe(false);
  });

  it('is ineligible when the organisation has transactional email disabled', async () => {
    const { service } = makeService({
      orgSettings: { emailDelivery: { enabled: false, senderName: null, senderEmail: null } },
    });
    const result = await service.evaluate('org-1', makeNotification());
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/disabled for this organisation/);
  });

  it('is ineligible when the recipient has not enabled email for this category', async () => {
    const { service } = makeService({ emailEnabled: false });
    const result = await service.evaluate('org-1', makeNotification());
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/has not enabled email/);
  });

  it('is ineligible when the recipient is suspended', async () => {
    const { service } = makeService({ userStatus: 'SUSPENDED' });
    const result = await service.evaluate('org-1', makeNotification());
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/SUSPENDED/);
  });

  it('is ineligible when the recipient has no email address on file', async () => {
    const { service } = makeService({ userEmail: '' });
    const result = await service.evaluate('org-1', makeNotification());
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/no email address/);
  });

  it('is ineligible when the recipient user cannot be found (e.g. deleted)', async () => {
    const { service, userService } = makeService();
    userService.getById.mockResolvedValue(null);
    const result = await service.evaluate('org-1', makeNotification());
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/not found/);
  });

  it('prefers the organisation sender email/name over the environment default when configured', async () => {
    const { service } = makeService({
      orgSettings: {
        emailDelivery: {
          enabled: true,
          senderName: 'Boby Bites Alerts',
          senderEmail: 'alerts@bobybites.test',
        },
      },
    });
    const result = await service.evaluate('org-1', makeNotification());
    expect(result.fromEmail).toBe('alerts@bobybites.test');
    expect(result.fromName).toBe('Boby Bites Alerts');
  });

  it('is ineligible when neither an organisation sender nor an environment default is configured', async () => {
    const { service } = makeService({ envFromEmail: null, envFromName: null });
    const result = await service.evaluate('org-1', makeNotification());
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/No sender email\/name configured/);
  });

  it('is ineligible when the organisation cannot be found', async () => {
    const { service, organisationService } = makeService();
    organisationService.getById.mockResolvedValue(null);
    const result = await service.evaluate('org-1', makeNotification());
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/Organisation not found/);
  });
});
