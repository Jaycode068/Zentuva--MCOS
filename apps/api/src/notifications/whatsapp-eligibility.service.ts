import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Notification } from '@prisma/client';

import { OrganisationService } from '../identity/organisation/organisation.service';
import { mergeWorkspaceSettings } from '../identity/organisation/workspace-settings';
import { UserService } from '../identity/user/user.service';
import {
  WORKFLOW_SUBJECT_HANDLERS,
  WorkflowSubjectHandler,
} from '../workflow/workflow-subject-handler';
import { categoryForType } from './notification-category';
import { NotificationPreferenceService } from './notification-preference.service';
import { normalizePhoneNumber } from './phone-number-normalizer';
import { describeSubject, humanizeSubjectType } from './subject-label.util';
import { resolveWhatsAppTemplate, ResolvedWhatsAppTemplate } from './whatsapp-template';

export interface WhatsAppEligibilityResult {
  eligible: boolean;
  reason?: string;
  recipientPhone?: string;
  recipientDisplayName?: string;
  template?: ResolvedWhatsAppTemplate;
}

/**
 * Sprint 29 §11 "Recipient Eligibility." The single place that answers
 * "should this already-created `Notification` also become a WhatsApp
 * message" — mirrors `EmailEligibilityService` (Sprint 28) exactly in shape
 * and check ORDER, adding only what WhatsApp genuinely needs beyond email
 * (phone normalization, template resolution instead of a free-text render).
 * Never touches `WorkflowEvent`/`WorkflowInstanceService` — its only input
 * is a `Notification` row that already exists.
 *
 * Only `WORKFLOW_APPROVAL_REQUIRED` is ever eligible this sprint
 * (`whatsapp-template.ts`'s own narrow registry) — brief §15's explicit
 * scope limit.
 */
@Injectable()
export class WhatsAppEligibilityService {
  private readonly handlersByType: Map<string, WorkflowSubjectHandler>;

  constructor(
    private readonly organisationService: OrganisationService,
    private readonly userService: UserService,
    private readonly preferenceService: NotificationPreferenceService,
    private readonly config: ConfigService,
    @Inject(WORKFLOW_SUBJECT_HANDLERS) handlers: WorkflowSubjectHandler[],
  ) {
    this.handlersByType = new Map(handlers.map((h) => [h.subjectType, h]));
  }

  /** Check order deliberately follows brief §11 exactly (1-7; "8. a duplicate
   *  delivery does not already exist" is enforced by
   *  `WhatsAppDeliveryCreationService`'s DB-constraint-backed `create()` call,
   *  not here — same division of responsibility as `EmailEligibilityService`/
   *  `EmailDeliveryCreationService`, Sprint 28). */
  async evaluate(
    organisationId: string,
    notification: Notification,
  ): Promise<WhatsAppEligibilityResult> {
    // 1. Notification belongs to this organisation — enforced by the caller
    //    only ever passing a notification already scoped to organisationId
    //    (NotificationRepository.findPendingForWhatsAppEvaluation).

    // 2. Recipient user exists.
    const user = await this.userService.getById(organisationId, notification.recipientUserId);
    if (!user) {
      return { eligible: false, reason: 'Recipient user not found' };
    }

    // 3. User is eligible for notification delivery (active, not suspended/locked).
    if (user.status !== 'ACTIVE') {
      return { eligible: false, reason: `Recipient status is ${user.status}, not ACTIVE` };
    }

    const organisation = await this.organisationService.getById(organisationId);
    if (!organisation) {
      return { eligible: false, reason: 'Organisation not found' };
    }

    // 4. User has a valid, normalizable WhatsApp-capable phone number.
    const phoneResult = normalizePhoneNumber(user.phoneNumber, organisation.country);
    if (!phoneResult.normalized) {
      return { eligible: false, reason: phoneResult.reason ?? 'No usable phone number' };
    }

    // 5. WhatsApp preference allows this category.
    const category = categoryForType(notification.type);
    const whatsappEnabled = await this.preferenceService.isWhatsAppEnabled(
      organisationId,
      notification.recipientUserId,
      category,
    );
    if (!whatsappEnabled) {
      return { eligible: false, reason: 'Recipient has not enabled WhatsApp for this category' };
    }

    const subjectLabel = humanizeSubjectType(notification.sourceType);
    const subjectReference = await describeSubject(
      this.handlersByType,
      organisationId,
      notification.sourceType,
      notification.sourceId,
    );
    const webPublicUrl = this.config.get<string>('email.webPublicUrl') ?? 'http://localhost:3000';
    const approvalUrl = notification.actionUrl
      ? `${webPublicUrl}${notification.actionUrl}`
      : webPublicUrl;

    // 6. The notification has a supported WhatsApp template.
    const template = resolveWhatsAppTemplate(
      this.config,
      notification,
      `${user.firstName} ${user.lastName}`.trim(),
      subjectReference,
      subjectLabel,
      approvalUrl,
    );
    if (!template) {
      return { eligible: false, reason: `No WhatsApp template for "${notification.type}"` };
    }

    // 7. The organisation/channel configuration permits WhatsApp.
    const settings = mergeWorkspaceSettings(organisation.settings);
    if (!settings.whatsapp.enabled) {
      return { eligible: false, reason: 'WhatsApp delivery is disabled for this organisation' };
    }

    return {
      eligible: true,
      recipientPhone: phoneResult.normalized,
      recipientDisplayName: `${user.firstName} ${user.lastName}`.trim(),
      template,
    };
  }
}
