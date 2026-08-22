import type { BadgeProps } from '@zentuva/ui';

import type {
  BillOfMaterialStatus,
  ProductionOrderStatus,
  ProductionRejectionReason,
  ProductType,
} from './api';

/** Same `ProductType` labels as `settings/products/labels.ts`'s `TYPE_LABELS` — kept as
 *  its own copy, same "each domain owns its own display labels" convention as
 *  `settings/inventory/labels.ts`'s `PRODUCT_TYPE_LABELS`. */
export const PRODUCT_TYPE_LABELS: Record<ProductType, string> = {
  FINISHED_PRODUCT: 'Finished Product',
  RAW_MATERIAL: 'Raw Material',
  PACKAGING_MATERIAL: 'Packaging Material',
  CONSUMABLE: 'Consumable',
};

export const BOM_STATUS_LABELS: Record<BillOfMaterialStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

export const BOM_STATUS_VARIANT: Record<
  BillOfMaterialStatus,
  NonNullable<BadgeProps['variant']>
> = {
  DRAFT: 'default',
  ACTIVE: 'success',
  INACTIVE: 'warning',
};

export const PRODUCTION_ORDER_STATUS_LABELS: Record<ProductionOrderStatus, string> = {
  DRAFT: 'Draft',
  PLANNED: 'Planned',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const PRODUCTION_ORDER_STATUS_VARIANT: Record<
  ProductionOrderStatus,
  NonNullable<BadgeProps['variant']>
> = {
  DRAFT: 'default',
  PLANNED: 'warning',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  CANCELLED: 'default',
};

/** Sprint 4.6 brief — a small controlled list of reasons some produced output was
 *  rejected during Production Execution, same "small controlled enum, not a full QMS"
 *  scope as `RejectionReason` in Goods Receiving. */
export const REJECTION_REASON_LABELS: Record<ProductionRejectionReason, string> = {
  BURNT: 'Burnt',
  UNDERWEIGHT: 'Underweight',
  PACKAGING_DEFECT: 'Packaging Defect',
  POOR_SEAL: 'Poor Seal',
  OTHER: 'Other',
};
