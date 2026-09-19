import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EmailDelivery } from '@prisma/client';

import {
  EMAIL_PROCESSING_LEASE_MS,
  MAX_EMAIL_ATTEMPTS,
  emailRetryDelayForAttempt,
} from './email-delivery-processing.constants';
import { EmailDeliveryRepository, ListEmailDeliveriesParams } from './email-delivery.repository';
import { EMAIL_PROVIDER, EmailProvider } from './ports/email-provider.port';

export interface ProcessPendingDeliveriesResult {
  processed: number;
  sent: number;
  failed: number;
}

/**
 * Sprint 28 §Workstream E "Email Processing Reliability" (docs/architecture/
 * email-delivery.md "Delivery state machine" / "At-least-once delivery
 * limitation"). The "Email delivery processor → Provider adapter" arrow in the
 * brief's architecture diagram — the ONLY service in this codebase that calls
 * {@link EmailProvider}. Deliberately separate from
 * `EmailDeliveryCreationService` (creation) and `NotificationEventProcessorService`
 * (in-app, Sprint 27/27.1) — three independent, independently-testable services,
 * each with exactly one job.
 *
 * Ambiguous-outcome handling (§8.3): the provider call happens OUTSIDE any
 * database transaction (an SMTP round-trip cannot be part of one), so there is a
 * real, documented window where the provider accepts a message but this process
 * crashes before persisting `SENT`. On the next sweep, the stale `PROCESSING`
 * lease is reclaimed and the message is sent AGAIN — this is honest
 * at-least-once delivery, never claimed as exactly-once. `providerMessageId` and
 * `correlationId` (the `EmailDelivery.id` itself, passed to every provider call)
 * are recorded specifically so a human/administrator CAN spot a duplicate in the
 * provider's own dashboard after the fact, even though this codebase cannot
 * prevent one automatically without provider-side idempotency support neither
 * the local nor SMTP adapter currently implements.
 */
@Injectable()
export class EmailDeliveryProcessorService {
  private readonly logger = new Logger(EmailDeliveryProcessorService.name);

  constructor(
    private readonly repository: EmailDeliveryRepository,
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
  ) {}

  async processPendingDeliveries(
    organisationId: string,
    limit = 50,
  ): Promise<ProcessPendingDeliveriesResult> {
    const staleBefore = new Date(Date.now() - EMAIL_PROCESSING_LEASE_MS);
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

  private async processOne(delivery: EmailDelivery): Promise<'sent' | 'failed'> {
    await this.repository.stampFirstAttempt(delivery.id);

    const result = await this.provider.send({
      fromEmail: delivery.fromEmail,
      fromName: delivery.fromName,
      toEmail: delivery.recipientEmail,
      toName: delivery.recipientDisplayName ?? undefined,
      subject: delivery.subject,
      text: delivery.textBody,
      html: delivery.htmlBody ?? undefined,
      correlationId: delivery.id,
    });

    if (result.outcome === 'ACCEPTED') {
      await this.repository.markSent(delivery.organisationId, delivery.id, {
        providerName: this.provider.name,
        providerMessageId: result.providerMessageId,
      });
      this.logger.debug(`Email delivery ${delivery.id} sent via ${this.provider.name}`);
      return 'sent';
    }

    const attemptsSoFar = delivery.attempts + 1;
    const terminal = result.outcome === 'TERMINAL_FAILURE' || attemptsSoFar >= MAX_EMAIL_ATTEMPTS;
    await this.repository.markFailed(delivery.organisationId, delivery.id, {
      terminal,
      providerName: this.provider.name,
      errorCategory: result.errorCategory,
      errorMessage: result.errorMessage,
      nextRetryAt: terminal
        ? null
        : new Date(Date.now() + emailRetryDelayForAttempt(attemptsSoFar)),
    });
    this.logger.warn(
      `Email delivery ${delivery.id} ${terminal ? 'FAILED (terminal)' : 'retryable failure'}: ${result.errorCategory ?? 'unknown'}`,
    );
    return 'failed';
  }

  listForOrganisation(organisationId: string, params: ListEmailDeliveriesParams) {
    return Promise.all([
      this.repository.findManyByOrganisation(organisationId, params),
      this.repository.count(organisationId, params),
    ]).then(([items, total]) => ({ items, total }));
  }

  async getById(organisationId: string, id: string): Promise<EmailDelivery> {
    const delivery = await this.repository.findById(organisationId, id);
    if (!delivery) {
      throw new NotFoundException('Email delivery not found');
    }
    return delivery;
  }

  /** Sprint 28 §Workstream G "Operational Administration." Tenant-scoped;
   *  eligible from `FAILED` or a stuck `PROCESSING` row only — see
   *  `EmailDeliveryRepository.manualRetry`. */
  async retryDelivery(organisationId: string, id: string): Promise<EmailDelivery> {
    const retried = await this.repository.manualRetry(organisationId, id);
    if (!retried) {
      throw new ConflictException(
        'Email delivery is not eligible for retry (must be FAILED or a stuck PROCESSING row)',
      );
    }
    return this.getById(organisationId, id);
  }
}
