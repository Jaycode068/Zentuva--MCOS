import { z } from 'zod';

/**
 * Shared validation schemas for the Production & Bill of Materials domain (Sprint 4.6),
 * matching the API contract in docs/domains/production.md. Split into its own file, same
 * "one file per domain" convention as `inventory.ts`/`procurement.ts`/`suppliers.ts`.
 *
 * The enum schemas mirror `apps/api/prisma/schema.prisma`'s `BillOfMaterialStatus`/
 * `ProductionOrderStatus`/`ProductionRejectionReason` as plain string literals rather
 * than importing `@prisma/client` here — this package is shared by `apps/web` too, same
 * rationale as every other domain schema file.
 */

export const billOfMaterialStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'INACTIVE']);
export type BillOfMaterialStatusInput = z.infer<typeof billOfMaterialStatusSchema>;

export const productionOrderStatusSchema = z.enum([
  'DRAFT',
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
]);
export type ProductionOrderStatusInput = z.infer<typeof productionOrderStatusSchema>;

/** Sprint 4.6 brief §17 — a simple structured reason for rejected production output, not
 *  a full Quality Management System. */
export const productionRejectionReasonSchema = z.enum([
  'BURNT',
  'UNDERWEIGHT',
  'PACKAGING_DEFECT',
  'POOR_SEAL',
  'OTHER',
]);
export type ProductionRejectionReasonInput = z.infer<typeof productionRejectionReasonSchema>;

/** Rejects a component list containing the same `componentProductId` more than once —
 *  used by both the create and update Bill of Materials schemas below (brief §4:
 *  "prevent duplicate component lines where possible"). */
function hasNoDuplicateComponents(items: { componentProductId: string }[]): boolean {
  const ids = items.map((item) => item.componentProductId);
  return new Set(ids).size === ids.length;
}

export const billOfMaterialItemInputSchema = z.object({
  componentProductId: z.string().trim().min(1, 'Component product is required'),
  quantity: z.number().positive('Quantity must be greater than zero'),
  unitOfMeasure: z.string().trim().min(1, 'Unit of measure is required').max(50),
  notes: z.string().trim().max(2000).optional(),
});
export type BillOfMaterialItemInput = z.infer<typeof billOfMaterialItemInputSchema>;

/**
 * `POST /api/production/boms` (Sprint 4.6 brief §3/§4). `bomNumber`/`status` are
 * deliberately absent — always server-generated, immutable, and every new BOM starts
 * `DRAFT` (brief §5: version control happens by creating a new BOM and activating it,
 * never by editing history).
 */
export const createBillOfMaterialSchema = z
  .object({
    productId: z.string().trim().min(1, 'Finished product is required'),
    name: z.string().trim().max(200).optional(),
    yieldQuantity: z.number().positive('Yield quantity must be greater than zero'),
    notes: z.string().trim().max(2000).optional(),
    items: z.array(billOfMaterialItemInputSchema).min(1, 'At least one component is required'),
  })
  .refine((data) => hasNoDuplicateComponents(data.items), {
    message: 'Duplicate components are not allowed on the same bill of material',
    path: ['items'],
  });
export type CreateBillOfMaterialInput = z.infer<typeof createBillOfMaterialSchema>;

/** `PATCH /api/production/boms/:id` — every field optional (partial update); only
 *  reachable while `status === DRAFT` (service-enforced, brief §5: "do not allow an
 *  active BOM to be casually edited in a way that changes historical production
 *  meaning"). `productId` is absent — the finished product isn't editable after
 *  creation, create a new BOM instead. */
export const updateBillOfMaterialSchema = z
  .object({
    name: z.string().trim().max(200).optional(),
    yieldQuantity: z.number().positive('Yield quantity must be greater than zero').optional(),
    notes: z.string().trim().max(2000).optional(),
    items: z
      .array(billOfMaterialItemInputSchema)
      .min(1, 'At least one component is required')
      .optional(),
  })
  .refine((data) => !data.items || hasNoDuplicateComponents(data.items), {
    message: 'Duplicate components are not allowed on the same bill of material',
    path: ['items'],
  });
export type UpdateBillOfMaterialInput = z.infer<typeof updateBillOfMaterialSchema>;

/**
 * `POST /api/production/orders` (Sprint 4.6 brief §6/§7/§8). `productId` is absent —
 * always derived server-side from `billOfMaterialId`, never a separate client input
 * (avoids the two ever drifting apart). `productionOrderNumber`/`status` are also
 * absent — always server-generated, and every new order starts `DRAFT`.
 */
export const createProductionOrderSchema = z.object({
  billOfMaterialId: z.string().trim().min(1, 'Bill of material is required'),
  plannedQuantity: z.number().positive('Planned quantity must be greater than zero'),
  locationId: z.string().trim().min(1, 'Production location is required'),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateProductionOrderInput = z.infer<typeof createProductionOrderSchema>;

/** `PATCH /api/production/orders/:id` — only reachable while `status === DRAFT`
 *  (service-enforced). `billOfMaterialId` is absent — not changeable after creation
 *  (cancel and create a new order for a different recipe). */
export const updateProductionOrderSchema = z.object({
  plannedQuantity: z.number().positive('Planned quantity must be greater than zero').optional(),
  locationId: z.string().trim().min(1, 'Production location is required').optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type UpdateProductionOrderInput = z.infer<typeof updateProductionOrderSchema>;

export const materialIssueItemInputSchema = z.object({
  componentProductId: z.string().trim().min(1, 'Component product is required'),
  quantity: z.number().positive('Quantity must be greater than zero'),
});
export type MaterialIssueItemInput = z.infer<typeof materialIssueItemInputSchema>;

/**
 * `POST /api/production/orders/:id/material-issues` (Sprint 4.6 brief §12/§14). Rejects
 * both over-issue (`already issued + this request > required`) and insufficient stock —
 * both enforced in `ProductionOrderService`, not here, since both depend on live
 * server-side state (cumulative issued totals, current stock balance), same convention
 * as `createInventoryAdjustmentSchema`'s negative-stock note.
 */
export const createMaterialIssueSchema = z.object({
  issuedDate: z.coerce.date(),
  notes: z.string().trim().max(2000).optional(),
  items: z.array(materialIssueItemInputSchema).min(1, 'At least one item is required'),
});
export type CreateMaterialIssueInput = z.infer<typeof createMaterialIssueSchema>;

/**
 * `POST /api/production/orders/:id/complete` (Sprint 4.6 brief §15/§16). `acceptedQuantity`
 * is deliberately absent — always computed server-side as
 * `producedQuantity - rejectedQuantity`, never accepted from the client (brief: "Do not
 * trust frontend-calculated accepted quantity").
 */
export const completeProductionOrderSchema = z
  .object({
    producedQuantity: z.number().nonnegative('Produced quantity cannot be negative'),
    rejectedQuantity: z.number().nonnegative('Rejected quantity cannot be negative').default(0),
    rejectionReason: productionRejectionReasonSchema.optional(),
    rejectionNotes: z.string().trim().max(2000).optional(),
  })
  .refine((data) => data.rejectedQuantity <= data.producedQuantity, {
    message: 'Rejected quantity cannot exceed produced quantity',
    path: ['rejectedQuantity'],
  });
export type CompleteProductionOrderInput = z.infer<typeof completeProductionOrderSchema>;
