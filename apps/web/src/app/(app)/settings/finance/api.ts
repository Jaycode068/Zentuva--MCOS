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

// === Accounting (Sprint 7, docs/domains/accounting.md) ===

export type AccountType =
  'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'COST_OF_SALES' | 'EXPENSE';
export type AccountingPeriodStatus = 'OPEN' | 'CLOSED';
export type JournalEntryStatus = 'DRAFT' | 'POSTED' | 'VOID';

/** `GET/POST /api/finance/accounts`, `GET .../:id` response shape — see
 *  `apps/api/src/finance/accounting/chart-of-account.controller.ts`'s
 *  `toChartOfAccountResponse`. */
export interface ChartOfAccount {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  parentId: string | null;
  description: string | null;
  isActive: boolean;
  isSystemAccount: boolean;
  systemKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChartOfAccountPayload {
  code: string;
  name: string;
  type: AccountType;
  parentId?: string;
  description?: string;
}

export interface UpdateChartOfAccountPayload {
  name?: string;
  description?: string;
  parentId?: string | null;
}

export interface ListChartOfAccountsParams {
  type?: AccountType;
  isActive?: boolean;
  search?: string;
}

export function listChartOfAccounts(
  params: ListChartOfAccountsParams = {},
): Promise<{ items: ChartOfAccount[] }> {
  const query = new URLSearchParams();
  if (params.type) query.set('type', params.type);
  if (params.isActive !== undefined) query.set('isActive', String(params.isActive));
  if (params.search) query.set('search', params.search);
  const queryString = query.toString();
  return apiFetch<{ items: ChartOfAccount[] }>(
    `/finance/accounts${queryString ? `?${queryString}` : ''}`,
  );
}

export function createChartOfAccount(input: CreateChartOfAccountPayload): Promise<ChartOfAccount> {
  return apiFetch<ChartOfAccount>('/finance/accounts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateChartOfAccount(
  id: string,
  input: UpdateChartOfAccountPayload,
): Promise<ChartOfAccount> {
  return apiFetch<ChartOfAccount>(`/finance/accounts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function activateChartOfAccount(id: string): Promise<ChartOfAccount> {
  return apiFetch<ChartOfAccount>(`/finance/accounts/${id}/activate`, { method: 'POST' });
}

export function deactivateChartOfAccount(id: string): Promise<ChartOfAccount> {
  return apiFetch<ChartOfAccount>(`/finance/accounts/${id}/deactivate`, { method: 'POST' });
}

/** `GET /finance/accounting-periods`, `GET .../:id` response shape — see
 *  `apps/api/src/finance/accounting/accounting-period.controller.ts`'s
 *  `toAccountingPeriodResponse`. */
export interface AccountingPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: AccountingPeriodStatus;
  closedAt: string | null;
  createdAt: string;
}

export interface CreateAccountingPeriodPayload {
  name: string;
  startDate: string;
  endDate: string;
}

export function listAccountingPeriods(): Promise<{ items: AccountingPeriod[] }> {
  return apiFetch<{ items: AccountingPeriod[] }>('/finance/accounting-periods');
}

export function createAccountingPeriod(
  input: CreateAccountingPeriodPayload,
): Promise<AccountingPeriod> {
  return apiFetch<AccountingPeriod>('/finance/accounting-periods', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function closeAccountingPeriod(id: string): Promise<AccountingPeriod> {
  return apiFetch<AccountingPeriod>(`/finance/accounting-periods/${id}/close`, { method: 'POST' });
}

/** `GET/POST /api/finance/journal-entries`, `GET .../:id` response shape — see
 *  `apps/api/src/finance/accounting/journal-entry.controller.ts`'s
 *  `toJournalEntryResponse`. */
export interface JournalEntryLine {
  id: string;
  account: { id: string; code: string; name: string; type: AccountType };
  description: string | null;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  id: string;
  journalNumber: string;
  date: string;
  accountingPeriod: { id: string; name: string; status: AccountingPeriodStatus };
  description: string;
  reference: string | null;
  sourceType: string | null;
  sourceId: string | null;
  status: JournalEntryStatus;
  postedAt: string | null;
  lines: JournalEntryLine[];
  createdAt: string;
}

export interface JournalEntryLineInputPayload {
  accountId: string;
  description?: string;
  debit?: number;
  credit?: number;
}

export interface CreateJournalEntryPayload {
  date: string;
  description: string;
  reference?: string;
  lines: JournalEntryLineInputPayload[];
}

export interface ListJournalEntriesParams {
  status?: JournalEntryStatus;
  sourceType?: string;
  accountingPeriodId?: string;
}

export function listJournalEntries(
  params: ListJournalEntriesParams = {},
): Promise<{ items: JournalEntry[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.sourceType) query.set('sourceType', params.sourceType);
  if (params.accountingPeriodId) query.set('accountingPeriodId', params.accountingPeriodId);
  const queryString = query.toString();
  return apiFetch<{ items: JournalEntry[] }>(
    `/finance/journal-entries${queryString ? `?${queryString}` : ''}`,
  );
}

export function getJournalEntry(id: string): Promise<JournalEntry> {
  return apiFetch<JournalEntry>(`/finance/journal-entries/${id}`);
}

export function createJournalEntry(input: CreateJournalEntryPayload): Promise<JournalEntry> {
  return apiFetch<JournalEntry>('/finance/journal-entries', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function postJournalEntry(id: string): Promise<JournalEntry> {
  return apiFetch<JournalEntry>(`/finance/journal-entries/${id}/post`, { method: 'POST' });
}

export function voidJournalEntry(id: string): Promise<JournalEntry> {
  return apiFetch<JournalEntry>(`/finance/journal-entries/${id}/void`, { method: 'POST' });
}

/** `GET /finance/ledger` response line — see `LedgerService.getLedger`. */
export interface LedgerLine {
  id: string;
  date: string;
  journalNumber: string;
  account: { id: string; code: string; name: string };
  description: string | null;
  reference: string | null;
  sourceType: string | null;
  sourceId: string | null;
  status: JournalEntryStatus;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface GetLedgerParams {
  accountId?: string;
  from?: string;
  to?: string;
  accountingPeriodId?: string;
  sourceType?: string;
  reference?: string;
  status?: JournalEntryStatus;
}

export function getLedger(params: GetLedgerParams = {}): Promise<{ items: LedgerLine[] }> {
  const query = new URLSearchParams();
  if (params.accountId) query.set('accountId', params.accountId);
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.accountingPeriodId) query.set('accountingPeriodId', params.accountingPeriodId);
  if (params.sourceType) query.set('sourceType', params.sourceType);
  if (params.reference) query.set('reference', params.reference);
  if (params.status) query.set('status', params.status);
  const queryString = query.toString();
  return apiFetch<{ items: LedgerLine[] }>(
    `/finance/ledger${queryString ? `?${queryString}` : ''}`,
  );
}

/** `GET /finance/trial-balance` response shape — see `LedgerService.getTrialBalance`. */
export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  debit: number;
  credit: number;
}

export interface TrialBalance {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
}

export function getTrialBalance(
  params: { from?: string; to?: string; accountingPeriodId?: string } = {},
): Promise<TrialBalance> {
  const query = new URLSearchParams();
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.accountingPeriodId) query.set('accountingPeriodId', params.accountingPeriodId);
  const queryString = query.toString();
  return apiFetch<TrialBalance>(`/finance/trial-balance${queryString ? `?${queryString}` : ''}`);
}

/** `GET /finance/accounts/:id/activity` response shape — see
 *  `LedgerService.getAccountActivity`. */
export interface AccountActivity {
  account: { id: string; code: string; name: string; type: AccountType };
  openingBalance: number;
  transactions: LedgerLine[];
  closingBalance: number;
}

export function getAccountActivity(
  id: string,
  params: { from?: string; to?: string } = {},
): Promise<AccountActivity> {
  const query = new URLSearchParams();
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  const queryString = query.toString();
  return apiFetch<AccountActivity>(
    `/finance/accounts/${id}/activity${queryString ? `?${queryString}` : ''}`,
  );
}
