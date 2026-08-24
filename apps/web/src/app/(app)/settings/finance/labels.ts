import type { BadgeProps } from '@zentuva/ui';

import type { CreditNoteStatus, InvoiceStatus, PaymentMethod, PaymentTermType } from './api';

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  PARTIALLY_PAID: 'Partially Paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  VOID: 'Void',
};

export const INVOICE_STATUS_VARIANT: Record<InvoiceStatus, NonNullable<BadgeProps['variant']>> = {
  DRAFT: 'default',
  ISSUED: 'default',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  OVERDUE: 'destructive',
  VOID: 'destructive',
};

export const PAYMENT_TERM_LABELS: Record<PaymentTermType, string> = {
  CASH: 'Cash',
  DUE_ON_RECEIPT: 'Due on Receipt',
  NET_7: 'Net 7',
  NET_14: 'Net 14',
  NET_30: 'Net 30',
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank Transfer',
  POS: 'POS',
  OTHER: 'Other',
};

export const CREDIT_NOTE_STATUS_LABELS: Record<CreditNoteStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  VOID: 'Void',
};

export const CREDIT_NOTE_STATUS_VARIANT: Record<
  CreditNoteStatus,
  NonNullable<BadgeProps['variant']>
> = {
  DRAFT: 'default',
  ISSUED: 'success',
  VOID: 'destructive',
};
