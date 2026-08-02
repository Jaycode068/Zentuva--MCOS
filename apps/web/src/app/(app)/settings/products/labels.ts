import type { BadgeProps } from '@zentuva/ui';

import type { Product } from './api';

/** Shared display labels/badge colours for the Products table and view dialog — one
 *  source of truth so the two don't drift. */
export const CATEGORY_LABELS: Record<Product['category'], string> = {
  SNACKS: 'Snacks',
  BEVERAGE: 'Beverage',
  WATER: 'Water',
  CONFECTIONERY: 'Confectionery',
  RAW_MATERIALS: 'Raw Materials',
  PACKAGING: 'Packaging',
  OTHERS: 'Others',
};

export const TYPE_LABELS: Record<Product['type'], string> = {
  FINISHED_PRODUCT: 'Finished Product',
  RAW_MATERIAL: 'Raw Material',
  PACKAGING_MATERIAL: 'Packaging Material',
  CONSUMABLE: 'Consumable',
};

/** Draft = not yet published (warning/amber), Active = success, Archived = muted/default —
 *  same semantic mapping as `settings/users`' `StatusBadge`. */
export const STATUS_VARIANT: Record<Product['status'], NonNullable<BadgeProps['variant']>> = {
  DRAFT: 'warning',
  ACTIVE: 'success',
  ARCHIVED: 'default',
};
