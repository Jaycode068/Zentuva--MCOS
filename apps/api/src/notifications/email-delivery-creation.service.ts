import { Injectable, Logger } from '@nestjs/common';

import { categoryForType } from './notification-category';
import { NotificationRepository } from './notification.repository';
import { EmailDeliveryRepository } from './email-delivery.repository';
import { EmailEligibilityService } from './email-eligibility.service';
import { EmailTemplateRenderer } from './email-template-renderer';

export interface CreatePendingDeliveriesResult {
  evaluated: number;
  created: number;
  ineligible: number;
}

/**
 * Sprint 28 §Workstream F "Delivery Creation and Dispatch Flow." The "Email
 * eligibility evaluation → Email delivery record" arrow in the brief's own
 * architecture diagram — reads already-created `Notification` rows (via
 * `NotificationRepository.findPendingForEmailEvaluation`, never `WorkflowEvent`),
 * evaluates each with `EmailEligibilityService`, and idempotently creates
 * `EmailDelivery` rows for eligible ones. Deliberately does NOT send anything
 * itself — that's `EmailDeliveryProcessorService`'s job, kept as a fully separate
 * service per the brief's explicit "keep responsibilities clearly separated" rule
 * (§3.1). Sending is the ONLY provider-calling code in this domain.
 */
@Injectable()
export class EmailDeliveryCreationService {
  private readonly logger = new Logger(EmailDeliveryCreationService.name);

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly eligibilityService: EmailEligibilityService,
    private readonly templateRenderer: EmailTemplateRenderer,
    private readonly emailDeliveryRepository: EmailDeliveryRepository,
  ) {}

  async createPendingDeliveries(
    organisationId: string,
    limit = 50,
  ): Promise<CreatePendingDeliveriesResult> {
    const notifications = await this.notificationRepository.findPendingForEmailEvaluation(
      organisationId,
      limit,
    );

    let created = 0;
    let ineligible = 0;

    for (const notification of notifications) {
      const result = await this.eligibilityService.evaluate(organisationId, notification);
      if (!result.eligible || !result.recipientEmail || !result.fromEmail || !result.fromName) {
        ineligible++;
        this.logger.debug(
          `Notification ${notification.id} not email-eligible: ${result.reason ?? 'unknown'}`,
        );
        continue;
      }

      const rendered = this.templateRenderer.render(
        notification,
        result.organisationName ?? 'Zentuva',
      );
      const row = await this.emailDeliveryRepository.create({
        organisationId,
        notificationId: notification.id,
        recipientUserId: notification.recipientUserId,
        recipientEmail: result.recipientEmail,
        recipientDisplayName: result.recipientDisplayName,
        fromEmail: result.fromEmail,
        fromName: result.fromName,
        templateKey: notification.type,
        category: categoryForType(notification.type),
        subject: rendered.subject,
        textBody: rendered.text,
        htmlBody: rendered.html,
      });
      if (row) created++;
    }

    return { evaluated: notifications.length, created, ineligible };
  }
}
