/**
 * Audit action strings for tenant D2C conversation configuration (Sprint 44,
 * docs/domains/d2c.md "Tenant Conversation Configuration"). Same `<entity>.<event>`
 * naming convention as every other domain's `*_AUDIT_ACTIONS`.
 */
export const D2C_CONVERSATION_CONFIG_AUDIT_ACTIONS = {
  PROFILE_UPDATED: 'd2c_conversation_config.profile_updated',
  CAPABILITIES_UPDATED: 'd2c_conversation_config.capabilities_updated',
  MESSAGE_UPDATED: 'd2c_conversation_config.message_updated',
  MESSAGE_RESET: 'd2c_conversation_config.message_reset',
} as const;
