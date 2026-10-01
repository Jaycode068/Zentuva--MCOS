import { z } from 'zod';

/**
 * Sprint 32 — Consumer Identity, Territory & Location Foundation
 * (docs/domains/d2c.md). One shared-file-per-domain, matching every other
 * domain schema file's own convention. `consumerCode`/`normalizedPhone`/
 * `status` are never accepted from a client — always server-generated/
 * server-derived/server-defaulted.
 */

function optionalId() {
  return z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().min(1).optional(),
  );
}

function optionalNullableId() {
  return z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().min(1).nullable().optional(),
  );
}

function optionalEmail() {
  return z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().email('Must be a valid email address').optional(),
  );
}

export const consumerStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'INACTIVE']);
export type ConsumerStatusInput = z.infer<typeof consumerStatusSchema>;

/**
 * `POST /d2c/consumers` — internal/admin registration surface, and the same
 * shape a future channel adapter's call into `ConsumerService.registerConsumer`
 * would use. Only `fullName`/`phoneNumber` are required — territory/location
 * is very often not known yet at first contact (brief §7's "phone first,
 * location later" flow).
 */
export const registerConsumerSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(200),
  phoneNumber: z.string().trim().min(1, 'Phone number is required').max(30),
  email: optionalEmail(),
  territoryId: optionalId(),
  address: z.string().trim().max(500).optional(),
  marketingOptIn: z.boolean().optional(),
});
export type RegisterConsumerInput = z.infer<typeof registerConsumerSchema>;

/** `PATCH /d2c/consumers/:id` — profile fields only; `territoryId` has its
 *  own dedicated endpoint (`updateConsumerLocationSchema`) since a location
 *  change is a distinct, separately-audited event (docs/domains/d2c.md §6),
 *  not an incidental side effect of a general profile edit. `phoneNumber`
 *  is intentionally excluded — changing the identity phone is a bigger
 *  operation than this sprint's scope (re-normalization, re-uniqueness,
 *  potential merge) and is deliberately deferred. */
export const updateConsumerProfileSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(200).optional(),
  email: optionalEmail(),
  address: z.string().trim().max(500).optional(),
  marketingOptIn: z.boolean().optional(),
});
export type UpdateConsumerProfileInput = z.infer<typeof updateConsumerProfileSchema>;

/** `PATCH /d2c/consumers/:id/location` — `territoryId: null` explicitly
 *  clears a previously-selected location (e.g. an internal correction). */
export const updateConsumerLocationSchema = z.object({
  territoryId: optionalNullableId(),
});
export type UpdateConsumerLocationInput = z.infer<typeof updateConsumerLocationSchema>;

/**
 * `POST /d2c/consumers/:id/location-requests` (docs/domains/d2c.md §6 "I
 * can't find my location"). `rawLocationText` is captured as non-
 * authoritative context only — never parsed, never turned into a `Territory`
 * automatically.
 */
export const createConsumerLocationRequestSchema = z.object({
  rawLocationText: z.string().trim().min(1, 'Please describe the location').max(500),
});
export type CreateConsumerLocationRequestInput = z.infer<
  typeof createConsumerLocationRequestSchema
>;

export const resolveConsumerLocationRequestSchema = z.object({
  resolutionNotes: z.string().trim().max(1000).optional(),
});
export type ResolveConsumerLocationRequestInput = z.infer<
  typeof resolveConsumerLocationRequestSchema
>;

// ---------------------------------------------------------------------------
// Sprint 33 — Consumer Conversation Experience Foundation
// (docs/domains/d2c.md §"Conversation Contract"). The typed inbound half of
// the Channel Adapter <-> Conversation Layer contract — the exact shape a
// future WhatsApp adapter (translating a WhatsApp message/button/list reply)
// and the Sprint 42 simulator are both expected to submit, unchanged. The
// outbound half (`ConversationOutboundResponse`) is server-constructed, not
// client-submitted, so it is a plain TypeScript type in
// `apps/api/src/d2c/conversation/conversation.types.ts` rather than a Zod
// schema here — nothing validates a shape the server itself produces.
// ---------------------------------------------------------------------------

export const conversationChannelSchema = z.enum(['WHATSAPP']);
export type ConversationChannelInput = z.infer<typeof conversationChannelSchema>;

/** A discriminated union, not a generic `{type: string; value: string}` —
 *  `TEXT` carries free text, `BUTTON`/`LIST_SELECTION` carry a short,
 *  already-known option value (never a WhatsApp-specific payload shape;
 *  translating an actual WhatsApp interactive-message reply into one of
 *  these three is the future adapter's own job, not this schema's). */
export const conversationInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TEXT'), text: z.string().trim().min(1).max(1000) }),
  z.object({ type: z.literal('BUTTON'), value: z.string().trim().min(1).max(100) }),
  z.object({ type: z.literal('LIST_SELECTION'), value: z.string().trim().min(1).max(100) }),
]);
export type ConversationInput = z.infer<typeof conversationInputSchema>;

/**
 * `POST /d2c/conversations/messages` — this sprint's internal test-harness
 * surface for the conversation contract (docs/domains/d2c.md §"Public
 * Security" — deliberately internal/authenticated this sprint, never a
 * public unauthenticated endpoint, since no real WhatsApp webhook exists
 * yet to receive). `organisationId` is never part of this payload — the
 * controller always derives it from the caller's own authenticated session,
 * exactly like every other internal endpoint in this codebase.
 */
export const sendConversationMessageSchema = z.object({
  channel: conversationChannelSchema.default('WHATSAPP'),
  externalConversationId: z.string().trim().min(1, 'externalConversationId is required').max(64),
  input: conversationInputSchema,
});
export type SendConversationMessageInput = z.infer<typeof sendConversationMessageSchema>;

// ---------------------------------------------------------------------------
// Sprint 37 — Collection Point Fulfillment (docs/domains/d2c.md).
// ---------------------------------------------------------------------------

/**
 * `POST /d2c/collection-point-fulfillments/assign` — the manual/admin fallback path
 * (brief §4 "D2C Order -> Collection Point Assignment"). Automatic assignment
 * (`D2CPaymentService`'s own success path, no HTTP schema needed) is the primary path;
 * this exists only for the case where no eligible Collection Point existed at payment
 * time, or an admin wants to assign a SPECIFIC outlet rather than the auto-selected one.
 * `outletId` is optional — omitted, the server re-runs the same territory-match
 * auto-selection; supplied, the server validates THAT specific outlet's eligibility
 * instead of auto-selecting.
 */
export const assignCollectionPointSchema = z.object({
  salesOrderId: z.string().trim().min(1, 'salesOrderId is required'),
  outletId: z.string().trim().min(1).optional(),
});
export type AssignCollectionPointInput = z.infer<typeof assignCollectionPointSchema>;
