import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { WhatsAppDelivery } from '@prisma/client';

import {
  MAX_WHATSAPP_ATTEMPTS,
  WHATSAPP_PROCESSING_LEASE_MS,
  whatsappRetryDelayForAttempt,
} from './whatsapp-delivery-processing.constants';
import {
  ListWhatsAppDeliveriesParams,
  WhatsAppDeliveryRepository,
} from './whatsapp-delivery.repository';
import { WHATSAPP_PROVIDER, WhatsAppProvider } from './ports/whatsapp-provider.port';

export interface ProcessPendingWhatsAppDeliveriesResult {
  processed: number;
  sent: number;
  failed: number;
}

/**
 * Sprint 29 §16 "Delivery Processing" — the "delivery processor → provider"
 * step, mirroring `EmailDeliveryProcessorService` (Sprint 28) exactly. The
 * ONLY service in this codebase that calls {@link WhatsAppProvider}.
 * Deliberately separate from `WhatsAppDeliveryCreationService` (creation) and
 * `NotificationEventProcessorService`/`EmailDeliveryProcessorService` (the
 * other two pipelines) — each channel's processor is fully independent.
 *
 * Ambiguous-outcome handling: the provider call happens OUTSIDE any database
 * transaction (an HTTP round-trip to the WhatsApp Business Platform cannot
 * meaningfully participate in one), so there is a real, documented window
 * where the provider accepts a message but this process crashes before
 * persisting `SENT`. On the next sweep, the stale `PROCESSING` lease is
 * reclaimed and the message is sent AGAIN — honest at-least-once delivery,
 * never claimed as exactly-once (same limitation as `EmailDeliveryProcessorService`,
 * documented in docs/architecture/whatsapp-delivery.md).
 */
@Injectable()
export class WhatsAppDeliveryProcessorService {
  private readonly logger = new Logger(WhatsAppDeliveryProcessorService.name);

  constructor(
    private readonly repository: WhatsAppDeliveryRepository,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
  ) {}

  async processPendingDeliveries(
    organisationId: string,
    limit = 50,
  ): Promise<ProcessPendingWhatsAppDeliveriesResult> {
    const staleBefore = new Date(Date.now() - WHATSAPP_PROCESSING_LEASE_MS);
    const claimed = await this.repository.claimBatch(organisationId, staleBefore, limit);

    let sent = 0;
    let failed = 0;

    for (const delivery of claimed) {
      const outcome = await this.processOne(delivery);
      if (outcome === 'sent') sent++;
      else failed++;
    }

    return { processed: claimed.length, sent, failed };
  }

  private async processOne(delivery: WhatsAppDelivery): Promise<'sent' | 'failed'> {
    const parameters = (delivery.templateParameterSnapshot ?? {}) as Record<string, string>;

    const result = await this.provider.sendTemplate({
      toPhoneNumber: delivery.recipientPhoneSnapshot,
      templateName: delivery.templateName,
      templateLanguage: delivery.templateLanguage,
      parameters,
      correlationId: delivery.id,
    });

    if (result.outcome === 'ACCEPTED') {
      await this.repository.markSent(delivery.organisationId, delivery.id, {
        providerName: this.provider.name,
        providerMessageId: result.providerMessageId,
      });
      this.logger.debug(`WhatsApp delivery ${delivery.id} sent via ${this.provider.name}`);
      return 'sent';
    }

    const attemptsSoFar = delivery.attempts + 1;
    const terminal =
      result.outcome === 'TERMINAL_FAILURE' || attemptsSoFar >= MAX_WHATSAPP_ATTEMPTS;
    await this.repository.markFailed(delivery.organisationId, delivery.id, {
      terminal,
      providerName: this.provider.name,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      nextRetryAt: terminal
        ? null
        : new Date(Date.now() + whatsappRetryDelayForAttempt(attemptsSoFar)),
    });
    this.logger.warn(
      `WhatsApp delivery ${delivery.id} ${terminal ? 'FAILED (terminal)' : 'retryable failure'}: ${result.errorCode ?? 'unknown'}`,
    );
    return 'failed';
  }

  listForOrganisation(organisationId: string, params: ListWhatsAppDeliveriesParams) {
    return Promise.all([
      this.repository.findManyByOrganisation(organisationId, params),
      this.repository.count(organisationId, params),
    ]).then(([items, total]) => ({ items, total }));
  }

  async getById(organisationId: string, id: string): Promise<WhatsAppDelivery> {
    const delivery = await this.repository.findById(organisationId, id);
    if (!delivery) {
      throw new NotFoundException('WhatsApp delivery not found');
    }
    return delivery;
  }

  /** Sprint 29 §18 "Operational Administration." Tenant-scoped; eligible
   *  from `FAILED` or a stuck `PROCESSING` row only. */
  async retryDelivery(organisationId: string, id: string): Promise<WhatsAppDelivery> {
    const retried = await this.repository.manualRetry(organisationId, id);
    if (!retried) {
      throw new ConflictException(
        'WhatsApp delivery is not eligible for retry (must be FAILED or a stuck PROCESSING row)',
      );
    }
    return this.getById(organisationId, id);
  }
}
