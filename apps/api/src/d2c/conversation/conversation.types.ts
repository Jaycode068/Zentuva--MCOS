import { ConversationState } from '@prisma/client';

/**
 * Sprint 33 — Consumer Conversation Experience Foundation
 * (docs/domains/d2c.md §"Conversation Contract"). The OUTBOUND half of the
 * Channel Adapter ↔ Conversation Layer contract. Server-constructed, never
 * client-submitted, so this is a plain TypeScript type rather than a Zod
 * schema (see `packages/validation/src/d2c.ts` for the inbound half).
 *
 * Deliberately semantic UI instructions, never a WhatsApp-specific payload
 * (brief §17): a future WhatsApp adapter renders `BUTTONS` as WhatsApp
 * interactive reply buttons and `LIST` as a WhatsApp list message; the
 * Sprint 42 simulator renders both as clickable options in its own chat UI.
 * `ConversationService` itself never constructs or imports anything
 * WhatsApp-shaped.
 */
export interface ConversationOption {
  /** The exact value a subsequent `BUTTON`/`LIST_SELECTION` input must echo
   *  back — e.g. a `Territory.id`, or a fixed command like `'REGISTER'`. */
  value: string;
  label: string;
}

/** Added Sprint 35 — D2C OPay Payment Integration (docs/domains/d2c.md
 *  "Conversation Layer Integration"). A semantic instruction to open an
 *  EXTERNAL checkout URL — deliberately its own message type, not a
 *  `BUTTONS` option, since its `checkoutUrl` is a real link (OPay's own
 *  `cashierUrl`, never one Zentuva constructs) rather than a value a
 *  subsequent inbound message echoes back. A future WhatsApp adapter
 *  renders this as an interactive "visit website" button; the Sprint 42
 *  simulator renders it as a clickable link. `ConversationService` never
 *  constructs an OPay-shaped payload — this is the same
 *  `D2CPaymentResult` shape `D2CPaymentService` already returns. */
export interface PaymentRequiredMessage {
  type: 'PAYMENT_REQUIRED';
  text: string;
  orderReference: string;
  paymentReference: string;
  amount: number;
  currency: string;
  checkoutUrl: string;
}

export type ConversationOutboundMessage =
  // `imageUrl` added Sprint 41 — an optional accompanying image (e.g. a product photo
  // shown when a product is selected), channel-neutral by design: a future WhatsApp
  // adapter renders it as a real image message with `text` as the caption, falling back
  // to plain text when absent or when the channel can't send it; a future web-based
  // channel would render it as an `<img>` alongside the text. Never required.
  | { type: 'TEXT'; text: string; imageUrl?: string }
  | { type: 'BUTTONS'; text: string; options: ConversationOption[] }
  | { type: 'LIST'; text: string; options: ConversationOption[] }
  | PaymentRequiredMessage;

export interface ConversationOutboundResponse {
  conversationId: string;
  state: ConversationState;
  messages: ConversationOutboundMessage[];
}
