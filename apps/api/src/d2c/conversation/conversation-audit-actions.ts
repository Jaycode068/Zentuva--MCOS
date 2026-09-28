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
} as const;
