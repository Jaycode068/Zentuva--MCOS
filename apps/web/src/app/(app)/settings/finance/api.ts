import { apiFetch } from '@/lib/api-client';

export type PaymentTermType = 'CASH' | 'DUE_ON_RECEIPT' | 'NET_7' | 'NET_14' | 'NET_30';
export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'VOID';
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'POS' | 'OTHER';
export type PaymentStatus = 'RECORDED' | 'VOIDED';
export type CreditNoteStatus = 'DRAFT' | 'ISSUED' | 'VOID';

export interface InvoiceItem {
  id: string;
  productId: string | null;
  productCode: string;
  productName: string;
  description: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
}

/** `GET/POST /api/finance/invoices`, `GET .../:id` response shape — see
 *  `apps/api/src/finance/invoice.controller.ts`'s `toInvoiceResponse`. */
export interface Invoice {
  id: string;
  invoiceCode: string;
  customer: { id: string; customerCode: string; customerName: string };
  outlet: { id: string; outletCode: string; name: string } | null;
  salesOrder: { id: string; orderCode: string } | null;
  invoiceDate: string;
  dueDate: string;
  paymentTerms: PaymentTermType;
  status: InvoiceStatus;
  currency: string;
  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  amountCredited: number;
  /** Derived server-side (`total - amountPaid - amountCredited`) — never a stored
   *  column. */
  amountOutstanding: number;
  notes: string | null;
  items: InvoiceItem[];
  createdAt: string;
  updatedAt: string;
}

/** `GET /finance/eligible-sales-orders` response shape — a Sales Order that is
 *  `FULFILLED` and has no non-VOID invoice yet. */
export interface EligibleSalesOrder {
  id: string;
  orderCode: string;
  customer: { id: string; customerCode: string; customerName: string };
  outlet: { id: string; outletCode: string; name: string } | null;
  total: number;
  items: {
    id: string;
    product: { id: string; code: string; name: string; unit: string };
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
}

export interface InvoiceItemInputPayload {
  salesOrderItemId: string;
  discount?: number;
  taxRate?: number;
}

export interface CreateInvoicePayload {
  salesOrderId: string;
  invoiceDate: string;
  paymentTerms: PaymentTermType;
  notes?: string;
  /** Client-generated once per invoice attempt (`crypto.randomUUID()`) and reused across
   *  retries of the same submit — protects against a double-tap or flaky-network retry
   *  creating two invoices for the same order. */
  idempotencyKey?: string;
  items: InvoiceItemInputPayload[];
}

export interface ListInvoicesParams {
  status?: InvoiceStatus;
  customerId?: string;
  salesOrderId?: string;
  search?: string;
}

export function listEligibleSalesOrders(): Promise<{ items: EligibleSalesOrder[] }> {
  return apiFetch<{ items: EligibleSalesOrder[] }>('/finance/eligible-sales-orders');
}

export function listInvoices(params: ListInvoicesParams = {}): Promise<{ items: Invoice[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.customerId) query.set('customerId', params.customerId);
  if (params.salesOrderId) query.set('salesOrderId', params.salesOrderId);
  if (params.search) query.set('search', params.search);
  const queryString = query.toString();
  return apiFetch<{ items: Invoice[] }>(`/finance/invoices${queryString ? `?${queryString}` : ''}`);
}

export function getInvoice(id: string): Promise<Invoice> {
  return apiFetch<Invoice>(`/finance/invoices/${id}`);
}

export function createInvoice(input: CreateInvoicePayload): Promise<Invoice> {
  return apiFetch<Invoice>('/finance/invoices', { method: 'POST', body: JSON.stringify(input) });
}

export function issueInvoice(id: string): Promise<Invoice> {
  return apiFetch<Invoice>(`/finance/invoices/${id}/issue`, { method: 'POST' });
}

export function voidInvoice(id: string, notes?: string): Promise<Invoice> {
  return apiFetch<Invoice>(`/finance/invoices/${id}/void`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

/** `GET/POST /api/finance/payments`, `GET .../:id` response shape — see
 *  `apps/api/src/finance/payment.controller.ts`'s `toPaymentResponse`. */
export interface Payment {
  id: string;
  customer: { id: string; customerCode: string; customerName: string };
  paymentDate: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  status: PaymentStatus;
  invoiceId: string | null;
  createdAt: string;
}

export interface CreatePaymentPayload {
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  paymentDate: string;
  reference?: string;
  notes?: string;
  /** Client-generated once per payment attempt, reused across retries of the same
   *  submit — protects against a double-tap or flaky-network retry double-recording a
   *  payment. */
  idempotencyKey?: string;
}

export interface ListPaymentsParams {
  customerId?: string;
  invoiceId?: string;
}

export function listPayments(params: ListPaymentsParams = {}): Promise<{ items: Payment[] }> {
  const query = new URLSearchParams();
  if (params.customerId) query.set('customerId', params.customerId);
  if (params.invoiceId) query.set('invoiceId', params.invoiceId);
  const queryString = query.toString();
  return apiFetch<{ items: Payment[] }>(`/finance/payments${queryString ? `?${queryString}` : ''}`);
}

export function createPayment(input: CreatePaymentPayload): Promise<Payment> {
  return apiFetch<Payment>('/finance/payments', { method: 'POST', body: JSON.stringify(input) });
}

export function voidPayment(id: string): Promise<Payment> {
  return apiFetch<Payment>(`/finance/payments/${id}/void`, { method: 'POST' });
}

/** `GET/POST /api/finance/credit-notes`, `GET .../:id` response shape — see
 *  `apps/api/src/finance/credit-note.controller.ts`'s `toCreditNoteResponse`. */
export interface CreditNote {
  id: string;
  creditNoteCode: string;
  customer: { id: string; customerCode: string; customerName: string };
  invoice: { id: string; invoiceCode: string } | null;
  invoiceId: string | null;
  reason: string;
  amount: number;
  currency: string;
  status: CreditNoteStatus;
  creditNoteDate: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCreditNotePayload {
  invoiceId: string;
  amount: number;
  reason: string;
  creditNoteDate: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface ListCreditNotesParams {
  customerId?: string;
  invoiceId?: string;
}

export function listCreditNotes(
  params: ListCreditNotesParams = {},
): Promise<{ items: CreditNote[] }> {
  const query = new URLSearchParams();
  if (params.customerId) query.set('customerId', params.customerId);
  if (params.invoiceId) query.set('invoiceId', params.invoiceId);
  const queryString = query.toString();
  return apiFetch<{ items: CreditNote[] }>(
    `/finance/credit-notes${queryString ? `?${queryString}` : ''}`,
  );
}

export function createCreditNote(input: CreateCreditNotePayload): Promise<CreditNote> {
  return apiFetch<CreditNote>('/finance/credit-notes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function issueCreditNote(id: string): Promise<CreditNote> {
  return apiFetch<CreditNote>(`/finance/credit-notes/${id}/issue`, { method: 'POST' });
}

export function voidCreditNote(id: string): Promise<CreditNote> {
  return apiFetch<CreditNote>(`/finance/credit-notes/${id}/void`, { method: 'POST' });
}

export function listInvoicePayments(invoiceId: string): Promise<{ items: Payment[] }> {
  return apiFetch<{ items: Payment[] }>(`/finance/invoices/${invoiceId}/payments`);
}

export function listInvoiceCreditNotes(invoiceId: string): Promise<{ items: CreditNote[] }> {
  return apiFetch<{ items: CreditNote[] }>(`/finance/invoices/${invoiceId}/credit-notes`);
}

/** `GET /finance/receivables/summary` response shape — powers the Overview cards. */
export interface ArSummary {
  totalOutstanding: number;
  totalOverdue: number;
  invoicedThisPeriod: number;
  paymentsReceivedThisPeriod: number;
}

export interface CustomerArRow {
  customerId: string;
  customerCode: string;
  customerName: string;
  totalInvoiced: number;
  totalPaid: number;
  totalCredited: number;
  totalOutstanding: number;
}

export function getArSummary(): Promise<ArSummary> {
  return apiFetch<ArSummary>('/finance/receivables/summary');
}

export function listArByCustomer(): Promise<{ items: CustomerArRow[] }> {
  return apiFetch<{ items: CustomerArRow[] }>('/finance/receivables/by-customer');
}

export function getCustomerBalance(customerId: string): Promise<CustomerArRow> {
  return apiFetch<CustomerArRow>(`/finance/receivables/customers/${customerId}`);
}
