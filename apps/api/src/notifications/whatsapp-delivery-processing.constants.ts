/**
 * Sprint 29 §16 "Delivery Processing" — a SEPARATE policy from
 * `email-delivery-processing.constants.ts` (Sprint 28) and `notification-
 * processing.constants.ts` (Sprint 27.1), per the established "do not reuse
 * another channel's retry policy blindly" principle. WhatsApp Business
 * Platform failures (rate limiting, template/auth issues) are closer in
 * profile to email's SMTP failures than to an in-process DB hiccup, so this
 * borrows email's shape/numbers as a reasonable starting point — still its
 * own independently-configurable file, not a shared import, so either can
 * change without affecting the other.
 */

/** Total attempts (including the first) before a WhatsApp delivery becomes
 *  terminal `FAILED` and requires the admin retry endpoint. */
export const MAX_WHATSAPP_ATTEMPTS = 3;

/** Indexed by `attempts` AFTER the failing attempt — the delay before the
 *  NEXT attempt. */
export const WHATSAPP_RETRY_BACKOFF_MS = [0, 2 * 60_000, 10 * 60_000];

/** How long a `PROCESSING` claim is honored before being treated as an
 *  abandoned lease (a crashed/hung processor) and reclaimed by the next
 *  sweep. */
export const WHATSAPP_PROCESSING_LEASE_MS = 10 * 60 * 1000;

export function whatsappRetryDelayForAttempt(attemptNumber: number): number {
  const index = Math.min(attemptNumber, WHATSAPP_RETRY_BACKOFF_MS.length - 1);
  return (
    WHATSAPP_RETRY_BACKOFF_MS[index] ??
    WHATSAPP_RETRY_BACKOFF_MS[WHATSAPP_RETRY_BACKOFF_MS.length - 1] ??
    0
  );
}
