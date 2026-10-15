import { ConfigService } from '@nestjs/config';
import { ConsumerWhatsAppNotificationKind } from '@prisma/client';

/**
 * Stage 5C.1 — WhatsApp Notification Reliability. The D2C-specific counterpart to
 * `notifications/whatsapp-template.ts:resolveWhatsAppTemplate` — that file resolves a
 * template from a `Notification`/`NotificationType` row (the internal
 * Workflow-approval/Recruitment pipeline); D2C's `COLLECTION_READY`/
 * `COLLECTION_CONFIRMED` notifications have no `Notification` row at all (Sprint 42's
 * own deliberate choice — `CollectionPointFulfillmentService` calls
 * `ConsumerNotificationPort` directly), so they need their own small resolver rather
 * than being forced through that file's `Notification`-shaped contract.
 *
 * Returns `null` when no template is configured — the caller
 * (`WhatsAppConsumerNotificationService`) treats that as "fail closed, do not send a
 * free-form message outside the messaging window," never as "fall back to a guessed
 * name." No D2C template has been submitted for Meta approval as of this stage; until
 * one is, every call to this function returns `null` in this deployment, by design.
 */
export interface ResolvedD2CWhatsAppTemplate {
  name: string;
  language: string;
}

export function resolveD2CWhatsAppTemplate(
  config: ConfigService,
  kind: ConsumerWhatsAppNotificationKind,
): ResolvedD2CWhatsAppTemplate | null {
  if (kind === 'COLLECTION_READY') {
    const name = config.get<string | undefined>('whatsapp.d2cCollectionReadyTemplateName');
    if (!name) return null;
    return {
      name,
      language: config.get<string>('whatsapp.d2cCollectionReadyTemplateLanguage') ?? 'en_US',
    };
  }
  if (kind === 'COLLECTION_CONFIRMED') {
    const name = config.get<string | undefined>('whatsapp.d2cCollectionConfirmedTemplateName');
    if (!name) return null;
    return {
      name,
      language: config.get<string>('whatsapp.d2cCollectionConfirmedTemplateLanguage') ?? 'en_US',
    };
  }
  // CONVERSATION_REPLY is always sent while responding to an inbound message —
  // unconditionally within Meta's messaging window by construction — so it never
  // needs a template.
  return null;
}
