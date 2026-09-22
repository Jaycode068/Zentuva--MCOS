import { Injectable, Logger } from '@nestjs/common';

import { WhatsAppSendResult, WhatsAppTemplateMessage } from '../ports/whatsapp-provider.port';

/** A message the local provider "sent," recorded for test assertions and
 *  local-dev inspection (Sprint 29 §7 "Local Provider"). */
export interface RecordedLocalWhatsAppMessage extends WhatsAppTemplateMessage {
  outcome: WhatsAppSendResult['outcome'];
  sentAt: Date;
}

/**
 * Sprint 29 §7 "Local Provider" (docs/architecture/whatsapp-delivery.md
 * "Local provider"). The default provider (`WHATSAPP_PROVIDER_MODE=local`) —
 * NEVER contacts the real WhatsApp API, records every message in memory for
 * assertions, deterministic. "No developer should accidentally send WhatsApp
 * messages simply by running the API locally" (brief §7) — this is the only
 * provider ever constructed unless `WHATSAPP_PROVIDER_MODE=meta` is set
 * explicitly.
 *
 * Deterministic failure simulation via a phone-number convention (phone
 * numbers cannot carry a `+tag@domain` the way email addresses can, so this
 * uses a small set of reserved test numbers instead — no extra configuration
 * surface, no test-only method threaded through the processor):
 *   - `+10000000001` → `RETRYABLE_FAILURE`
 *   - `+10000000002` → `TERMINAL_FAILURE`
 *   - anything else  → `ACCEPTED`
 */
@Injectable()
export class LocalWhatsAppProvider {
  readonly name = 'local';
  private readonly logger = new Logger(LocalWhatsAppProvider.name);
  private readonly sent: RecordedLocalWhatsAppMessage[] = [];

  static readonly SIMULATE_RETRYABLE_FAILURE_NUMBER = '+10000000001';
  static readonly SIMULATE_TERMINAL_FAILURE_NUMBER = '+10000000002';

  async sendTemplate(message: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
    const outcome = this.classify(message.toPhoneNumber);
    this.sent.push({ ...message, outcome, sentAt: new Date() });
    this.logger.debug(
      `[local whatsapp provider] ${outcome} — template=${message.templateName} correlationId=${message.correlationId}`,
    );

    if (outcome === 'ACCEPTED') {
      return { outcome, providerMessageId: `local-wa-${Date.now()}-${message.correlationId}` };
    }
    if (outcome === 'RETRYABLE_FAILURE') {
      return {
        outcome,
        errorCode: 'LOCAL_SIMULATED_RETRYABLE',
        errorMessage: 'Simulated retryable failure (recipient used the reserved test number).',
      };
    }
    return {
      outcome,
      errorCode: 'LOCAL_SIMULATED_TERMINAL',
      errorMessage: 'Simulated terminal failure (recipient used the reserved test number).',
    };
  }

  private classify(toPhoneNumber: string): WhatsAppSendResult['outcome'] {
    if (toPhoneNumber === LocalWhatsAppProvider.SIMULATE_RETRYABLE_FAILURE_NUMBER) {
      return 'RETRYABLE_FAILURE';
    }
    if (toPhoneNumber === LocalWhatsAppProvider.SIMULATE_TERMINAL_FAILURE_NUMBER) {
      return 'TERMINAL_FAILURE';
    }
    return 'ACCEPTED';
  }

  /** Test/diagnostic-only accessor — never used by production dispatch logic. */
  getSentMessages(): readonly RecordedLocalWhatsAppMessage[] {
    return this.sent;
  }

  /** Test-only — clears recorded messages between test cases. */
  reset(): void {
    this.sent.length = 0;
  }
}
