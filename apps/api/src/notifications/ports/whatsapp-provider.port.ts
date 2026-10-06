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
  /** The Sprint 29 shape — a NAMED record whose insertion order
   *  `MetaWhatsAppProvider` maps through the fixed
   *  `APPROVAL_TEMPLATE_PARAMETER_ORDER` (see `whatsapp-template.ts`).
   *  Exactly one of `parameters`/`bodyParameters` must be provided; only the
   *  two existing `resolveWhatsAppTemplate`-driven templates
   *  (`WORKFLOW_APPROVAL_REQUIRED`/`INTERVIEW_SCHEDULED`) still use this. */
  parameters?: Record<string, string>;
  /** Added Sprint 40.5 — a plain, already-ordered array mapping directly and
   *  unambiguously onto Meta's positional `{{1}}..{{n}}` body placeholders,
   *  with no per-template named-order registry required. The preferred
   *  shape for any NEW caller (the admin WhatsApp test screen, a future
   *  generic "send this exact template" helper) — see
   *  `sendTemplateWithOrderedParameters` in `whatsapp.types.ts`. */
  bodyParameters?: string[];
  /** `WhatsAppDelivery.id` — passed through so a provider CAN use it as its
   *  own idempotency key where supported (mirrors `EmailMessage.correlationId`,
   *  Sprint 28 §8.3's "ambiguous provider outcomes" reasoning). */
  correlationId: string;
}

/** Added Sprint 40.5 — Real Meta WhatsApp Cloud API Foundation
 *  (docs/domains/whatsapp.md). A free-form outbound text message — only
 *  ever sent from the admin test screen or as the Conversation Layer
 *  adapter's own reply to an inbound message (both already
 *  consumer-initiated contexts WhatsApp's "session message" rules permit);
 *  never business-initiated marketing (brief's own transactional/marketing
 *  distinction — see `WhatsAppEligibilityService`). */
export interface WhatsAppTextMessage {
  toPhoneNumber: string;
  text: string;
  correlationId: string;
}

/** Added Sprint 40.5. `imageUrl` must already be a public URL — this sprint
 *  builds no media storage/upload path (brief "Images must use public
 *  URLs"). */
export interface WhatsAppImageMessage {
  toPhoneNumber: string;
  imageUrl: string;
  caption?: string;
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
  /** Added Sprint 40.5. */
  sendText(message: WhatsAppTextMessage): Promise<WhatsAppSendResult>;
  /** Added Sprint 40.5. */
  sendImage(message: WhatsAppImageMessage): Promise<WhatsAppSendResult>;
}

export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');
