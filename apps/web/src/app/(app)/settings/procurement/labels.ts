import type { BadgeProps } from '@zentuva/ui';

import type { PurchaseOrderStatus } from './api';

/** Draft = still being prepared (muted/default), Pending = issued to the supplier,
 *  awaiting fulfilment (warning/amber), Approved = future-sprint state shown the same
 *  success green as Product's Active, Partially Received = warning/amber (still open,
 *  same as Pending — added Sprint 4.4.1), Received = success, Cancelled =
 *  destructive/red — same semantic mapping convention as
 *  `settings/products`/`settings/suppliers`. */
export const STATUS_VARIANT: Record<PurchaseOrderStatus, NonNullable<BadgeProps['variant']>> = {
  DRAFT: 'default',
  PENDING: 'warning',
  APPROVED: 'success',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'destructive',
};

export const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  PARTIALLY_RECEIVED: 'Partially Received',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

/** A purchase order can only be edited while in one of these two states (Sprint 4.3
 *  brief: "Edit Purchase Order: Allowed only when Status = DRAFT or PENDING. Cancelled
 *  POs become read-only."). Sprint 4.4.1 extended the same rule to
 *  `PARTIALLY_RECEIVED`/`RECEIVED` — once Inventory has started receiving against an
 *  order, its items/supplier can no longer change (`PurchaseOrderService.update`). */
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
