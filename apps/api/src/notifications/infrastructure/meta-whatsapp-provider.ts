import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { APPROVAL_TEMPLATE_PARAMETER_ORDER } from '../whatsapp-template';
import {
  WhatsAppImageMessage,
  WhatsAppProvider,
  WhatsAppSendResult,
  WhatsAppTemplateMessage,
  WhatsAppTextMessage,
} from '../ports/whatsapp-provider.port';

export interface MetaWhatsAppConfig {
  apiBaseUrl: string;
  accessToken: string;
  phoneNumberId: string;
  /** Sprint 43 — D2C Operations, Notifications & Production Hardening
   *  (docs/domains/whatsapp.md "Known Limitations"). Previously unbounded: a hung Meta
   *  response could stall a request indefinitely. Defaulted, never required. */
  httpTimeoutMs: number;
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
  const httpTimeoutMs = config.get<number>('whatsappHttpTimeoutMs') ?? 10_000;

  const missing: string[] = [];
  if (!apiBaseUrl) missing.push('WHATSAPP_API_BASE_URL');
  if (!accessToken) missing.push('WHATSAPP_ACCESS_TOKEN');
  if (!phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (missing.length > 0) {
    throw new WhatsAppConfigurationError(
      `WHATSAPP_PROVIDER_MODE=meta requires the following environment variable(s), which are missing or empty: ${missing.join(', ')}. Set WHATSAPP_PROVIDER_MODE=local to use the safe development provider instead.`,
    );
  }

  return {
    apiBaseUrl: apiBaseUrl!,
    accessToken: accessToken!,
    phoneNumberId: phoneNumberId!,
    httpTimeoutMs,
  };
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
    // Sprint 40.5 — prefer the new, unambiguous ordered-array shape when the
    // caller supplies one; the two existing `resolveWhatsAppTemplate`-driven
    // templates keep going through the original named-record + fixed-order
    // mapping, completely unchanged.
    const parameters = message.bodyParameters
      ? message.bodyParameters.map((text) => ({ type: 'text', text }))
      : APPROVAL_TEMPLATE_PARAMETER_ORDER.map((key) => ({
          type: 'text',
          text: message.parameters?.[key] ?? '',
        }));

    const body = {
      messaging_product: 'whatsapp',
      to: toDigitsOnly(message.toPhoneNumber),
      type: 'template',
      template: {
        name: message.templateName,
        language: { code: message.templateLanguage },
        components: [{ type: 'body', parameters }],
      },
    };

    return this.sendRaw(body, message.toPhoneNumber, message.correlationId);
  }

  /** Added Sprint 40.5. Meta's `POST .../messages` text-message shape
   *  (brief's own exact payload — `type: 'text', text: { body }`). */
  async sendText(message: WhatsAppTextMessage): Promise<WhatsAppSendResult> {
    const body = {
      messaging_product: 'whatsapp',
      to: toDigitsOnly(message.toPhoneNumber),
      type: 'text',
      text: { body: message.text },
    };
    return this.sendRaw(body, message.toPhoneNumber, message.correlationId);
  }

  /** Added Sprint 40.5. Meta's `POST .../messages` image-message shape —
   *  `imageUrl` must already be public (brief "Images must use public
   *  URLs. Do not create media storage this sprint."). */
  async sendImage(message: WhatsAppImageMessage): Promise<WhatsAppSendResult> {
    const body = {
      messaging_product: 'whatsapp',
      to: toDigitsOnly(message.toPhoneNumber),
      type: 'image',
      image: { link: message.imageUrl, ...(message.caption ? { caption: message.caption } : {}) },
    };
    return this.sendRaw(body, message.toPhoneNumber, message.correlationId);
  }

  /** The one shared `POST {apiBaseUrl}/{phoneNumberId}/messages` call —
   *  `sendTemplate`/`sendText`/`sendImage` differ only in the request
   *  body's shape, never in how the response is sent, parsed, or
   *  classified. */
  private async sendRaw(
    body: Record<string, unknown>,
    toPhoneNumber: string,
    correlationId: string,
  ): Promise<WhatsAppSendResult> {
    const url = `${this.cfg.apiBaseUrl}/${this.cfg.phoneNumberId}/messages`;
    // Sprint 43 — bounded request timeout (docs/domains/whatsapp.md "Known
    // Limitations"); a hung Meta response previously stalled this call indefinitely.
    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(() => timeoutController.abort(), this.cfg.httpTimeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.cfg.accessToken}`,
          'Content-Type': 'application/json',
          'X-Zentuva-Correlation-Id': correlationId,
        },
        body: JSON.stringify(body),
        signal: timeoutController.signal,
      });

      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (response.ok) {
        const messages = payload.messages as Array<{ id?: string }> | undefined;
        const providerMessageId = messages?.[0]?.id;
        this.logger.debug(
          `WhatsApp accepted message ${providerMessageId ?? '(no id)'} for ${correlationId} to ${redactPhone(toPhoneNumber)}`,
        );
        return { outcome: 'ACCEPTED', providerMessageId };
      }

      return this.mapErrorResponse(response.status, payload);
    } catch (error) {
      // Network-level failure (DNS, connection refused) or our own timeout abort —
      // always retryable, never a message-content or auth problem.
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      const message = error instanceof Error ? error.name : 'unknown';
      this.logger.warn(
        `WhatsApp send failed (${isTimeout ? 'timeout' : 'network error'}): ${message}`,
      );
      return isTimeout
        ? {
            outcome: 'RETRYABLE_FAILURE',
            errorCode: 'WHATSAPP_TIMEOUT',
            errorMessage: `WhatsApp request timed out after ${this.cfg.httpTimeoutMs}ms.`,
          }
        : {
            outcome: 'RETRYABLE_FAILURE',
            errorCode: 'WHATSAPP_NETWORK',
            errorMessage: 'Network error contacting the WhatsApp Business Platform.',
          };
    } finally {
      clearTimeout(timeoutHandle);
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

/** Meta's `to` field is digits-only, no leading `+`. */
function toDigitsOnly(phone: string): string {
  return phone.replace(/^\+/, '');
}

/** Sprint 29 §21 "Phone privacy — avoid logging complete phone numbers
 *  unnecessarily." Keeps the country code and last 2 digits only. */
function redactPhone(phone: string): string {
  if (phone.length <= 6) return '***';
  return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}
