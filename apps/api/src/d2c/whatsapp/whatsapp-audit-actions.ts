/**
 * Audit action strings for the real Meta WhatsApp Cloud API integration (Sprint 40.5,
 * docs/domains/whatsapp.md). Same `<entity>.<event>` naming convention as every other
 * domain's `*_AUDIT_ACTIONS` (see `conversation-audit-actions.ts`).
 */
export const WHATSAPP_AUDIT_ACTIONS = {
  TEST_MESSAGE_SENT: 'whatsapp.test_message_sent',
  WEBHOOK_SIGNATURE_REJECTED: 'whatsapp.webhook_signature_rejected',
  INBOUND_MESSAGE_RECEIVED: 'whatsapp.inbound_message_received',
  DELIVERY_STATUS_RECEIVED: 'whatsapp.delivery_status_received',
  DUPLICATE_WEBHOOK_SKIPPED: 'whatsapp.duplicate_webhook_skipped',
  ORGANISATION_UNRESOLVED: 'whatsapp.organisation_unresolved',
} as const;
