/**
 * Audit action strings for `ConsumerConversation` (Sprint 33,
 * docs/domains/d2c.md). Same `<entity>.<event>` naming convention as every
 * other domain's `*_AUDIT_ACTIONS`. Deliberately coarse — the message-level
 * detail already lives in `ConsumerConversationMessage`, so audit only
 * records the events an admin reviewing tenant activity actually cares
 * about, not every inbound keystroke.
 */
export const CONVERSATION_AUDIT_ACTIONS = {
  STARTED: 'consumer_conversation.started',
  CONSUMER_REGISTERED_VIA_CONVERSATION: 'consumer_conversation.consumer_registered',
  LOCATION_UPDATED_VIA_CONVERSATION: 'consumer_conversation.location_updated',
  LOCATION_REQUEST_VIA_CONVERSATION: 'consumer_conversation.location_request_created',
  RESET: 'consumer_conversation.reset',
  /** Added Sprint 34 — a D2C order was created via the Order Snacks flow. Deliberately
   *  its own action (not a reuse of `sales-order.created`) so this domain never needs a
   *  cross-domain import purely for a string constant — the same reasoning that already
   *  justified `CONSUMER_REGISTERED_VIA_CONVERSATION` existing alongside
   *  `d2c/consumer`'s own audit actions. The `SalesOrder` itself IS audited too, but
   *  through this file's own namespace. */
  ORDER_CREATED_VIA_CONVERSATION: 'consumer_conversation.order_created',
} as const;
