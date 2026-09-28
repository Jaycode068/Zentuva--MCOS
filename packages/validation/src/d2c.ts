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
