import { Injectable, Logger } from '@nestjs/common';

import { EmailMessage, EmailProvider, EmailProviderResult } from '../ports/email-provider.port';

/** A message the local provider "sent," recorded for test assertions and for the
 *  browser-based live-verification flow (Sprint 28 §7.2 "Local Provider"). */
export interface RecordedLocalEmail extends EmailMessage {
  outcome: EmailProviderResult['outcome'];
  sentAt: Date;
}

/**
 * Sprint 28 §Workstream D "Local Provider" (docs/architecture/email-delivery.md
 * "Local provider"). The default provider (`EMAIL_PROVIDER_MODE=local`) — NEVER
 * sends real email, records every message in memory for assertions, and produces
 * deterministic results. `@Injectable()` with app-lifetime scope, so its recorded
 * messages persist across requests within one process — exactly what both the Jest
 * suites and a manual local-dev "did it actually try to send" check need.
 *
 * Deterministic failure simulation via a plus-addressing convention on the
 * recipient address — no extra configuration surface, no special test-only method
 * threaded through the processor:
 *   - `...+failretryable@...` → `RETRYABLE_FAILURE`
 *   - `...+failterminal@...`  → `TERMINAL_FAILURE`
 *   - anything else           → `ACCEPTED`
 */
@Injectable()
export class LocalEmailProvider implements EmailProvider {
  readonly name = 'local';
  private readonly logger = new Logger(LocalEmailProvider.name);
  private readonly sent: RecordedLocalEmail[] = [];

  async send(message: EmailMessage): Promise<EmailProviderResult> {
    const outcome = this.classify(message.toEmail);
    this.sent.push({ ...message, outcome, sentAt: new Date() });
    this.logger.debug(
      `[local email provider] ${outcome} — to=${message.toEmail} subject="${message.subject}"`,
    );

    if (outcome === 'ACCEPTED') {
      return { outcome, providerMessageId: `local-${Date.now()}-${message.correlationId}` };
    }
    if (outcome === 'RETRYABLE_FAILURE') {
      return {
        outcome,
        errorCategory: 'LOCAL_SIMULATED_RETRYABLE',
        errorMessage: 'Simulated retryable failure (recipient used +failretryable@).',
      };
    }
    return {
      outcome,
      errorCategory: 'LOCAL_SIMULATED_TERMINAL',
      errorMessage: 'Simulated terminal failure (recipient used +failterminal@).',
    };
  }

  private classify(toEmail: string): EmailProviderResult['outcome'] {
    if (toEmail.includes('+failretryable@')) return 'RETRYABLE_FAILURE';
    if (toEmail.includes('+failterminal@')) return 'TERMINAL_FAILURE';
    return 'ACCEPTED';
  }

  /** Test/diagnostic-only accessor — never used by production dispatch logic. */
  getSentMessages(): readonly RecordedLocalEmail[] {
    return this.sent;
  }

  /** Test-only — clears recorded messages between test cases. */
  reset(): void {
    this.sent.length = 0;
  }
}
