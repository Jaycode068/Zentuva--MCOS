import { Module } from '@nestjs/common';

import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { ActivityService } from './activity.service';
import { EmailDeliveryCreationService } from './email-delivery-creation.service';
import { EmailDeliveryProcessorService } from './email-delivery-processor.service';
import { EmailDeliveryRepository } from './email-delivery.repository';
import { EmailEligibilityService } from './email-eligibility.service';
import { EmailTemplateRenderer } from './email-template-renderer';
import { EmailProviderModule } from './infrastructure/email-provider.module';
import { NotificationEventProcessorService } from './notification-event-processor.service';
import { NotificationMessageBuilder } from './notification-message-builder';
import { NotificationPreferenceRepository } from './notification-preference.repository';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationRecipientResolver } from './notification-recipient-resolver';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { WhatsAppDeliveryCreationService } from './whatsapp-delivery-creation.service';
import { WhatsAppDeliveryProcessorService } from './whatsapp-delivery-processor.service';
import { WhatsAppDeliveryRepository } from './whatsapp-delivery.repository';
import { WhatsAppEligibilityService } from './whatsapp-eligibility.service';
import { WhatsAppProviderModule } from './infrastructure/whatsapp-provider.module';

/**
 * Notifications & Activity Centre Foundation (Sprint 27, docs/domains/
 * notifications.md). Imports `WorkflowModule` read-only — the one-directional
 * "downstream consumer" pattern documented on `WorkflowModule` itself: this module
 * reuses `WorkflowEligibilityService`/`WorkflowDefinitionService`/
 * `WORKFLOW_SUBJECT_HANDLERS` (all now exported from `WorkflowModule`) rather than
 * duplicating eligibility logic or subject-description logic, and reads the
 * `WorkflowEvent`/`WorkflowInstance`/`WorkflowStepInstance` TABLES directly via the
 * globally-registered `PrismaService` — never `WorkflowInstanceService` — so nothing
 * here can call into or mutate Workflow's own state machine. `WorkflowModule` itself
 * has no import of, or awareness of, this module.
 *
 * `IdentityModule` is imported for the guards/decorators
 * (`JwtAuthGuard`/`CurrentUser`) the controller uses, matching every other domain
 * module's own import list — Sprint 28 additionally reuses its exported
 * `OrganisationService`/`UserService` for `EmailEligibilityService`, the same
 * "reuse, don't duplicate" reasoning as everything else in this module.
 *
 * Sprint 28 — Email Notification Delivery Foundation adds three new, deliberately
 * SEPARATE services (`EmailEligibilityService`/`EmailDeliveryCreationService`/
 * `EmailDeliveryProcessorService`, docs/architecture/email-delivery.md) plus
 * `EmailProviderModule` (the `LocalEmailProvider`/`SmtpEmailProvider` boundary).
 * None of them import or depend on `NotificationEventProcessorService` or
 * anything Workflow-specific — email is a pure downstream consumer of the
 * already-existing `Notification` table, exactly like `Notification` itself is a
 * pure downstream consumer of `WorkflowEvent`.
 *
 * Sprint 29 — WhatsApp Notification Delivery Foundation adds the identical
 * three-service shape for a THIRD channel (`WhatsAppEligibilityService`/
 * `WhatsAppDeliveryCreationService`/`WhatsAppDeliveryProcessorService`,
 * docs/architecture/whatsapp-delivery.md) plus `WhatsAppProviderModule` (the
 * `LocalWhatsAppProvider`/`MetaWhatsAppProvider` boundary). Same independence
 * guarantee: none of them import `WorkflowInstanceService` or any workflow
 * mutation service — WhatsApp is a pure downstream consumer of the
 * already-existing `Notification` table.
 */
@Module({
  imports: [
    IdentityModule,
    AuthModule,
    WorkflowModule,
    EmailProviderModule,
    WhatsAppProviderModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationRepository,
    NotificationRecipientResolver,
    NotificationMessageBuilder,
    NotificationEventProcessorService,
    NotificationService,
    ActivityService,
    NotificationPreferenceRepository,
    NotificationPreferenceService,
    EmailEligibilityService,
    EmailTemplateRenderer,
    EmailDeliveryRepository,
    EmailDeliveryCreationService,
    EmailDeliveryProcessorService,
    WhatsAppEligibilityService,
    WhatsAppDeliveryRepository,
    WhatsAppDeliveryCreationService,
    WhatsAppDeliveryProcessorService,
  ],
  exports: [NotificationEventProcessorService],
})
export class NotificationsModule {}
