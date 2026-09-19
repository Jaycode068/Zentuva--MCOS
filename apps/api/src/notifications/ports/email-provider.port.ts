/**
 * Sprint 28 §Workstream D "Provider Adapter" (docs/architecture/email-delivery.md
 * "Provider-independent adapter"). Mirrors the established `FileStorage` port
 * pattern (Sprint 3.4, `apps/api/src/identity/organisation/ports/file-storage.port.ts`)
 * exactly: an interface + a DI token, so `EmailDeliveryProcessorService` never knows
 * or cares whether it's talking to `LocalEmailProvider` (dev/test, never sends real
 * mail) or `SmtpEmailProvider` (real ZeptoMail SMTP) — selected once, in
 * `email-provider.module.ts`, by `EMAIL_PROVIDER_MODE`.
 */
export interface EmailMessage {
  fromEmail: string;
  fromName: string;
  toEmail: string;
  toName?: string;
  replyTo?: string;
  subject: string;
  text: string;
  /** Optional — a provider/template may be text-only. */
  html?: string;
  /** `EmailDelivery.id` — passed through so a provider CAN use it as its own
   *  idempotency key where supported (Sprint 28 §8.3 "Ambiguous Provider
   *  Outcomes"); the local/SMTP providers implemented this sprint don't need it,
   *  but the field exists so a future provider adapter isn't blocked on a port
   *  change to add real provider-side idempotency. */
  correlationId: string;
}

export type EmailProviderOutcome = 'ACCEPTED' | 'RETRYABLE_FAILURE' | 'TERMINAL_FAILURE';

export interface EmailProviderResult {
  outcome: EmailProviderOutcome;
  /** The provider's own message/transport id — e.g. an SMTP `Message-Id` — only
   *  ever set when `outcome === 'ACCEPTED'` and the provider actually returned
   *  one. Never fabricated. */
  providerMessageId?: string;
  /** A short, safe classification (e.g. `SMTP_AUTH`, `SMTP_CONNECTION`,
   *  `SMTP_RECIPIENT_REJECTED`) — never a raw provider error object, never
   *  credentials. Present on `RETRYABLE_FAILURE`/`TERMINAL_FAILURE` only. */
  errorCategory?: string;
  /** Bounded, human-readable, safe to show an administrator — never the
   *  underlying exception's full message if that could contain connection
   *  strings or credentials (see `SmtpEmailProvider`'s own sanitization). */
  errorMessage?: string;
}

export interface EmailProvider {
  /** Which adapter this is (`'local'` | `'smtp'`) — stored on `EmailDelivery.
   *  providerName`, never used for branching logic outside this file. */
  readonly name: string;
  send(message: EmailMessage): Promise<EmailProviderResult>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
