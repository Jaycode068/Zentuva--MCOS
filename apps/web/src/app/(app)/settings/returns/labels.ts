import type { BadgeProps } from '@zentuva/ui';

import type { CustomerReturnReason, CustomerReturnStatus, SupplierReturnReason } from './api';

export const CUSTOMER_RETURN_STATUS_LABELS: Record<CustomerReturnStatus, string> = {
  REQUESTED: 'Requested',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

export const CUSTOMER_RETURN_STATUS_VARIANT: Record<
  CustomerReturnStatus,
  NonNullable<BadgeProps['variant']>
> = {
  REQUESTED: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'destructive',
};

export const CUSTOMER_RETURN_REASON_LABELS: Record<CustomerReturnReason, string> = {
  DAMAGED: 'Damaged',
  DEFECTIVE: 'Defective',
  WRONG_ITEM: 'Wrong Item',
  WRONG_QUANTITY: 'Wrong Quantity',
  CUSTOMER_REJECTED: 'Customer Rejected',
  QUALITY_ISSUE: 'Quality Issue',
  EXPIRED: 'Expired',
  OTHER: 'Other',
};

export const SUPPLIER_RETURN_REASON_LABELS: Record<SupplierReturnReason, string> = {
  DAMAGED: 'Damaged',
  DEFECTIVE: 'Defective',
  WRONG_ITEM: 'Wrong Item',
  WRONG_SPECIFICATION: 'Wrong Specification',
  CONTAMINATED: 'Contaminated',
  OTHER: 'Other',
};
