import { apiFetch } from '@/lib/api-client';

/**
 * Sprint 44 — Tenant D2C Conversation Configuration (docs/domains/d2c.md "Tenant
 * Conversation Configuration"). Its own API client — the established "each area owns
 * its own client" convention this codebase already uses (see `d2c/api.ts`'s own doc
 * comment), kept separate from `conversation/api.ts` (the interactive Tester) and
 * `conversations/` (the read-only transcript viewer).
 */

export type D2CConversationCapability =
  'ORDER_SNACKS' | 'MY_ORDERS' | 'MY_REWARDS' | 'MY_ACCOUNT' | 'UPDATE_LOCATION' | 'HELP';

export type D2CConversationMessageKey =
  | 'WELCOME'
  | 'MAIN_MENU_PROMPT'
  | 'HELP'
  | 'UNKNOWN_COMMAND'
  | 'ASK_NAME'
  | 'REGISTRATION_COMPLETE'
  | 'LOCATION_UPDATED'
  | 'ASK_QUANTITY'
  | 'ORDER_CREATED'
  | 'PAYMENT_SUCCESS'
  | 'MY_ORDERS_EMPTY'
  | 'READY_FOR_COLLECTION'
  | 'COLLECTION_CONFIRMED'
  | 'ORDER_CANCELLED';

export interface D2CConversationConfigView {
  organisationId: string;
  businessName: string;
  supportPhone: { value: string | null; isCustomized: boolean };
  supportEmail: { value: string | null; isCustomized: boolean };
  capabilities: {
    capability: D2CConversationCapability;
    enabled: boolean;
    displayLabel: string;
    isLabelCustomized: boolean;
    sortOrder: number;
  }[];
  messages: {
    messageKey: D2CConversationMessageKey;
    value: string;
    defaultValue: string;
    isCustomized: boolean;
    allowedVariables: string[];
  }[];
}

export interface D2CConversationPreview {
  messages: (
    | { type: 'TEXT'; text: string }
    | { type: 'BUTTONS'; text: string; options: { value: string; label: string }[] }
  )[];
}

export function getD2CConversationConfig(): Promise<D2CConversationConfigView> {
  return apiFetch<D2CConversationConfigView>('/d2c/conversation-config');
}

export function getD2CConversationPreview(): Promise<D2CConversationPreview> {
  return apiFetch<D2CConversationPreview>('/d2c/conversation-config/preview');
}

export function updateD2CConversationProfile(input: {
  supportPhone?: string | null;
  supportEmail?: string | null;
}): Promise<D2CConversationConfigView> {
  return apiFetch<D2CConversationConfigView>('/d2c/conversation-config/profile', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function updateD2CConversationCapabilities(
  capabilities: {
    capability: D2CConversationCapability;
    enabled: boolean;
    displayLabel?: string | null;
    sortOrder: number;
  }[],
): Promise<D2CConversationConfigView> {
  return apiFetch<D2CConversationConfigView>('/d2c/conversation-config/capabilities', {
    method: 'PUT',
    body: JSON.stringify({ capabilities }),
  });
}

export function updateD2CConversationMessage(
  messageKey: D2CConversationMessageKey,
  value: string,
): Promise<D2CConversationConfigView> {
  return apiFetch<D2CConversationConfigView>(`/d2c/conversation-config/messages/${messageKey}`, {
    method: 'PUT',
    body: JSON.stringify({ value }),
  });
}

export function resetD2CConversationMessage(
  messageKey: D2CConversationMessageKey,
): Promise<D2CConversationConfigView> {
  return apiFetch<D2CConversationConfigView>(
    `/d2c/conversation-config/messages/${messageKey}/reset`,
    { method: 'PUT' },
  );
}
