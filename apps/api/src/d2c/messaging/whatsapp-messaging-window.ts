/**
 * Stage 5C.1 — WhatsApp Notification Reliability. Meta's "customer-service messaging
 * window": a business may send a free-form message to a consumer only within 24 hours
 * of that consumer's own last inbound message; outside that window, only an approved
 * template message is accepted (Meta rejects a free-form send with error code
 * `131047` — see `meta-whatsapp-provider.ts:mapErrorResponse`'s
 * `WHATSAPP_MESSAGING_WINDOW_EXPIRED` case). A pure function, deliberately with no
 * database/provider dependency of its own, so it is trivially unit-testable and has
 * exactly one job: decide, given when the consumer last messaged in, whether now is
 * still inside that window.
 */
export const MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinMessagingWindow(lastInboundMessageAt: Date | null, now: Date): boolean {
  if (!lastInboundMessageAt) {
    // No inbound message has ever been recorded for this consumer — there is no
    // window to be inside. Fail safe: treat as outside, never as "no restriction."
    return false;
  }
  return now.getTime() - lastInboundMessageAt.getTime() <= MESSAGING_WINDOW_MS;
}
