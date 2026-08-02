import { z } from 'zod';

/**
 * Shared validation schemas for the Supplier Management domain (Sprint 4.2), matching the
 * API contract in docs/domains/suppliers.md. Split into its own file (not appended to
 * identity.ts or catalogue.ts) since Supplier Management is a distinct domain module
 * (ADR-002) — same "one file per domain" convention `catalogue.ts` established.
 *
 * The enum schemas mirror `apps/api/prisma/schema.prisma`'s `SupplierCategory`/
 * `SupplierStatus` as plain string literals rather than importing `@prisma/client` here —
 * this package is shared by `apps/web` too, same rationale as `identity.ts`/`catalogue.ts`.
 */

export const supplierCategorySchema = z.enum([
  'RAW_MATERIAL',
  'PACKAGING',
  'LOGISTICS',
  'MAINTENANCE',
  'UTILITY',
  'SERVICE',
  'OTHER',
]);
export type SupplierCategoryInput = z.infer<typeof supplierCategorySchema>;

export const supplierStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export type SupplierStatusInput = z.infer<typeof supplierStatusSchema>;

/**
 * `POST /api/suppliers` (Sprint 4.2 brief). `supplierCode` is deliberately absent — always
 * server-generated, immutable, never accepted on input (brief: "Automatically generate...
 * Must be immutable"). Unlike the Product Catalogue, `status` IS accepted directly here —
 * the brief lists "Status" as a Create/Edit dialog field rather than routing status
 * changes through dedicated activate/archive endpoints, so a new supplier can be created
 * straight into `INACTIVE` if needed; it defaults to `ACTIVE` (the Prisma column default)
 * when omitted.
 */
export const createSupplierSchema = z.object({
  supplierName: z.string().trim().min(1, 'Supplier name is required').max(200),
  displayName: z.string().trim().max(200).optional(),
  contactPerson: z.string().trim().max(200).optional(),
  email: z.string().trim().email('Enter a valid email address').optional().or(z.literal('')),
  phoneNumber: z.string().trim().max(50).optional(),
  website: z.string().trim().url('Enter a valid URL').optional().or(z.literal('')),
  country: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  address: z.string().trim().max(500).optional(),
  taxIdentificationNumber: z.string().trim().max(100).optional(),
  supplierCategory: supplierCategorySchema,
  notes: z.string().trim().max(2000).optional(),
  status: supplierStatusSchema.optional(),
});
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;

/** `PATCH /api/suppliers/:id` (Sprint 4.2 brief) — every field optional, same "partial
 *  update" convention as `updateProductSchema`/`updateUserSchema`. `supplierCode` is
 *  absent for the same reason as {@link createSupplierSchema}. A `status` change here is
 *  what the brief's "Activate and deactivate suppliers" describes — there are no separate
 *  activate/archive endpoints (unlike Product Catalogue); the controller records
 *  `supplier.activated`/`supplier.deactivated` instead of `supplier.updated` when this
 *  field is present, same pattern as `UserController`'s `resolveUpdateAuditAction`. */
export const updateSupplierSchema = z.object({
  supplierName: z.string().trim().min(1, 'Supplier name is required').max(200).optional(),
  displayName: z.string().trim().max(200).optional(),
  contactPerson: z.string().trim().max(200).optional(),
  email: z.string().trim().email('Enter a valid email address').optional().or(z.literal('')),
  phoneNumber: z.string().trim().max(50).optional(),
  website: z.string().trim().url('Enter a valid URL').optional().or(z.literal('')),
  country: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  city: z.string().trim().max(100).optional(),
  address: z.string().trim().max(500).optional(),
  taxIdentificationNumber: z.string().trim().max(100).optional(),
  supplierCategory: supplierCategorySchema.optional(),
  notes: z.string().trim().max(2000).optional(),
  status: supplierStatusSchema.optional(),
});
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
