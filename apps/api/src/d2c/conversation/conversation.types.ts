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

export type ConversationOutboundMessage =
  | { type: 'TEXT'; text: string }
  | { type: 'BUTTONS'; text: string; options: ConversationOption[] }
  | { type: 'LIST'; text: string; options: ConversationOption[] };

export interface ConversationOutboundResponse {
  conversationId: string;
  state: ConversationState;
  messages: ConversationOutboundMessage[];
}
