import { apiFetch } from '@/lib/api-client';

/**
 * Sprint 33 — Consumer Conversation Experience Foundation
 * (docs/domains/d2c.md). Internal test-harness API client only — the
 * exact call shape a future WhatsApp adapter/Sprint 42 simulator would use
 * against `ConversationService` directly, not through this HTTP surface.
 */

export type ConversationState =
  'NEW' | 'REGISTRATION' | 'LOCATION_SELECTION' | 'MAIN_MENU' | 'ACTIVE';

export interface ConversationOption {
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

export type ConversationInput =
  | { type: 'TEXT'; text: string }
  | { type: 'BUTTON'; value: string }
  | { type: 'LIST_SELECTION'; value: string };

export interface Conversation {
  id: string;
  channel: 'WHATSAPP';
  externalConversationId: string;
  consumerId: string | null;
  state: ConversationState;
  status: string;
  lastInteractionAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  payload: unknown;
  createdAt: string;
}

export function listConversations(): Promise<{ items: Conversation[] }> {
  return apiFetch<{ items: Conversation[] }>('/d2c/conversations');
}

export function getConversation(
  id: string,
): Promise<{ conversation: Conversation; messages: ConversationMessage[] }> {
  return apiFetch(`/d2c/conversations/${id}`);
}

export function sendConversationMessage(
  externalConversationId: string,
  input: ConversationInput,
): Promise<ConversationOutboundResponse> {
  return apiFetch<ConversationOutboundResponse>('/d2c/conversations/messages', {
    method: 'POST',
    body: JSON.stringify({ channel: 'WHATSAPP', externalConversationId, input }),
  });
}
