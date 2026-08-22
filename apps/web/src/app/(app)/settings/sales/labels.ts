import type { BadgeProps } from '@zentuva/ui';

import type { SalesOrderStatus } from './api';

export const SALES_ORDER_STATUS_LABELS: Record<SalesOrderStatus, string> = {
  DRAFT: 'Draft',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
};

export const SALES_ORDER_STATUS_VARIANT: Record<
  SalesOrderStatus,
  NonNullable<BadgeProps['variant']>
> = {
  DRAFT: 'default',
  CONFIRMED: 'success',
  CANCELLED: 'destructive',
};
