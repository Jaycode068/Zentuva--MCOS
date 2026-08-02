import type { BadgeProps } from '@zentuva/ui';

import type { PurchaseOrderStatus } from './api';

/** Draft = still being prepared (muted/default), Pending = issued to the supplier,
 *  awaiting fulfilment (warning/amber), Approved/Received = future-sprint states shown
 *  the same success green as Product's Active, Cancelled = destructive/red — same
 *  semantic mapping convention as `settings/products`/`settings/suppliers`. */
export const STATUS_VARIANT: Record<PurchaseOrderStatus, NonNullable<BadgeProps['variant']>> = {
  DRAFT: 'default',
  PENDING: 'warning',
  APPROVED: 'success',
  CANCELLED: 'destructive',
  RECEIVED: 'success',
};

export const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  CANCELLED: 'Cancelled',
  RECEIVED: 'Received',
};

/** A purchase order can only be edited while in one of these two states (Sprint 4.3
 *  brief: "Edit Purchase Order: Allowed only when Status = DRAFT or PENDING. Cancelled
 *  POs become read-only."). */
export const EDITABLE_STATUSES: PurchaseOrderStatus[] = ['DRAFT', 'PENDING'];

const CURRENCY_FORMATTER = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 2,
});

/** No multi-currency in MVP (brief's explicit Out of Scope) — every amount is formatted
 *  as Naira, matching the brief's own `₦350` example. */
export function formatCurrency(value: number): string {
  return CURRENCY_FORMATTER.format(value);
}
