import { z } from 'zod';

/**
 * Shared validation schemas for the Product Catalogue domain (Sprint 4.1), matching the
 * API contract in docs/domains/catalogue.md. Split into its own file (not appended to
 * identity.ts) since Catalogue is a separate domain module (ADR-002) — same "one file per
 * domain" split the rest of `packages/validation` will grow into as more business domains
 * are built.
 *
 * The enum schemas mirror `apps/api/prisma/schema.prisma`'s `ProductCategory`/
 * `ProductType`/`ProductStatus` as plain string literals rather than importing
 * `@prisma/client` here — this package is shared by `apps/web` too, which has no business
 * depending on the generated Prisma client (same convention as identity.ts).
 */

export const productCategorySchema = z.enum([
  'SNACKS',
  'BEVERAGE',
  'WATER',
  'CONFECTIONERY',
  'RAW_MATERIALS',
  'PACKAGING',
  'OTHERS',
]);
export type ProductCategoryInput = z.infer<typeof productCategorySchema>;

export const productTypeSchema = z.enum(['FINISHED_PRODUCT', 'RAW_MATERIAL', 'PACKAGING_MATERIAL']);
export type ProductTypeInput = z.infer<typeof productTypeSchema>;

export const productStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'ARCHIVED']);
export type ProductStatusInput = z.infer<typeof productStatusSchema>;

/** Suggested Unit of Measure values (Sprint 4.1 brief) — `Product.unit` is a free-text
 *  column (same convention as `Organisation.currency`), this list only drives the
 *  frontend's dropdown, it is not enforced here. */
export const PRODUCT_UNIT_SUGGESTIONS = [
  'Piece',
  'Pack',
  'Carton',
  'Bottle',
  'Sachet',
  'Kilogram',
  'Gram',
  'Litre',
] as const;

/**
 * `POST /api/products` (Sprint 4.1 brief). `code` is deliberately absent — always
 * server-generated, never accepted on input (brief: "Generated automatically", "Never
 * editable"). `status` is also absent — new products always start `DRAFT` (brief:
 * "Status defaults to Draft"); reaching `ACTIVE`/`ARCHIVED` goes through the dedicated
 * `POST /api/products/:id/activate`/`archive` endpoints, not this one, so status
 * transitions stay centrally validated in one place (`ProductService`).
 */
export const createProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required').max(200),
  displayName: z.string().trim().max(200).optional(),
  category: productCategorySchema,
  type: productTypeSchema,
  unit: z.string().trim().min(1, 'Unit is required').max(50),
  shortDescription: z.string().trim().max(500).optional(),
  longDescription: z.string().trim().max(5000).optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

/** `PATCH /api/products/:id` (Sprint 4.1 brief) — every field optional, same "partial
 *  update" convention as `updateUserSchema`/`updateOrganisationProfileSchema`. `code` and
 *  `status` are absent for the same reasons as {@link createProductSchema}. */
export const updateProductSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required').max(200).optional(),
  displayName: z.string().trim().max(200).optional(),
  category: productCategorySchema.optional(),
  type: productTypeSchema.optional(),
  unit: z.string().trim().min(1, 'Unit is required').max(50).optional(),
  shortDescription: z.string().trim().max(500).optional(),
  longDescription: z.string().trim().max(5000).optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
