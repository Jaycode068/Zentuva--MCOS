/**
 * Sprint 40.5 — Real Meta WhatsApp Cloud API Foundation (docs/domains/whatsapp.md).
 * Loose, deliberately partial types for Meta's own webhook JSON shape — this file is
 * the ONLY place that shape is named; `WhatsAppInboundAdapterService` immediately
 * normalizes it into {@link NormalizedWhatsAppInboundMessage} / {@link
 * NormalizedWhatsAppStatusUpdate} before anything else (the Conversation Layer, the
 * audit log) ever sees it — mirrors `PaymentProvider`'s own "no OPay-specific JSON
 * shape leaks past this file" boundary.
 */

export interface MetaWebhookMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  button?: { text: string; payload: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
}

export interface MetaWebhookStatus {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
}

export interface MetaWebhookValue {
  messaging_product: 'whatsapp';
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id: string }>;
  messages?: MetaWebhookMessage[];
  statuses?: MetaWebhookStatus[];
}

export interface MetaWebhookEntry {
  id: string;
  changes: Array<{ value: MetaWebhookValue; field: string }>;
}

export interface MetaWebhookPayload {
  object?: string;
  entry?: MetaWebhookEntry[];
}

/** The brief's own exact normalized shape — `{channel, externalUserId, messageId,
 *  text, timestamp}` — all the Conversation Layer adapter needs, and nothing WhatsApp/
 *  Meta-specific beyond it. */
export interface NormalizedWhatsAppInboundMessage {
  channel: 'WHATSAPP';
  /** Already-normalized E.164 — the sender's WhatsApp number. */
  externalUserId: string;
  messageId: string;
  text: string;
  /** `type==='interactive'` button/list replies carry a stable `id`, used in place of
   *  free text when present — same role `ConversationInput`'s own `BUTTON`/
   *  `LIST_SELECTION` variants play internally. */
  interactiveReplyId?: string;
  timestamp: Date;
}

export interface NormalizedWhatsAppStatusUpdate {
  providerMessageId: string;
  status: string;
  recipientPhone: string;
  timestamp: Date;
}
