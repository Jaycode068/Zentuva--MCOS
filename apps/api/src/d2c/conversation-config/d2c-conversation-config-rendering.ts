import {
  ConversationOption,
  ConversationOutboundMessage,
} from '../conversation/conversation.types';
import {
  D2CConversationCapabilityKey,
  EffectiveConversationConfig,
  MESSAGE_VARIABLE_ALLOWLIST,
} from './d2c-conversation-config.types';

/**
 * Sprint 44 — Tenant D2C Conversation Configuration (docs/domains/d2c.md "Tenant
 * Conversation Configuration," brief §Phase 14/30 "no second rendering
 * implementation"). Pure functions, no I/O — both the REAL `ConversationService` and
 * the admin preview endpoint call these exact same functions against the exact same
 * {@link EffectiveConversationConfig}, so a preview can never show something the real
 * conversation wouldn't actually send.
 */

/** Substitutes only the variables a message key's own allowlist permits
 * (`MESSAGE_VARIABLE_ALLOWLIST`) — anything else matching `{{...}}` is left completely
 * untouched (never silently blanked, never arbitrary property access; brief §Phase 9).
 * `variables` is always a plain, already-resolved `{name: string|number}` map the
 * CALLER computed — never a live domain object passed through for dotted-path access. */
export function renderConversationMessage(
  messageKey: keyof typeof MESSAGE_VARIABLE_ALLOWLIST,
  template: string,
  variables: Record<string, string | number>,
): string {
  const allowed = new Set(MESSAGE_VARIABLE_ALLOWLIST[messageKey]);
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    if (!allowed.has(name)) return match;
    const value = variables[name];
    return value === undefined ? match : String(value);
  });
}

export function isCapabilityEnabled(
  config: EffectiveConversationConfig,
  capability: D2CConversationCapabilityKey,
): boolean {
  return config.capabilities.some((c) => c.capability === capability && c.enabled);
}

/** Brief §Phase 11 — the "Are you already registered?" prompt. Always a `BUTTONS`
 *  message with the same two fixed options (`YES_CONTINUE`/`REGISTER`) — those two
 *  option VALUES are never tenant-configurable (they are internal routing commands, not
 *  customer-facing capabilities), only the prompt TEXT above them is. */
export function buildWelcomeMessage(
  config: EffectiveConversationConfig,
): ConversationOutboundMessage {
  return {
    type: 'BUTTONS',
    text: renderConversationMessage('WELCOME', config.messages.WELCOME, {
      businessName: config.businessName,
    }),
    options: [
      { value: 'YES_CONTINUE', label: 'Yes, continue' },
      { value: 'REGISTER', label: 'Register' },
    ],
  };
}

/** Brief §Phase 7/12 — the main menu, built ONLY from enabled capabilities, in
 *  `sortOrder`. A disabled capability simply never appears — never shown as a greyed-out
 *  option, matching the brief's own "it must disappear from the menu" requirement. */
export function buildMainMenuMessages(
  config: EffectiveConversationConfig,
): ConversationOutboundMessage[] {
  const options: ConversationOption[] = config.capabilities
    .filter((c) => c.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => ({ value: c.capability, label: c.displayLabel }));

  return [
    {
      type: 'BUTTONS',
      text: config.messages.MAIN_MENU_PROMPT,
      options,
    },
  ];
}

export function buildHelpMessage(config: EffectiveConversationConfig): ConversationOutboundMessage {
  return {
    type: 'TEXT',
    text: renderConversationMessage('HELP', config.messages.HELP, {
      businessName: config.businessName,
      supportPhone: config.supportPhone ?? 'not available',
      supportEmail: config.supportEmail ?? 'not available',
    }),
  };
}
