import type { BadgeProps } from '@zentuva/ui';

import type {
  DiscrepancyStatus,
  InventoryStock,
  InventoryTransactionType,
  RejectionReason,
} from './api';

/** Same `ProductType` labels as `settings/products/labels.ts`'s `TYPE_LABELS` — kept as
 *  its own copy (not imported) since this file only needs the four values, same "each
 *  domain owns its own display labels" convention as every other `labels.ts` in this
 *  codebase. */
export const PRODUCT_TYPE_LABELS: Record<InventoryStock['product']['type'], string> = {
  FINISHED_PRODUCT: 'Finished Product',
  RAW_MATERIAL: 'Raw Material',
  PACKAGING_MATERIAL: 'Packaging Material',
  CONSUMABLE: 'Consumable',
};

export const TRANSACTION_TYPE_LABELS: Record<InventoryTransactionType, string> = {
  RECEIPT: 'Receipt',
  ISSUE: 'Issue',
  ADJUSTMENT: 'Adjustment',
};

/** Receipt = success (stock increased), Issue = warning (stock decreased — not reachable
 *  yet this sprint), Adjustment = default (neutral correction). */
export const TRANSACTION_TYPE_VARIANT: Record<
  InventoryTransactionType,
  NonNullable<BadgeProps['variant']>
> = {
  RECEIPT: 'success',
  ISSUE: 'warning',
  ADJUSTMENT: 'default',
};

/** Sprint 4.4.1 brief §4 — reasons a receiving inspector can give for rejecting some (or
 *  all) of a delivered quantity. */
export const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  DAMAGED: 'Damaged',
  DEFECTIVE: 'Defective',
  WRONG_ITEM: 'Wrong Item',
  WRONG_SPECIFICATION: 'Wrong Specification',
  CONTAMINATED: 'Contaminated',
  OTHER: 'Other',
};

/** Sprint 4.4.1 brief §5 — the lightweight supplier-resolution state for a
 *  `GoodsReceipt`'s discrepancy (if any). */
export const DISCREPANCY_STATUS_LABELS: Record<DiscrepancyStatus, string> = {
  NONE: 'None',
  PENDING_SUPPLIER: 'Pending Supplier',
  REPLACEMENT_EXPECTED: 'Replacement Expected',
  REPLACEMENT_RECEIVED: 'Replacement Received',
  CREDIT_EXPECTED: 'Credit Expected',
  RESOLVED: 'Resolved',
};

/** None = default/neutral (no discrepancy at all), Pending/Expected = warning (still
 *  open), Resolved = success (closed out). */
export const DISCREPANCY_STATUS_VARIANT: Record<
  DiscrepancyStatus,
  NonNullable<BadgeProps['variant']>
> = {
  NONE: 'default',
  PENDING_SUPPLIER: 'warning',
  REPLACEMENT_EXPECTED: 'warning',
  REPLACEMENT_RECEIVED: 'warning',
  CREDIT_EXPECTED: 'warning',
  RESOLVED: 'success',
};
