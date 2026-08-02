import type { BadgeProps } from '@zentuva/ui';

import type { Supplier } from './api';

/** Shared display labels/badge colours for the Suppliers table and dialogs — one source
 *  of truth so they don't drift, same convention as `settings/products/labels.ts`. */
export const CATEGORY_LABELS: Record<Supplier['supplierCategory'], string> = {
  RAW_MATERIAL: 'Raw Material',
  PACKAGING: 'Packaging',
  LOGISTICS: 'Logistics',
  MAINTENANCE: 'Maintenance',
  UTILITY: 'Utility',
  SERVICE: 'Service',
  OTHER: 'Other',
};

/** Active = success, Inactive = muted/default — same semantic mapping as
 *  `settings/users`' `StatusBadge`. */
export const STATUS_VARIANT: Record<Supplier['status'], NonNullable<BadgeProps['variant']>> = {
  ACTIVE: 'success',
  INACTIVE: 'default',
};
