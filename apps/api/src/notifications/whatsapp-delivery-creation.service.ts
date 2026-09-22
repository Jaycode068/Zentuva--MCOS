import { Injectable, Logger } from '@nestjs/common';

import { categoryForType } from './notification-category';
import { NotificationRepository } from './notification.repository';
import { WhatsAppDeliveryRepository } from './whatsapp-delivery.repository';
import { WhatsAppEligibilityService } from './whatsapp-eligibility.service';

export interface CreatePendingWhatsAppDeliveriesResult {
  evaluated: number;
  created: number;
  ineligible: number;
}

/**
 * Sprint 29 §16 "Delivery Processing" — the "eligibility evaluation → delivery
 * record" step, mirroring `EmailDeliveryCreationService` (Sprint 28) exactly.
 * Reads already-created `Notification` rows (via
 * `NotificationRepository.findPendingForWhatsAppEvaluation`, never
 * `WorkflowEvent`), evaluates each with `WhatsAppEligibilityService`, and
 * idempotently creates `WhatsAppDelivery` rows for eligible ones.
 * Deliberately does NOT send anything itself — that is
 * `WhatsAppDeliveryProcessorService`'s job, kept as a fully separate service.
 */
@Injectable()
export class WhatsAppDeliveryCreationService {
  private readonly logger = new Logger(WhatsAppDeliveryCreationService.name);

  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly eligibilityService: WhatsAppEligibilityService,
    private readonly whatsappDeliveryRepository: WhatsAppDeliveryRepository,
  ) {}

  async createPendingDeliveries(
    organisationId: string,
    limit = 50,
  ): Promise<CreatePendingWhatsAppDeliveriesResult> {
    const notifications = await this.notificationRepository.findPendingForWhatsAppEvaluation(
      organisationId,
      limit,
    );

    let created = 0;
    let ineligible = 0;

    for (const notification of notifications) {
      const result = await this.eligibilityService.evaluate(organisationId, notification);
      if (!result.eligible || !result.recipientPhone || !result.template) {
        ineligible++;
        this.logger.debug(
          `Notification ${notification.id} not WhatsApp-eligible: ${result.reason ?? 'unknown'}`,
        );
        continue;
      }

      const row = await this.whatsappDeliveryRepository.create({
        organisationId,
        notificationId: notification.id,
        recipientUserId: notification.recipientUserId,
        recipientPhoneSnapshot: result.recipientPhone,
        recipientDisplayNameSnapshot: result.recipientDisplayName,
        templateName: result.template.name,
        templateLanguage: result.template.language,
        templateParameterSnapshot: result.template.parameters,
        category: categoryForType(notification.type),
      });
      if (row) created++;
    }

    return { evaluated: notifications.length, created, ineligible };
  }
}
