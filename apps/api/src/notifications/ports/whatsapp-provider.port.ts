/**
 * Sprint 29 §6 "WhatsApp Provider Abstraction." Mirrors `EmailProvider`
 * (Sprint 28, `email-provider.port.ts`) and the original `FileStorage` port
 * (Sprint 3.4) exactly: an interface + a DI token, so
 * `WhatsAppDeliveryProcessorService` never knows or cares whether it's
 * talking to `LocalWhatsAppProvider` (dev/test, never contacts the real
 * WhatsApp API) or `MetaWhatsAppProvider` (the real WhatsApp Business
 * Platform / Cloud API) — selected once, in `whatsapp-provider.module.ts`, by
 * `WHATSAPP_PROVIDER_MODE`. The contract carries only what the delivery
 * service actually needs — no Meta-specific shapes leak past this file.
 */
export interface WhatsAppTemplateMessage {
  /** Already-normalized E.164 phone number (`phone-number-normalizer.ts`) —
   *  this port never receives a raw, unnormalized number. */
  toPhoneNumber: string;
  templateName: string;
  templateLanguage: string;
  parameters: Record<string, string>;
  /** `WhatsAppDelivery.id` — passed through so a provider CAN use it as its
   *  own idempotency key where supported (mirrors `EmailMessage.correlationId`,
   *  Sprint 28 §8.3's "ambiguous provider outcomes" reasoning). */
  correlationId: string;
}

export type WhatsAppSendOutcome = 'ACCEPTED' | 'RETRYABLE_FAILURE' | 'TERMINAL_FAILURE';

export interface WhatsAppSendResult {
  outcome: WhatsAppSendOutcome;
  /** The provider's own message id (Meta's `messages[0].id`) — only ever set
   *  when `outcome === 'ACCEPTED'` and the provider actually returned one.
   *  Never fabricated. */
  providerMessageId?: string;
  /** A short, safe classification (e.g. `WHATSAPP_AUTH`, `WHATSAPP_INVALID_RECIPIENT`)
   *  — never a raw provider error object, never an access token. */
  errorCode?: string;
  /** Bounded, human-readable, safe to show an administrator — never a raw
   *  provider response body that could contain account identifiers beyond
   *  what's useful for triage. */
  errorMessage?: string;
}

export interface WhatsAppProvider {
  /** Which adapter this is (`'local'` | `'meta'`) — stored on
   *  `WhatsAppDelivery.providerName`, never used for branching logic outside
   *  this file. */
  readonly name: string;
  sendTemplate(message: WhatsAppTemplateMessage): Promise<WhatsAppSendResult>;
}

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
