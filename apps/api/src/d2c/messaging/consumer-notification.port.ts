/**
 * Sprint 42 — D2C Collection Point Fulfilment & Order Completion (docs/domains/d2c.md
 * "Fulfilment Notifications"). Mirrors `WhatsAppProvider`/`PaymentProvider` exactly: an
 * interface + a DI token, so a D2C domain service (e.g. `CollectionPointFulfillmentService`)
 * never knows or cares which real channel a consumer message goes out over — brief §31
 * "WhatsApp is only a communication channel," never imported directly by a business
 * domain. The correct shape is `D2C Fulfilment Domain -> Notification Service (this
 * port) -> WhatsApp`, never `D2C Fulfilment Domain -> WhatsApp` directly.
 *
 * Deliberately best-effort from the CALLER's perspective: every implementation must
 * never throw past this boundary for an ordinary delivery failure (the EXACT
 * "best-effort, never block the business transition" convention `D2CPaymentService`
 * already established for Collection Point auto-assignment and promotion evaluation,
 * Sprint 37/40) — a business-critical state transition (READY_FOR_COLLECTION, COLLECTED)
 * must never be rolled back, retried, or blocked because a consumer message failed to
 * send.
 */
/** Sprint 43 — a small, closed set mirroring exactly the two message bodies
 *  `CollectionPointFulfillmentService.notifyReady`/`.notifyCollected` construct. Plain
 *  string literals, not the Prisma `ConsumerWhatsAppNotificationKind` enum itself — this
 *  port stays decoupled from the ORM, matching every other port in this codebase
 *  (`WhatsAppProvider`/`PaymentProvider`); the one implementation below maps these
 *  values onto the Prisma enum, whose values are identical by construction. */
export type ConsumerNotificationKind = 'COLLECTION_READY' | 'COLLECTION_CONFIRMED';

export interface ConsumerNotificationRequest {
  organisationId: string;
  consumerId: string;
  /** Added Sprint 43 — every current caller has a `SalesOrder` in hand; required so a
   *  delivery-tracking implementation can record which order this notification was
   *  about (docs/domains/d2c.md "Consumer Communication Delivery Visibility"). */
  salesOrderId: string;
  kind: ConsumerNotificationKind;
  message: string;
}

export interface ConsumerNotificationPort {
  /** Sends a plain-text message to the given Consumer over whatever channel this
   *  implementation represents. Never throws for an ordinary send failure — logs and
   *  returns. */
  notify(request: ConsumerNotificationRequest): Promise<void>;
}

export const CONSUMER_NOTIFICATION_PORT = Symbol('CONSUMER_NOTIFICATION_PORT');
