import type { BadgeProps } from '@zentuva/ui';

import type { DispatchStatus } from './api';

export const DISPATCH_STATUS_LABELS: Record<DispatchStatus, string> = {
  READY: 'Ready',
  DISPATCHED: 'Dispatched',
  IN_TRANSIT: 'In Transit',
  PARTIALLY_DELIVERED: 'Partially Delivered',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
};

export const DISPATCH_STATUS_VARIANT: Record<DispatchStatus, NonNullable<BadgeProps['variant']>> = {
  READY: 'default',
  DISPATCHED: 'default',
  IN_TRANSIT: 'warning',
  PARTIALLY_DELIVERED: 'warning',
  DELIVERED: 'success',
  CANCELLED: 'destructive',
  FAILED: 'destructive',
};
