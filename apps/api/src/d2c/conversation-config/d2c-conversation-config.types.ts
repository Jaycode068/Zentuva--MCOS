import { D2CConversationCapability, D2CConversationMessageKey } from '@prisma/client';

/**
 * Sprint 44 — Tenant D2C Conversation Configuration (docs/domains/d2c.md "Tenant
 * Conversation Configuration"). The channel-neutral contract between the config
 * resolver and `ConversationService`/`CollectionPointFulfillmentService` — carries
 * only business intent and customer-facing content, never anything WhatsApp/Meta-
 * specific (brief §Phase 16 "Preserve Channel Neutrality"). A future non-WhatsApp
 * channel adapter would consume the exact same shape.
 */

/** Re-exported so callers never need to import `@prisma/client` directly just to name a
 *  capability/message key — matches this codebase's existing convention of re-exporting
 *  Prisma enums from a domain's own types file. */
export type D2CConversationCapabilityKey = D2CConversationCapability;
export type D2CConversationMessageKeyValue = D2CConversationMessageKey;

export interface EffectiveConversationCapability {
  capability: D2CConversationCapabilityKey;
  enabled: boolean;
  /** Always resolved — the tenant's override if customized, otherwise the platform
   *  default label. Never `null`/`undefined`; a renderer never has to fall back itself. */
  displayLabel: string;
  sortOrder: number;
}

/**
 * The one object `ConversationService`/`CollectionPointFulfillmentService` consume —
 * resolved ONCE per inbound message (brief §Phase 15 "expose immutable effective
 * configuration"). Never mutated after resolution; a later configuration change is only
 * ever picked up on the NEXT resolution, never retroactively applied to an
 * already-in-flight response (brief §Phase 22 "configuration changes affect future
 * presentation, not an in-progress response").
 */
export interface EffectiveConversationConfig {
  organisationId: string;
  /** Always `Organisation.displayName ?? Organisation.name` — never duplicated storage,
   *  never stale relative to the tenant's real identity (see
   *  `D2CConversationProfile`'s own schema doc comment). */
  businessName: string;
  supportPhone: string | null;
  supportEmail: string | null;
  /** Every platform capability, `enabled` ones usable for display — already sorted by
   *  `sortOrder`. A disabled capability is still present here (never silently dropped)
   *  so an admin UI/preview can show "disabled" explicitly, but
   *  `buildMainMenuMessages` only ever renders the enabled ones. */
  capabilities: EffectiveConversationCapability[];
  /** Every message key, always resolved to a non-empty string (tenant override or
   *  platform default) — a raw template that may still contain `{{variable}}`
   *  placeholders; rendering happens at the call site via {@link renderConversationMessage}
   *  with that key's own specific variable values. */
  messages: Record<D2CConversationMessageKeyValue, string>;
}

/** Brief §Phase 6 — the platform default label for each capability, exactly the labels
 *  `ConversationService.mainMenuMessages()` already hardcoded before this sprint (never
 *  changed, only made overridable). */
export const DEFAULT_CAPABILITY_LABELS: Record<D2CConversationCapabilityKey, string> = {
  ORDER_SNACKS: '🛒 Order Snacks',
  MY_ORDERS: '📦 My Orders',
  MY_REWARDS: '⭐ My Rewards',
  MY_ACCOUNT: '👤 My Account',
  UPDATE_LOCATION: '📍 Update My Location',
  HELP: '❓ Help',
};

/** Brief §Phase 6/7 — the platform default menu order, exactly the order
 *  `mainMenuMessages()` already hardcoded. A tenant's own `sortOrder` override replaces
 *  this; ties break by this same default order for determinism. */
export const DEFAULT_CAPABILITY_ORDER: D2CConversationCapabilityKey[] = [
  'ORDER_SNACKS',
  'MY_ORDERS',
  'MY_REWARDS',
  'MY_ACCOUNT',
  'UPDATE_LOCATION',
  'HELP',
];

/** Every platform capability is enabled by default — a newly onboarded tenant sees the
 *  full existing menu unchanged until they deliberately customize it (brief §Phase 26
 *  "safe tenant onboarding"). */
export const DEFAULT_CAPABILITY_ENABLED: Record<D2CConversationCapabilityKey, boolean> = {
  ORDER_SNACKS: true,
  MY_ORDERS: true,
  MY_REWARDS: true,
  MY_ACCOUNT: true,
  UPDATE_LOCATION: true,
  HELP: true,
};

/** Brief §Phase 4/8 — the platform default text for every configurable message key,
 *  extracted VERBATIM from `ConversationService`'s own pre-Sprint-44 hardcoded strings
 *  (never reworded) so an unconfigured tenant's conversation is byte-for-byte identical
 *  to how it behaved before this sprint. `{{businessName}}` etc. are the only
 *  placeholders ever present — see `MESSAGE_VARIABLE_ALLOWLIST` below for exactly which
 *  variables each key may use. */
export const DEFAULT_MESSAGES: Record<D2CConversationMessageKeyValue, string> = {
  WELCOME: 'Welcome to {{businessName}} 👋\n\nAre you already registered?',
  MAIN_MENU_PROMPT: 'What would you like to do?',
  HELP: 'You can view your account, update your location, or type MENU any time to return here.',
  UNKNOWN_COMMAND: "Sorry, I didn't understand that.",
  ASK_NAME: "What's your name?",
  REGISTRATION_COMPLETE: "You're registered 🎉\n\nConsumer ID: {{consumerCode}}",
  LOCATION_UPDATED: 'Your location has been updated.',
  ASK_QUANTITY: 'How many would you like?',
  ORDER_CREATED:
    'Order created successfully.\n\nOrder: {{orderCode}}\nAmount: {{currency}} {{total}}\nStatus: {{status}}\n\nPayment is required before we can process your order.',
  PAYMENT_SUCCESS: 'Payment successful.\nYour order {{orderCode}} has been paid.',
  MY_ORDERS_EMPTY: "You haven't placed any orders yet.",
  READY_FOR_COLLECTION:
    '✅ Your order is ready!\n\nOrder: #{{orderCode}}\n\nYour order is ready for collection at:\n\n{{collectionPointName}}\n{{collectionPointAddress}}\n{{collectionPointHours}}\n\nPlease present your order number when you arrive.\n\nThank you for choosing {{businessName}}.',
  COLLECTION_CONFIRMED:
    '✅ Order collected!\n\nOrder: #{{orderCode}}\n\nThank you for choosing {{businessName}}.\n\nWe hope you enjoy your order! 😊',
  ORDER_CANCELLED: 'Order cancelled.',
};

/**
 * Brief §Phase 9 "Template Variable Safety" — an explicit, closed allowlist PER message
 * key. `renderConversationMessage` only ever substitutes a variable present in a
 * message's own allowlist; anything else in a saved template is rejected at validation
 * time (`D2CConversationConfigService.validateMessageValue`) and, as defense in depth,
 * left untouched (not silently blanked) if it ever reached render time regardless. No
 * variable here is ever a live object/record reference — every value passed to the
 * renderer is a plain, already-resolved string/number the CALLER computed, never
 * `{{order.total}}`-style property-path access into a domain entity (brief: "Do NOT
 * permit arbitrary property access").
 */
export const MESSAGE_VARIABLE_ALLOWLIST: Record<D2CConversationMessageKeyValue, string[]> = {
  WELCOME: ['businessName'],
  MAIN_MENU_PROMPT: [],
  HELP: ['businessName', 'supportPhone', 'supportEmail'],
  UNKNOWN_COMMAND: [],
  ASK_NAME: [],
  REGISTRATION_COMPLETE: ['consumerCode'],
  LOCATION_UPDATED: [],
  ASK_QUANTITY: [],
  ORDER_CREATED: ['orderCode', 'currency', 'total', 'status'],
  PAYMENT_SUCCESS: ['orderCode'],
  MY_ORDERS_EMPTY: [],
  READY_FOR_COLLECTION: [
    'orderCode',
    'collectionPointName',
    'collectionPointAddress',
    'collectionPointHours',
    'businessName',
  ],
  COLLECTION_CONFIRMED: ['orderCode', 'businessName'],
  ORDER_CANCELLED: [],
};

export const ALL_CAPABILITIES: D2CConversationCapabilityKey[] = DEFAULT_CAPABILITY_ORDER;
export const ALL_MESSAGE_KEYS: D2CConversationMessageKeyValue[] = Object.keys(
  DEFAULT_MESSAGES,
) as D2CConversationMessageKeyValue[];
