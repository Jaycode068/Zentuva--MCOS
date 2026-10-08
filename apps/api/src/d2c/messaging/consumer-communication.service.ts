import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { ConsumerWhatsAppDelivery } from '@prisma/client';

import { AuditService } from '../../identity/audit/audit.service';
import { EffectiveAccessResolver } from '../../identity/authorization/effective-access-resolver';
import {
  WHATSAPP_PROVIDER,
  WhatsAppProvider,
} from '../../notifications/ports/whatsapp-provider.port';
import { CONSUMER_WHATSAPP_DELIVERY_AUDIT_ACTIONS } from './consumer-whatsapp-delivery-audit-actions';
import { ConsumerWhatsAppDeliveryRepository } from './consumer-whatsapp-delivery.repository';
import { WhatsAppConsumerNotificationService } from './whatsapp-consumer-notification.service';

const D2C_COMMUNICATION_VIEW = 'd2c.communication.view';
const D2C_COMMUNICATION_MANAGE = 'd2c.communication.manage';

/**
 * Sprint 43 — D2C Operations, Notifications & Production Hardening
 * (docs/domains/d2c.md "Consumer Communication Delivery Visibility" / "Safe Notification
 * Retry"). The admin-facing read/retry surface over `ConsumerWhatsAppDelivery`
 * (Sprint 43's one new table) — never a second business-event mechanism. `retry()`
 * deliberately has NO dependency on `SalesOrderService`/`PaymentService`/
 * `CollectionPointFulfillmentService`/`InventoryStockRepository`/`LoyaltyService` — it
 * is structurally incapable of recreating an order, rerunning a payment, re-deducting
 * inventory, or granting a reward twice, because this class never imports anything that
 * could do any of those things. It can only ever resend the exact snapshotted message
 * to the exact snapshotted phone number for one existing delivery row.
 */
@Injectable()
export class ConsumerCommunicationService {
  constructor(
    private readonly repository: ConsumerWhatsAppDeliveryRepository,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    private readonly notificationService: WhatsAppConsumerNotificationService,
    private readonly effectiveAccessResolver: EffectiveAccessResolver,
    private readonly auditService: AuditService,
  ) {}

  async listForConsumer(
    organisationId: string,
    actorUserId: string,
    consumerId: string,
    params: { page: number; pageSize: number },
  ): Promise<{ items: ConsumerWhatsAppDelivery[]; total: number }> {
    await this.assertView(organisationId, actorUserId);
    return this.repository.findManyByConsumer(organisationId, consumerId, params);
  }

  async listForOrder(
    organisationId: string,
    actorUserId: string,
    salesOrderId: string,
  ): Promise<ConsumerWhatsAppDelivery[]> {
    await this.assertView(organisationId, actorUserId);
    return this.repository.findManyByOrder(organisationId, salesOrderId);
  }

  /** Added Sprint 43.5 — D2C Two-Way Conversation Reliability (brief §Phase 14
   *  "Conversation Transcript / Debug View"). The admin conversation-transcript page's
   *  own delivery-log read: every real outbound WhatsApp send
   *  (`kind: CONVERSATION_REPLY`) made for one conversation. Lives here, not on
   *  `ConversationController`, so the channel-neutral Conversation Layer never gains a
   *  WhatsApp-specific dependency (verified executably by
   *  `conversation-independence.spec.ts`) — the admin page itself fetches this
   *  alongside `GET /d2c/conversations/:id` and renders the two together. */
  async listForConversation(
    organisationId: string,
    actorUserId: string,
    conversationId: string,
  ): Promise<ConsumerWhatsAppDelivery[]> {
    await this.assertView(organisationId, actorUserId);
    return this.repository.findManyByConversation(organisationId, conversationId);
  }

  /**
   * Brief §Phase 5 "Safe Notification Retry." Idempotent and concurrency-safe via
   * `claimForRetry`'s atomic conditional transition (`FAILED`/stale-`PROCESSING` ->
   * `PROCESSING`) — a genuinely concurrent second retry call for the SAME delivery sees
   * `claimForRetry` return `null` and is rejected outright, never a second send. Resends
   * the EXACT original `recipientPhoneSnapshot`/`messageSnapshot` (brief: "preserve the
   * original notification/event context") — never re-derives the consumer's current
   * phone number or re-renders the message from live order/fulfilment state.
   */
  async retry(
    organisationId: string,
    actorUserId: string,
    id: string,
  ): Promise<ConsumerWhatsAppDelivery> {
    await this.assertManage(organisationId, actorUserId);

    const claimed = await this.repository.claimForRetry(organisationId, id);
    if (!claimed) {
      throw new ConflictException(
        'This notification is not eligible for retry (it must have failed, or already be mid-retry)',
      );
    }

    const result = await this.notificationService.attemptSend(
      organisationId,
      claimed,
      claimed.recipientPhoneSnapshot,
      claimed.messageSnapshot,
      false,
    );

    await this.auditService.record({
      action: CONSUMER_WHATSAPP_DELIVERY_AUDIT_ACTIONS.RETRIED,
      entityType: 'ConsumerWhatsAppDelivery',
      entityId: id,
      organisationId,
      actorUserId,
      metadata: {
        consumerId: claimed.consumerId,
        salesOrderId: claimed.salesOrderId,
        kind: claimed.kind,
        outcome: result.status,
      },
    });

    return result;
  }

  private async assertView(organisationId: string, actorUserId: string): Promise<void> {
    const access = await this.effectiveAccessResolver.resolve(organisationId, actorUserId);
    if (
      access.isOwnerBypass ||
      access.grants.has(D2C_COMMUNICATION_VIEW) ||
      access.grants.has(D2C_COMMUNICATION_MANAGE)
    ) {
      return;
    }
    throw new ForbiddenException('You are not authorized to view D2C communication history');
  }

  private async assertManage(organisationId: string, actorUserId: string): Promise<void> {
    const access = await this.effectiveAccessResolver.resolve(organisationId, actorUserId);
    if (access.isOwnerBypass || access.grants.has(D2C_COMMUNICATION_MANAGE)) {
      return;
    }
    throw new ForbiddenException('You are not authorized to retry a D2C consumer notification');
  }
}
