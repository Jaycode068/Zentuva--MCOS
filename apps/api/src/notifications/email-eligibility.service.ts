import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Notification, NotificationType } from '@prisma/client';

import { OrganisationService } from '../identity/organisation/organisation.service';
import { mergeWorkspaceSettings } from '../identity/organisation/workspace-settings';
import { UserService } from '../identity/user/user.service';
import { categoryForType } from './notification-category';
import { NotificationPreferenceService } from './notification-preference.service';

export interface EmailEligibilityResult {
  eligible: boolean;
  reason?: string;
  recipientEmail?: string;
  recipientDisplayName?: string;
  organisationName?: string;
  /** Sprint 28 §Workstream H.1 — the organisation's own `senderEmail`/
   *  `senderName` if configured, else the environment's `MAIL_FROM_EMAIL`/
   *  `MAIL_FROM_NAME` default. Only present when `eligible` is `true` — this is
   *  what `EmailDeliveryCreationService` snapshots onto `EmailDelivery.fromEmail`/
   *  `fromName`. */
  fromEmail?: string;
  fromName?: string;
}

/**
 * Sprint 28 §Workstream B "Email Eligibility and Preference Contract"
 * (docs/architecture/email-delivery.md). The single place that answers "should
 * this ALREADY-CREATED `Notification` also become an email" — deliberately
 * separate from `NotificationRecipientResolver` (Sprint 27, which answers "who is
 * eligible to receive the in-app notification at all," reading Workflow's own
 * eligibility rules). This service never touches Workflow/`WorkflowEvent` — its
 * only input is a `Notification` row that already exists.
 *
 * Only the categories in {@link EMAIL_ELIGIBLE_TYPES} are ever eligible — Sprint
 * 28 §5.1's own suggested initial scope, deliberately narrower than all 8
 * `NotificationType`s: `WORKFLOW_STEP_APPROVED` (a mid-chain "moving to the next
 * step" FYI, almost always followed within the same request by either another
 * `WORKFLOW_APPROVAL_REQUIRED` for someone else or the final `WORKFLOW_APPROVED`
 * for the requester) and `WORKFLOW_CANCELLED` (a self-initiated/administrative
 * action) are excluded — emailing every intermediate step would be noise, not
 * signal. Documented, not an oversight.
 */
const EMAIL_ELIGIBLE_TYPES: ReadonlySet<NotificationType> = new Set([
  'WORKFLOW_APPROVAL_REQUIRED',
  'WORKFLOW_APPROVED',
  'WORKFLOW_STEP_REJECTED',
  'WORKFLOW_RETURNED',
  'WORKFLOW_RESUBMITTED',
  'WORKFLOW_EXPIRED',
]);

@Injectable()
export class EmailEligibilityService {
  constructor(
    private readonly organisationService: OrganisationService,
    private readonly userService: UserService,
    private readonly preferenceService: NotificationPreferenceService,
    private readonly config: ConfigService,
  ) {}

  async evaluate(
    organisationId: string,
    notification: Notification,
  ): Promise<EmailEligibilityResult> {
    if (!EMAIL_ELIGIBLE_TYPES.has(notification.type)) {
      return {
        eligible: false,
        reason: `"${notification.type}" is not an email-eligible category`,
      };
    }

    const organisation = await this.organisationService.getById(organisationId);
    if (!organisation) {
      return { eligible: false, reason: 'Organisation not found' };
    }
    const settings = mergeWorkspaceSettings(organisation.settings);
    if (!settings.emailDelivery.enabled) {
      return { eligible: false, reason: 'Transactional email is disabled for this organisation' };
    }

    const category = categoryForType(notification.type);
    const emailEnabled = await this.preferenceService.isEmailEnabled(
      organisationId,
      notification.recipientUserId,
      category,
    );
    if (!emailEnabled) {
      return { eligible: false, reason: 'Recipient has not enabled email for this category' };
    }

    const user = await this.userService.getById(organisationId, notification.recipientUserId);
    if (!user) {
      return { eligible: false, reason: 'Recipient user not found' };
    }
    if (user.status !== 'ACTIVE') {
      return { eligible: false, reason: `Recipient status is ${user.status}, not ACTIVE` };
    }
    if (!user.email || !user.email.trim()) {
      return { eligible: false, reason: 'Recipient has no email address on file' };
    }

    const fromEmail =
      settings.emailDelivery.senderEmail || this.config.get<string>('email.fromEmail');
    const fromName = settings.emailDelivery.senderName || this.config.get<string>('email.fromName');
    if (!fromEmail || !fromName) {
      return {
        eligible: false,
        reason:
          'No sender email/name configured (set organisation email settings or MAIL_FROM_EMAIL/MAIL_FROM_NAME)',
      };
    }

    return {
      eligible: true,
      recipientEmail: user.email,
      recipientDisplayName: `${user.firstName} ${user.lastName}`.trim(),
      organisationName: organisation.displayName || organisation.name,
      fromEmail,
      fromName,
    };
  }
}
