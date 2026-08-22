import { z } from 'zod';

/**
 * Shared validation schemas for the Customer, Territory, Outlet & Retail Network domain
 * (Sprint 4.8), matching the API contracts in docs/domains/customers.md, outlets.md,
 * territories.md, and retail-network.md. Split into its own file, same "one file per
 * domain" convention as `production.ts`/`inventory.ts`/`catalogue.ts`.
 *
 * The enum schemas mirror `apps/api/prisma/schema.prisma`'s corresponding enums as plain
 * string literals rather than importing `@prisma/client` here — this package is shared by
 * `apps/web` too, same rationale as every other domain schema file.
 */

/**
 * A native `<select>` with an empty-string placeholder option (e.g. "Not set") always
 * has SOME value — an unselected picker submits `""`, not `undefined`. A plain
 * `z.string().min(1).optional()` rejects that `""` (`.optional()` only exempts
 * `undefined`, and `""` fails `.min(1)`), so every optional id picker in this file
 * preprocesses `""` to `undefined` first, making "no selection" behave the same whether
 * the field was touched or not.
 */
function optionalId() {
  return z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().min(1).optional(),
  );
}

/** Same `""` -> `undefined` coercion as {@link optionalId}, for the `PATCH` fields that
 *  also accept an explicit `null` to clear a previously-set value. An empty-string
 *  picker submission is treated as "unchanged" (`undefined`), not "clear it" (`null`) —
 *  clearing such a field, if ever needed, is a distinct explicit action. */
function optionalNullableId() {
  return z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().min(1).nullable().optional(),
  );
}

/** Same `""` -> `undefined` coercion, for the optional email field — an untouched text
 *  input defaulted to `''` (the "no value yet" convention every dialog in this codebase
 *  uses for optional text fields) would otherwise fail `.email()`, which — unlike
 *  `.min(1)` — has no length-zero exemption to rely on. */
function optionalEmail() {
  return z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().email('Enter a valid email address').optional(),
  );
}

/** Purely descriptive market intelligence — never a sales restriction (brief §6). */
export const customerTypeSchema = z.enum([
  'DISTRIBUTOR',
  'WHOLESALER',
  'RETAILER',
  'SUPERMARKET',
  'CORPORATE',
  'INSTITUTION',
  'RESTAURANT',
  'HOTEL',
  'OTHER',
]);
export type CustomerTypeInput = z.infer<typeof customerTypeSchema>;

export const customerStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export type CustomerStatusInput = z.infer<typeof customerStatusSchema>;

export const outletTypeSchema = z.enum([
  'SUPERMARKET',
  'HYPERMARKET',
  'WHOLESALE_STORE',
  'RETAIL_SHOP',
  'KIOSK',
  'MARKET_STALL',
  'DISTRIBUTOR_WAREHOUSE',
  'WHOLESALER_WAREHOUSE',
  'CONVENIENCE_STORE',
  'RESTAURANT',
  'HOTEL',
  'CORPORATE',
  'INSTITUTION',
  'OTHER',
]);
export type OutletTypeInput = z.infer<typeof outletTypeSchema>;

export const outletStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export type OutletStatusInput = z.infer<typeof outletStatusSchema>;

export const territoryStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export type TerritoryStatusInput = z.infer<typeof territoryStatusSchema>;

export const outletPhotoTypeSchema = z.enum([
  'FRONT',
  'SIGNAGE',
  'INTERIOR',
  'SHELF_DISPLAY',
  'OTHER',
]);
export type OutletPhotoTypeInput = z.infer<typeof outletPhotoTypeSchema>;

export const distributionRelationshipTypeSchema = z.enum([
  'DISTRIBUTES_TO',
  'WHOLESALES_TO',
  'SUPPLIES',
  'OTHER',
]);
export type DistributionRelationshipTypeInput = z.infer<typeof distributionRelationshipTypeSchema>;

export const networkRelationshipStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export type NetworkRelationshipStatusInput = z.infer<typeof networkRelationshipStatusSchema>;

/**
 * `POST /api/retail/territories`. `territoryCode`/`status` are absent — always
 * server-generated/defaulted `ACTIVE`. `parentTerritoryId` is optional — a territory may
 * be created as a root or nested under an existing one.
 */
export const createTerritorySchema = z.object({
  name: z.string().trim().min(1, 'Territory name is required').max(200),
  type: z.string().trim().min(1, 'Territory type is required').max(50),
  parentTerritoryId: optionalId(),
  description: z.string().trim().max(2000).optional(),
});
export type CreateTerritoryInput = z.infer<typeof createTerritorySchema>;

/**
 * `PATCH /api/retail/territories/:id` — every field optional. `parentTerritoryId` is
 * present (unlike most immutable-parent conventions elsewhere in this codebase) because
 * re-parenting a territory is a legitimate correction as an organisation refines its
 * structure; `.nullable()` lets a nested territory be promoted back to root. The service
 * guards against cycles — a self-referential FK cannot express "no cycles" declaratively.
 */
export const updateTerritorySchema = z.object({
  name: z.string().trim().min(1, 'Territory name is required').max(200).optional(),
  type: z.string().trim().min(1, 'Territory type is required').max(50).optional(),
  parentTerritoryId: optionalNullableId(),
  description: z.string().trim().max(2000).optional(),
  status: territoryStatusSchema.optional(),
});
export type UpdateTerritoryInput = z.infer<typeof updateTerritorySchema>;

/**
 * `POST /api/retail/customers` (Sprint 4.8 brief §7 "Progressive Customer Onboarding").
 * Only `customerType`/`customerName`/`phoneNumber` are required — this three-field
 * minimum is the exact enforcement point for the "onboard a customer in roughly 1-2
 * minutes" requirement. Every other field, including `territoryId`, is optional and may
 * be added later via `PATCH`. `customerCode`/`status` are absent — always
 * server-generated/defaulted `ACTIVE`.
 */
export const createCustomerSchema = z.object({
  customerType: customerTypeSchema,
  customerName: z.string().trim().min(1, 'Customer name is required').max(200),
  phoneNumber: z.string().trim().min(1, 'Phone number is required').max(30),
  contactPersonName: z.string().trim().max(200).optional(),
  alternatePhoneNumber: z.string().trim().max(30).optional(),
  email: optionalEmail(),
  address: z.string().trim().max(500).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  country: z.string().trim().max(100).optional(),
  territoryId: optionalId(),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

/** `PATCH /api/retail/customers/:id` — every field optional; `customerCode`/`status`
 *  absent (status changes only via the activate/deactivate endpoints). */
export const updateCustomerSchema = z.object({
  customerType: customerTypeSchema.optional(),
  customerName: z.string().trim().min(1, 'Customer name is required').max(200).optional(),
  phoneNumber: z.string().trim().min(1, 'Phone number is required').max(30).optional(),
  contactPersonName: z.string().trim().max(200).optional(),
  alternatePhoneNumber: z.string().trim().max(30).optional(),
  email: optionalEmail(),
  address: z.string().trim().max(500).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  country: z.string().trim().max(100).optional(),
  territoryId: optionalNullableId(),
  notes: z.string().trim().max(2000).optional(),
});
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

/**
 * `POST /api/retail/outlets` (Sprint 4.8 brief §8). Required: `customerId`, `outletType`,
 * `name`. Coordinates are optional and must be supplied together — one without the other
 * is meaningless. No coordinates are ever required at onboarding (brief: "Do not require
 * GPS").
 */
export const createOutletSchema = z
  .object({
    customerId: z.string().trim().min(1, 'Customer is required'),
    outletType: outletTypeSchema,
    name: z.string().trim().min(1, 'Outlet name is required').max(200),
    contactPersonName: z.string().trim().max(200).optional(),
    phoneNumber: z.string().trim().max(30).optional(),
    address: z.string().trim().max(500).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    country: z.string().trim().max(100).optional(),
    territoryId: optionalId(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((data) => (data.latitude === undefined) === (data.longitude === undefined), {
    message: 'Latitude and longitude must be provided together',
    path: ['longitude'],
  });
export type CreateOutletInput = z.infer<typeof createOutletSchema>;

/** `PATCH /api/retail/outlets/:id` — `customerId`/`outletCode`/`status` absent; an
 *  outlet's owning customer is immutable after creation (service-enforced) since moving
 *  it would rewrite sales-order attribution. */
export const updateOutletSchema = z
  .object({
    outletType: outletTypeSchema.optional(),
    name: z.string().trim().min(1, 'Outlet name is required').max(200).optional(),
    contactPersonName: z.string().trim().max(200).optional(),
    phoneNumber: z.string().trim().max(30).optional(),
    address: z.string().trim().max(500).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    country: z.string().trim().max(100).optional(),
    territoryId: optionalNullableId(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((data) => (data.latitude == null) === (data.longitude == null), {
    message: 'Latitude and longitude must be provided together',
    path: ['longitude'],
  });
export type UpdateOutletInput = z.infer<typeof updateOutletSchema>;

/** `POST /api/retail/outlets/:id/photos` — multipart text fields alongside the uploaded
 *  files; the files themselves are validated server-side by the existing
 *  `assertValidImageFile` helper, not by this schema. */
export const addOutletPhotosSchema = z.object({
  photoType: outletPhotoTypeSchema.optional(),
  caption: z.string().trim().max(200).optional(),
});
export type AddOutletPhotosInput = z.infer<typeof addOutletPhotosSchema>;

/**
 * `POST /api/retail/network-relationships` (Sprint 4.8 brief §13/§14). A relationship is
 * entirely optional intelligence/coordination data — creating one never affects any
 * existing or future `SalesOrder`.
 */
export const createNetworkRelationshipSchema = z
  .object({
    sourceCustomerId: z.string().trim().min(1, 'Source customer is required'),
    targetCustomerId: z.string().trim().min(1, 'Target customer is required'),
    relationshipType: distributionRelationshipTypeSchema,
    effectiveFrom: z.coerce.date().optional(),
    effectiveTo: z.coerce.date().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((data) => data.sourceCustomerId !== data.targetCustomerId, {
    message: 'A customer cannot supply itself',
    path: ['targetCustomerId'],
  })
  .refine(
    (data) => !data.effectiveTo || !data.effectiveFrom || data.effectiveTo >= data.effectiveFrom,
    {
      message: 'Effective-to date cannot be before the effective-from date',
      path: ['effectiveTo'],
    },
  );
export type CreateNetworkRelationshipInput = z.infer<typeof createNetworkRelationshipSchema>;

/** `PATCH /api/retail/network-relationships/:id` — `sourceCustomerId`/`targetCustomerId`/
 *  `relationshipType` are deliberately absent: changing an endpoint would rewrite the
 *  network's history. Deactivate the relationship and create a new one instead. */
export const updateNetworkRelationshipSchema = z
  .object({
    effectiveFrom: z.coerce.date().optional(),
    effectiveTo: z.coerce.date().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine(
    (data) => !data.effectiveTo || !data.effectiveFrom || data.effectiveTo >= data.effectiveFrom,
    {
      message: 'Effective-to date cannot be before the effective-from date',
      path: ['effectiveTo'],
    },
  );
export type UpdateNetworkRelationshipInput = z.infer<typeof updateNetworkRelationshipSchema>;
