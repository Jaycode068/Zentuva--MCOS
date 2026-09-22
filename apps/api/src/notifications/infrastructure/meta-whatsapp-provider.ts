import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { APPROVAL_TEMPLATE_PARAMETER_ORDER } from '../whatsapp-template';
import {
  WhatsAppProvider,
  WhatsAppSendResult,
  WhatsAppTemplateMessage,
} from '../ports/whatsapp-provider.port';

export interface MetaWhatsAppConfig {
  apiBaseUrl: string;
  accessToken: string;
  phoneNumberId: string;
}

/** Thrown at construction time — never at request time — when
 *  `WHATSAPP_PROVIDER_MODE=meta` but a required field is missing. Sprint 29
 *  §25 "restore the safe local provider mode": a NestJS provider factory
 *  throwing here stops the module (and therefore the app) from starting,
 *  the loudest, safest possible signal — never a route that quietly
 *  no-ops or falls back to the local provider while claiming success (same
 *  pattern as `SmtpConfigurationError`, Sprint 28). Lists only WHICH fields
 *  are missing, never any value. */
export class WhatsAppConfigurationError extends Error {}

export function loadMetaWhatsAppConfig(config: ConfigService): MetaWhatsAppConfig {
  const apiBaseUrl = config.get<string>('whatsapp.apiBaseUrl');
  const accessToken = config.get<string | undefined>('whatsapp.accessToken');
  const phoneNumberId = config.get<string | undefined>('whatsapp.phoneNumberId');

  const missing: string[] = [];
  if (!apiBaseUrl) missing.push('WHATSAPP_API_BASE_URL');
  if (!accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (missing.length > 0) {
    throw new WhatsAppConfigurationError(
      `WHATSAPP_PROVIDER_MODE=meta requires the following environment variable(s), which are missing or empty: ${missing.join(', ')}. Set WHATSAPP_PROVIDER_MODE=local to use the safe development provider instead.`,
    );
  }

  return { apiBaseUrl: apiBaseUrl!, accessToken: accessToken!, phoneNumberId: phoneNumberId! };
}

/**
 * Sprint 29 §8 "Real WhatsApp Provider." A real WhatsApp Business Platform
 * (Meta Cloud API) provider, built on the platform's plain REST endpoint
 * (`POST /{phone-number-id}/messages`) using Node's built-in `fetch` — no new
 * HTTP-client dependency, no Meta SDK. Only constructed when
 * `WHATSAPP_PROVIDER_MODE=meta` (`whatsapp-provider.module.ts`).
 *
 * Security: never logs `WHATSAPP_ACCESS_TOKEN`, never includes it in a
 * thrown/returned error — every error surfaced by {@link sendTemplate} is a
 * short, hand-built safe string (Meta's own numeric `error.code`/`error.
 * type` plus a truncated `error.message`, never the full raw response body,
 * which could otherwise echo back request details). Never logs the full
 * recipient phone number in a log line (Sprint 29 §21 "Phone privacy") — only
 * a redacted form.
 */
@Injectable()
export class MetaWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'meta';
  private readonly logger = new Logger(MetaWhatsAppProvider.name);
  private readonly cfg: MetaWhatsAppConfig;

  constructor(@Inject(ConfigService) config: ConfigService) {
    this.cfg = loadMetaWhatsAppConfig(config);
    this.logger.log(
      `WhatsApp (Meta Cloud API) provider configured (base URL configured: yes, phone number id configured: yes, access token configured: yes).`,
    );
  }

  async sendTemplate(message: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
    const url = `${this.cfg.apiBaseUrl}/${this.cfg.phoneNumberId}/messages`;
    const toDigitsOnly = message.toPhoneNumber.replace(/^\+/, '');

    const body = {
      messaging_product: 'whatsapp',
      to: toDigitsOnly,
      type: 'template',
      template: {
        name: message.templateName,
        language: { code: message.templateLanguage },
        components: [
          {
            type: 'body',
            parameters: APPROVAL_TEMPLATE_PARAMETER_ORDER.map((key) => ({
              type: 'text',
              text: message.parameters[key] ?? '',
            })),
          },
        ],
      },
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.accessToken}`,
          'Content-Type': 'application/json',
          'X-Zentuva-Correlation-Id': message.correlationId,
        },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (response.ok) {
        const messages = payload.messages as Array<{ id?: string }> | undefined;
        const providerMessageId = messages?.[0]?.id;
        this.logger.debug(
          `WhatsApp accepted message ${providerMessageId ?? '(no id)'} for ${message.correlationId} to ${redactPhone(message.toPhoneNumber)}`,
        );
        return { outcome: 'ACCEPTED', providerMessageId };
      }

      return this.mapErrorResponse(response.status, payload);
    } catch (error) {
      // Network-level failure (DNS, connection refused, timeout) — always
      // retryable, never a message-content or auth problem.
      const message = error instanceof Error ? error.name : 'unknown';
      this.logger.warn(`WhatsApp send failed (network error): ${message}`);
      return {
        outcome: 'RETRYABLE_FAILURE',
        errorCode: 'WHATSAPP_NETWORK',
        errorMessage: 'Network error contacting the WhatsApp Business Platform.',
      };
    }
  }

  /** Classifies a Meta Graph API error response into retryable vs. terminal
   *  (Sprint 29 §16 "distinguish transient provider failure / terminal
   *  provider failure / invalid recipient / invalid template / authentication
   *  failure"). Never returns the raw `payload` — only a short, pre-written
   *  safe description plus Meta's own numeric error code (never credentials,
   *  which Meta error responses do not echo back regardless, but this method
   *  still never trusts the raw message verbatim, as defense in depth). */
  private mapErrorResponse(
    httpStatus: number,
    payload: Record<string, unknown>,
  ): WhatsAppSendResult {
    const error = (payload.error ?? {}) as { code?: number; type?: string; error_subcode?: number };
    const code = error.code;
    const type = error.type;

    let errorCode: string;
    let outcome: WhatsAppSendResult['outcome'];

    if (httpStatus === 401 || code === 190) {
      // Invalid/expired access token.
      outcome = 'TERMINAL_FAILURE';
      errorCode = 'WHATSAPP_AUTH';
    } else if (code === 131026 || code === 131030) {
      // Message undeliverable / recipient not a valid WhatsApp user — Meta's
      // own "invalid recipient" codes.
      outcome = 'TERMINAL_FAILURE';
      errorCode = 'WHATSAPP_INVALID_RECIPIENT';
    } else if (code === 132000 || code === 132001 || code === 132005 || code === 132007) {
      // Template does not exist / parameter mismatch / not approved.
      outcome = 'TERMINAL_FAILURE';
      errorCode = 'WHATSAPP_INVALID_TEMPLATE';
    } else if (code === 80007 || httpStatus === 429) {
      // Rate limiting — always retryable.
      outcome = 'RETRYABLE_FAILURE';
      errorCode = 'WHATSAPP_RATE_LIMITED';
    } else if (httpStatus >= 500) {
      outcome = 'RETRYABLE_FAILURE';
      errorCode = 'WHATSAPP_SERVER_ERROR';
    } else {
      // Unknown failure mode — default to retryable up to the attempt limit
      // rather than giving up immediately (same convention as
      // SmtpEmailProvider's own "SMTP_UNKNOWN" default, Sprint 28).
      outcome = 'RETRYABLE_FAILURE';
      errorCode = 'WHATSAPP_UNKNOWN';
    }

    this.logger.warn(
      `WhatsApp send failed: category=${errorCode} httpStatus=${httpStatus} metaCode=${code ?? 'n/a'} metaType=${type ?? 'n/a'}`,
    );

    return {
      outcome,
      errorCode,
      errorMessage: `WhatsApp failure (${errorCode})${code ? `, provider code ${code}` : ''}.`,
    };
  }
}

/** Sprint 29 §21 "Phone privacy — avoid logging complete phone numbers
 *  unnecessarily." Keeps the country code and last 2 digits only. */
function redactPhone(phone: string): string {
  if (phone.length <= 6) return '***';
  return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}
