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
  /** Added Sprint 14 — which specific Cash Account received the money, if any. */
  cashAccountId: string | null;
  createdAt: string;
}

export interface CreatePaymentPayload {
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  paymentDate: string;
  reference?: string;
  notes?: string;
  /** Added Sprint 14 — optional; shown when the org has at least one matching-type
   *  Cash Account. */
  cashAccountId?: string;
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
  /** Added Sprint 13 — the parent Journal Entry's own id, distinct from `id` above
   *  (the line's own id) — needed to open its detail view. */
  journalEntryId: string;
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
  systemKey: string | null;
  debit: number;
  credit: number;
  /** `debit − credit` — added Sprint 13, see `LedgerService`'s own doc comment. */
  netBalance: number;
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

// === Accounts Payable (Sprint 12, docs/domains/finance.md "Accounts Payable") ===

export type SupplierInvoiceStatus =
  'DRAFT' | 'POSTED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'VOID';
export type SupplierInvoiceMatchStatus = 'UNVERIFIED' | 'MATCHED' | 'DISCREPANCY';

export interface SupplierInvoiceItem {
  id: string;
  product: { id: string; code: string; name: string; unit: string } | null;
  description: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** Set on a Path A line (reconciles against a Goods Receipt already recognised as
   *  payable) — mutually exclusive with `debitAccount`. */
  goodsReceiptItemId: string | null;
  /** Set on a Path B line (no Goods Receipt link — posts a fresh liability against
   *  this explicit, user-chosen Chart of Accounts entry). */
  debitAccount: { id: string; code: string; name: string } | null;
  /** Frozen at `post()` time — the capped, AP-eligible portion for a Path A line, or
   *  the full `lineTotal` for a Path B line. `0` before the invoice is posted. */
  recognizedAmount: number;
  /** `lineTotal - recognizedAmount`, always >= 0. Non-zero only on an over-invoiced
   *  Path A line. */
  varianceAmount: number;
}

export interface SupplierInvoiceJournalEntry {
  id: string;
  journalNumber: string;
  status: JournalEntryStatus;
  totalAmount: number;
}

/** `GET/POST /api/finance/supplier-invoices`, `GET .../:id` response shape — see
 *  `apps/api/src/finance/supplier-invoice.controller.ts`'s `toSupplierInvoiceResponse`. */
export interface SupplierInvoice {
  id: string;
  supplier: { id: string; supplierCode: string; supplierName: string };
  purchaseOrder: { id: string; purchaseOrderNumber: string } | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  paymentTerms: PaymentTermType;
  status: SupplierInvoiceStatus;
  currency: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  /** `null` until posted — a DRAFT invoice has no match result yet. */
  matchStatus: SupplierInvoiceMatchStatus | null;
  recognizedAmount: number;
  varianceAmount: number;
  amountPaid: number;
  amountCredited: number;
  /** Derived server-side (`recognizedAmount - amountPaid - amountCredited`) — the
   *  actual payable basis, never `total - amountPaid` (brief's central safety rule). */
  amountOutstanding: number;
  notes: string | null;
  discrepancyResolvedAt: string | null;
  discrepancyResolutionNotes: string | null;
  items: SupplierInvoiceItem[];
  createdAt: string;
  updatedAt: string;
}

export interface SupplierInvoiceItemInputPayload {
  productId?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  goodsReceiptItemId?: string;
  debitAccountId?: string;
}

export interface CreateSupplierInvoicePayload {
  supplierId: string;
  purchaseOrderId?: string;
  invoiceNumber: string;
  invoiceDate: string;
  paymentTerms: PaymentTermType;
  taxAmount?: number;
  notes?: string;
  idempotencyKey?: string;
  items: SupplierInvoiceItemInputPayload[];
}

export interface UpdateSupplierInvoicePayload {
  purchaseOrderId?: string | null;
  invoiceNumber?: string;
  invoiceDate?: string;
  paymentTerms?: PaymentTermType;
  taxAmount?: number;
  notes?: string;
  items?: SupplierInvoiceItemInputPayload[];
}

export interface ListSupplierInvoicesParams {
  status?: SupplierInvoiceStatus;
  supplierId?: string;
  purchaseOrderId?: string;
  search?: string;
}

export function listSupplierInvoices(
  params: ListSupplierInvoicesParams = {},
): Promise<{ items: SupplierInvoice[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.supplierId) query.set('supplierId', params.supplierId);
  if (params.purchaseOrderId) query.set('purchaseOrderId', params.purchaseOrderId);
  if (params.search) query.set('search', params.search);
  const queryString = query.toString();
  return apiFetch<{ items: SupplierInvoice[] }>(
    `/finance/supplier-invoices${queryString ? `?${queryString}` : ''}`,
  );
}

export function getSupplierInvoice(id: string): Promise<SupplierInvoice> {
  return apiFetch<SupplierInvoice>(`/finance/supplier-invoices/${id}`);
}

export function createSupplierInvoice(
  input: CreateSupplierInvoicePayload,
): Promise<SupplierInvoice> {
  return apiFetch<SupplierInvoice>('/finance/supplier-invoices', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateSupplierInvoice(
  id: string,
  input: UpdateSupplierInvoicePayload,
): Promise<SupplierInvoice> {
  return apiFetch<SupplierInvoice>(`/finance/supplier-invoices/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function postSupplierInvoice(
  id: string,
  idempotencyKey?: string,
): Promise<SupplierInvoice & { journalEntry: SupplierInvoiceJournalEntry | null }> {
  return apiFetch<SupplierInvoice & { journalEntry: SupplierInvoiceJournalEntry | null }>(
    `/finance/supplier-invoices/${id}/post`,
    { method: 'POST', body: JSON.stringify({ idempotencyKey }) },
  );
}

export function acknowledgeSupplierInvoiceDiscrepancy(
  id: string,
  notes?: string,
): Promise<SupplierInvoice> {
  return apiFetch<SupplierInvoice>(`/finance/supplier-invoices/${id}/acknowledge-discrepancy`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
}

export function voidSupplierInvoice(id: string): Promise<SupplierInvoice> {
  return apiFetch<SupplierInvoice>(`/finance/supplier-invoices/${id}/void`, { method: 'POST' });
}

/** `GET/POST /api/finance/supplier-payments` response shape — see
 *  `apps/api/src/finance/supplier-payment.controller.ts`'s `toSupplierPaymentResponse`. */
export interface SupplierPayment {
  id: string;
  supplier: { id: string; supplierCode: string; supplierName: string };
  paymentDate: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
  status: PaymentStatus;
  supplierInvoiceId: string | null;
  /** Added Sprint 14 — which specific Cash Account money was paid from, if any. */
  cashAccountId: string | null;
  createdAt: string;
}

export interface CreateSupplierPaymentPayload {
  supplierInvoiceId: string;
  amount: number;
  method: PaymentMethod;
  paymentDate: string;
  reference?: string;
  notes?: string;
  /** Added Sprint 14 — optional; shown when the org has at least one matching-type
   *  Cash Account. */
  cashAccountId?: string;
  idempotencyKey?: string;
}

export interface ListSupplierPaymentsParams {
  supplierId?: string;
  supplierInvoiceId?: string;
}

export function listSupplierPayments(
  params: ListSupplierPaymentsParams = {},
): Promise<{ items: SupplierPayment[] }> {
  const query = new URLSearchParams();
  if (params.supplierId) query.set('supplierId', params.supplierId);
  if (params.supplierInvoiceId) query.set('supplierInvoiceId', params.supplierInvoiceId);
  const queryString = query.toString();
  return apiFetch<{ items: SupplierPayment[] }>(
    `/finance/supplier-payments${queryString ? `?${queryString}` : ''}`,
  );
}

export function createSupplierPayment(
  input: CreateSupplierPaymentPayload,
): Promise<SupplierPayment> {
  return apiFetch<SupplierPayment>('/finance/supplier-payments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function voidSupplierPayment(id: string): Promise<SupplierPayment> {
  return apiFetch<SupplierPayment>(`/finance/supplier-payments/${id}/void`, { method: 'POST' });
}

/** `GET/POST /api/finance/supplier-credit-notes` response shape — see
 *  `apps/api/src/finance/supplier-credit-note.controller.ts`'s
 *  `toSupplierCreditNoteResponse`. Reuses `CreditNoteStatus` (identical shape to the
 *  customer side, no separate enum). */
export interface SupplierCreditNote {
  id: string;
  creditNoteCode: string;
  supplier: { id: string; supplierCode: string; supplierName: string };
  supplierInvoice: { id: string; invoiceNumber: string } | null;
  supplierInvoiceId: string;
  reason: string;
  amount: number;
  currency: string;
  status: CreditNoteStatus;
  creditNoteDate: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSupplierCreditNotePayload {
  supplierInvoiceId: string;
  amount: number;
  reason: string;
  creditNoteDate: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface ListSupplierCreditNotesParams {
  supplierId?: string;
  supplierInvoiceId?: string;
}

export function listSupplierCreditNotes(
  params: ListSupplierCreditNotesParams = {},
): Promise<{ items: SupplierCreditNote[] }> {
  const query = new URLSearchParams();
  if (params.supplierId) query.set('supplierId', params.supplierId);
  if (params.supplierInvoiceId) query.set('supplierInvoiceId', params.supplierInvoiceId);
  const queryString = query.toString();
  return apiFetch<{ items: SupplierCreditNote[] }>(
    `/finance/supplier-credit-notes${queryString ? `?${queryString}` : ''}`,
  );
}

export function createSupplierCreditNote(
  input: CreateSupplierCreditNotePayload,
): Promise<SupplierCreditNote> {
  return apiFetch<SupplierCreditNote>('/finance/supplier-credit-notes', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function issueSupplierCreditNote(id: string): Promise<SupplierCreditNote> {
  return apiFetch<SupplierCreditNote>(`/finance/supplier-credit-notes/${id}/issue`, {
    method: 'POST',
  });
}

export function voidSupplierCreditNote(id: string): Promise<SupplierCreditNote> {
  return apiFetch<SupplierCreditNote>(`/finance/supplier-credit-notes/${id}/void`, {
    method: 'POST',
  });
}

/** `GET /finance/accounts-payable/summary` response shape — powers the Payables
 *  Overview cards. "This period" = the current calendar month. */
export interface ApSummary {
  totalOutstanding: number;
  totalOverdue: number;
  totalPartiallyPaid: number;
  invoicedThisPeriod: number;
  paymentsMadeThisPeriod: number;
}

export interface SupplierApRow {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  totalInvoiced: number;
  totalRecognized: number;
  totalPaid: number;
  totalCredited: number;
  totalOutstanding: number;
}

export interface SupplierFinancialSummary extends SupplierApRow {
  recentInvoiceCount: number;
  recentPaymentCount: number;
}

/** Deliberately never includes received/inventory figures — see
 *  `apps/api/src/finance/accounts-payable.service.ts`'s own doc comment on why. The
 *  Purchase Order dialog combines this with its own, separately-owned Inventory
 *  receiving summary call. */
export interface PurchaseOrderApSummary {
  purchaseOrderId: string;
  invoiceCount: number;
  totalInvoiced: number;
  totalRecognized: number;
  totalPaid: number;
  totalCredited: number;
  totalOutstanding: number;
  discrepancyCount: number;
}

export function getApSummary(): Promise<ApSummary> {
  return apiFetch<ApSummary>('/finance/accounts-payable/summary');
}

export function listApBySupplier(): Promise<{ items: SupplierApRow[] }> {
  return apiFetch<{ items: SupplierApRow[] }>('/finance/accounts-payable/by-supplier');
}

export function getSupplierFinancialSummary(supplierId: string): Promise<SupplierFinancialSummary> {
  return apiFetch<SupplierFinancialSummary>(`/finance/accounts-payable/suppliers/${supplierId}`);
}

export function getPurchaseOrderApSummary(
  purchaseOrderId: string,
): Promise<PurchaseOrderApSummary> {
  return apiFetch<PurchaseOrderApSummary>(
    `/finance/accounts-payable/purchase-orders/${purchaseOrderId}`,
  );
}

// === Reporting (Sprint 13, docs/domains/accounting.md §16) ===

export interface FinancialStatementLine {
  accountId: string;
  code: string;
  name: string;
  amount: number;
}

export interface ProfitAndLossResult {
  from: string | null;
  to: string;
  revenue: number;
  revenueLines: FinancialStatementLine[];
  costOfSales: number;
  costOfSalesLines: FinancialStatementLine[];
  grossProfit: number;
  grossMarginPercent: number | null;
  operatingExpenses: number;
  operatingExpenseLines: FinancialStatementLine[];
  netProfit: number;
}

export interface ProfitAndLossComparison {
  current: ProfitAndLossResult;
  previous: ProfitAndLossResult | null;
}

export interface BalanceSheetResult {
  asOf: string;
  assets: number;
  assetLines: FinancialStatementLine[];
  liabilities: number;
  liabilityLines: FinancialStatementLine[];
  recordedEquity: number;
  equityLines: FinancialStatementLine[];
  retainedEarnings: number;
  totalEquity: number;
  difference: number;
  balanced: boolean;
}

export function getProfitAndLoss(
  params: { from?: string; to?: string; accountingPeriodId?: string; compare?: boolean } = {},
): Promise<ProfitAndLossComparison> {
  const query = new URLSearchParams();
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.accountingPeriodId) query.set('accountingPeriodId', params.accountingPeriodId);
  if (params.compare) query.set('compare', 'previous_period');
  const queryString = query.toString();
  return apiFetch<ProfitAndLossComparison>(
    `/finance/reports/profit-loss${queryString ? `?${queryString}` : ''}`,
  );
}

export function getBalanceSheet(params: { asOf?: string } = {}): Promise<BalanceSheetResult> {
  const query = new URLSearchParams();
  if (params.asOf) query.set('asOf', params.asOf);
  const queryString = query.toString();
  return apiFetch<BalanceSheetResult>(
    `/finance/reports/balance-sheet${queryString ? `?${queryString}` : ''}`,
  );
}

// --- AR / AP Aging ---

export interface CustomerAgingRow {
  customerId: string;
  customerCode: string;
  customerName: string;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  totalOutstanding: number;
}

export interface ArAgingReport {
  asOf: string;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  totalOutstanding: number;
  byCustomer: CustomerAgingRow[];
}

export function getArAging(params: { asOf?: string } = {}): Promise<ArAgingReport> {
  const query = new URLSearchParams();
  if (params.asOf) query.set('asOf', params.asOf);
  const queryString = query.toString();
  return apiFetch<ArAgingReport>(
    `/finance/receivables/aging${queryString ? `?${queryString}` : ''}`,
  );
}

export interface SupplierAgingRow {
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  totalOutstanding: number;
}

export interface ApAgingReport {
  asOf: string;
  current: number;
  days1To30: number;
  days31To60: number;
  days61To90: number;
  days90Plus: number;
  totalOutstanding: number;
  bySupplier: SupplierAgingRow[];
  grniPendingApprovalBalance: number;
  discrepancyInvoiceCount: number;
}

export function getApAging(params: { asOf?: string } = {}): Promise<ApAgingReport> {
  const query = new URLSearchParams();
  if (params.asOf) query.set('asOf', params.asOf);
  const queryString = query.toString();
  return apiFetch<ApAgingReport>(
    `/finance/accounts-payable/aging${queryString ? `?${queryString}` : ''}`,
  );
}

// --- Inventory Valuation & Reconciliation ---

export interface InventoryValuationLine {
  productId: string;
  productCode: string;
  productName: string;
  productType: string;
  unit: string;
  locationId: string;
  locationName: string;
  quantityOnHand: number;
  averageUnitCost: number;
  inventoryValue: number;
}

export interface InventoryValuationByCategory {
  label: string;
  value: number;
}

export interface InventoryValuationResult {
  lines: InventoryValuationLine[];
  totals: {
    grandTotal: number;
    byLocation: InventoryValuationByCategory[];
    byProductType: InventoryValuationByCategory[];
  };
}

export function getInventoryValuation(
  params: { locationId?: string; productType?: string } = {},
): Promise<InventoryValuationResult> {
  const query = new URLSearchParams();
  if (params.locationId) query.set('locationId', params.locationId);
  if (params.productType) query.set('productType', params.productType);
  const queryString = query.toString();
  return apiFetch<InventoryValuationResult>(
    `/finance/reports/inventory-valuation${queryString ? `?${queryString}` : ''}`,
  );
}

export interface InventoryReconciliationResult {
  asOf: string;
  inventorySubledgerValue: number;
  glInventoryBalance: number;
  difference: number;
  reconciled: boolean;
}

export function getInventoryReconciliation(): Promise<InventoryReconciliationResult> {
  return apiFetch<InventoryReconciliationResult>('/finance/reports/reconciliation');
}

// --- Revenue / COGS ---

export interface RevenueByProductRow {
  productId: string | null;
  productName: string;
  totalRevenue: number;
}

export interface RevenueByCustomerRow {
  customerId: string;
  customerName: string;
  totalRevenue: number;
}

export interface RevenueReport {
  from: string | null;
  to: string;
  totalRevenue: number;
  byProduct: RevenueByProductRow[];
  byCustomer: RevenueByCustomerRow[];
}

export function getRevenueReport(
  params: { from?: string; to?: string } = {},
): Promise<RevenueReport> {
  const query = new URLSearchParams();
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  const queryString = query.toString();
  return apiFetch<RevenueReport>(`/finance/reports/revenue${queryString ? `?${queryString}` : ''}`);
}

export interface CogsByProductRow {
  productId: string;
  totalCogs: number;
}

export interface CogsReport {
  from: string | null;
  to: string;
  totalCogs: number;
  byProduct: CogsByProductRow[];
}

export function getCogsReport(params: { from?: string; to?: string } = {}): Promise<CogsReport> {
  const query = new URLSearchParams();
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  const queryString = query.toString();
  return apiFetch<CogsReport>(`/finance/reports/cogs${queryString ? `?${queryString}` : ''}`);
}

// --- Management Dashboard ---

export interface DashboardOperational {
  salesOrderCount: number;
  salesOrderTotal: number;
  productionOrdersCompleted: number;
}

export interface DashboardResult {
  from: string | null;
  to: string;
  pnl: ProfitAndLossComparison;
  ar: ArSummary;
  ap: ApSummary;
  inventoryValue: number;
  operational: DashboardOperational;
}

export function getDashboard(
  params: { from?: string; to?: string; compare?: boolean } = {},
): Promise<DashboardResult> {
  const query = new URLSearchParams();
  if (params.from) query.set('from', params.from);
  if (params.to) query.set('to', params.to);
  if (params.compare) query.set('compare', 'previous_period');
  const queryString = query.toString();
  return apiFetch<DashboardResult>(
    `/finance/reports/dashboard${queryString ? `?${queryString}` : ''}`,
  );
}

// === Cash & Bank Management (Sprint 14, docs/domains/cash-management.md) ===

export type CashAccountType = 'BANK' | 'CASH' | 'OTHER_CASH_EQUIVALENT';
export type CashAccountStatus = 'ACTIVE' | 'INACTIVE';
export type CashTransactionType = 'RECEIPT' | 'PAYMENT';
export type BankTransactionMatchStatus = 'UNMATCHED' | 'MATCHED' | 'RECONCILED';
export type BankReconciliationStatus = 'IN_PROGRESS' | 'COMPLETED';
export type ReconciliationMatchType = 'MANUAL' | 'EXACT_AUTO';

/** `GET/POST /api/finance/cash/accounts` response shape. `accountNumberMasked` is
 *  the only account-number field ever returned here — see `getCashAccountNumber`
 *  for the separate, Owner/Administrator-only reveal endpoint
 *  (docs/domains/cash-management.md "Bank Account Security"). */
export interface CashAccount {
  id: string;
  accountCode: string;
  name: string;
  accountType: CashAccountType;
  currency: string;
  bankName: string | null;
  accountNumberMasked: string | null;
  accountName: string | null;
  description: string | null;
  status: CashAccountStatus;
  linkedChartOfAccountId: string;
  openingBalance: number;
  openingBalanceDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCashAccountPayload {
  accountCode: string;
  name: string;
  accountType: CashAccountType;
  currency: string;
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
  description?: string;
  openingBalance?: number;
  openingBalanceDate?: string;
  idempotencyKey?: string;
}

export interface UpdateCashAccountPayload {
  name?: string;
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
  description?: string;
}

export function listCashAccounts(
  params: { status?: CashAccountStatus; accountType?: CashAccountType } = {},
): Promise<{ items: CashAccount[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.accountType) query.set('accountType', params.accountType);
  const queryString = query.toString();
  return apiFetch<{ items: CashAccount[] }>(
    `/finance/cash/accounts${queryString ? `?${queryString}` : ''}`,
  );
}

export function getCashAccount(id: string): Promise<CashAccount> {
  return apiFetch<CashAccount>(`/finance/cash/accounts/${id}`);
}

export function getCashAccountNumber(id: string): Promise<{ accountNumber: string | null }> {
  return apiFetch<{ accountNumber: string | null }>(`/finance/cash/accounts/${id}/account-number`);
}

export function createCashAccount(input: CreateCashAccountPayload): Promise<CashAccount> {
  return apiFetch<CashAccount>('/finance/cash/accounts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCashAccount(
  id: string,
  input: UpdateCashAccountPayload,
): Promise<CashAccount> {
  return apiFetch<CashAccount>(`/finance/cash/accounts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deactivateCashAccount(id: string): Promise<CashAccount> {
  return apiFetch<CashAccount>(`/finance/cash/accounts/${id}/deactivate`, { method: 'POST' });
}

export function activateCashAccount(id: string): Promise<CashAccount> {
  return apiFetch<CashAccount>(`/finance/cash/accounts/${id}/activate`, { method: 'POST' });
}

/** `GET/POST /api/finance/cash/transactions` response shape. */
export interface CashTransaction {
  id: string;
  cashAccountId: string;
  cashAccount: { id: string; accountCode: string; name: string };
  transactionType: CashTransactionType;
  transactionDate: string;
  amount: number;
  description: string;
  reference: string | null;
  contraAccountId: string;
  contraAccount: { id: string; code: string; name: string };
  status: PaymentStatus;
  createdAt: string;
}

export interface CreateCashTransactionPayload {
  cashAccountId: string;
  transactionType: CashTransactionType;
  transactionDate: string;
  amount: number;
  description: string;
  reference?: string;
  contraAccountId: string;
  idempotencyKey?: string;
}

export function listCashTransactions(
  params: { cashAccountId?: string } = {},
): Promise<{ items: CashTransaction[] }> {
  const query = new URLSearchParams();
  if (params.cashAccountId) query.set('cashAccountId', params.cashAccountId);
  const queryString = query.toString();
  return apiFetch<{ items: CashTransaction[] }>(
    `/finance/cash/transactions${queryString ? `?${queryString}` : ''}`,
  );
}

export function createCashTransaction(
  input: CreateCashTransactionPayload,
): Promise<CashTransaction> {
  return apiFetch<CashTransaction>('/finance/cash/transactions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function voidCashTransaction(id: string): Promise<CashTransaction> {
  return apiFetch<CashTransaction>(`/finance/cash/transactions/${id}/void`, { method: 'POST' });
}

/** One already-mapped, already-normalised CSV row (docs/domains/cash-management.md
 *  "CSV Import") — produced client-side by the column-mapping dialog, re-validated
 *  server-side independently. */
export interface BankStatementImportRow {
  transactionDate: string;
  valueDate?: string;
  description: string;
  reference?: string;
  debit?: number;
  credit?: number;
  balance?: number;
  externalReference?: string;
}

export interface BankStatementImport {
  id: string;
  cashAccountId: string;
  filename: string;
  importedById: string | null;
  importedAt: string;
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  errorRows: number;
}

export interface BankStatementTransaction {
  id: string;
  cashAccountId: string;
  importBatchId: string | null;
  transactionDate: string;
  valueDate: string | null;
  description: string;
  reference: string | null;
  debit: number;
  credit: number;
  amount: number;
  balance: number | null;
  externalReference: string | null;
  importedAt: string;
  matchStatus: BankTransactionMatchStatus;
}

export function listBankStatementImports(
  cashAccountId?: string,
): Promise<{ items: BankStatementImport[] }> {
  const query = new URLSearchParams();
  if (cashAccountId) query.set('cashAccountId', cashAccountId);
  const queryString = query.toString();
  return apiFetch<{ items: BankStatementImport[] }>(
    `/finance/cash/bank-statements/imports${queryString ? `?${queryString}` : ''}`,
  );
}

export function listBankStatementTransactions(
  params: { cashAccountId?: string; matchStatus?: BankTransactionMatchStatus } = {},
): Promise<{ items: BankStatementTransaction[] }> {
  const query = new URLSearchParams();
  if (params.cashAccountId) query.set('cashAccountId', params.cashAccountId);
  if (params.matchStatus) query.set('matchStatus', params.matchStatus);
  const queryString = query.toString();
  return apiFetch<{ items: BankStatementTransaction[] }>(
    `/finance/cash/bank-statements/transactions${queryString ? `?${queryString}` : ''}`,
  );
}

export function importBankStatement(
  cashAccountId: string,
  input: { filename: string; rows: BankStatementImportRow[]; idempotencyKey?: string },
): Promise<BankStatementImport> {
  return apiFetch<BankStatementImport>(`/finance/cash/bank-statements/${cashAccountId}/import`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** `GET/POST /api/finance/cash/reconciliations` list-row shape. */
export interface BankReconciliation {
  id: string;
  cashAccountId: string;
  periodStart: string;
  periodEnd: string;
  openingBankBalance: number;
  closingBankBalance: number;
  status: BankReconciliationStatus;
  reconciledById: string | null;
  reconciledAt: string | null;
  createdAt: string;
}

export interface ReconciliationMatchRow {
  id: string;
  matchType: ReconciliationMatchType;
  matchedAt: string;
  bankStatementTransaction: {
    id: string;
    transactionDate: string;
    description: string;
    reference: string | null;
    debit: number;
    credit: number;
    amount: number;
  };
  journalEntryLine: {
    id: string;
    debit: number;
    credit: number;
    description: string | null;
    journalEntryId: string;
    journalNumber: string;
    date: string;
  };
}

export interface UnmatchedBankRow {
  id: string;
  transactionDate: string;
  description: string;
  reference: string | null;
  debit: number;
  credit: number;
  amount: number;
}

export interface UnmatchedBookRow {
  id: string;
  debit: number;
  credit: number;
  description: string | null;
  journalEntryId: string;
  journalNumber: string;
  date: string;
}

/** `GET /api/finance/cash/reconciliations/:id` — the full reconciliation workspace
 *  view: matched/unmatched panels plus the live Book Balance/Difference figures
 *  (docs/domains/cash-management.md "Reconciliation"). */
export interface BankReconciliationDetail extends BankReconciliation {
  bookBalance: number;
  difference: number;
  matches: ReconciliationMatchRow[];
  unmatchedBank: UnmatchedBankRow[];
  unmatchedBook: UnmatchedBookRow[];
}

export interface CreateBankReconciliationPayload {
  cashAccountId: string;
  periodStart: string;
  periodEnd: string;
  openingBankBalance: number;
  closingBankBalance: number;
  idempotencyKey?: string;
}

export function listBankReconciliations(
  cashAccountId?: string,
): Promise<{ items: BankReconciliation[] }> {
  const query = new URLSearchParams();
  if (cashAccountId) query.set('cashAccountId', cashAccountId);
  const queryString = query.toString();
  return apiFetch<{ items: BankReconciliation[] }>(
    `/finance/cash/reconciliations${queryString ? `?${queryString}` : ''}`,
  );
}

export function getBankReconciliation(id: string): Promise<BankReconciliationDetail> {
  return apiFetch<BankReconciliationDetail>(`/finance/cash/reconciliations/${id}`);
}

export function createBankReconciliation(
  input: CreateBankReconciliationPayload,
): Promise<BankReconciliation> {
  return apiFetch<BankReconciliation>('/finance/cash/reconciliations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function autoMatchReconciliation(id: string): Promise<{ matchedCount: number }> {
  return apiFetch<{ matchedCount: number }>(`/finance/cash/reconciliations/${id}/auto-match`, {
    method: 'POST',
  });
}

export function matchReconciliation(
  id: string,
  input: { bankStatementTransactionId: string; journalEntryLineId: string },
): Promise<ReconciliationMatchRow> {
  return apiFetch<ReconciliationMatchRow>(`/finance/cash/reconciliations/${id}/match`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function unmatchReconciliation(id: string, matchId: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/finance/cash/reconciliations/${id}/unmatch/${matchId}`, {
    method: 'POST',
  });
}

export function completeReconciliation(id: string): Promise<BankReconciliation> {
  return apiFetch<BankReconciliation>(`/finance/cash/reconciliations/${id}/complete`, {
    method: 'POST',
  });
}

export interface CashAccountPosition {
  id: string;
  accountCode: string;
  name: string;
  accountType: CashAccountType;
  bookBalance: number;
  reconciledBalance: number;
  unreconciledDifference: number;
}

export interface CashRecentTransaction {
  id: string;
  date: string;
  description: string;
  journalNumber: string;
  debit: number;
  credit: number;
  cashAccountId: string;
  cashAccountName: string;
}

export interface CashOverview {
  totalCash: number;
  bankBalance: number;
  cashOnHand: number;
  totalUnreconciled: number;
  accounts: CashAccountPosition[];
  accountsRequiringReconciliation: CashAccountPosition[];
  recentTransactions: CashRecentTransaction[];
}

export function getCashOverview(): Promise<CashOverview> {
  return apiFetch<CashOverview>('/finance/cash/overview');
}

// === Cashflow Management (Sprint 15, docs/domains/cashflow.md) ===

export type CashflowDirection = 'INFLOW' | 'OUTFLOW';
export type CashflowRecurrence = 'ONE_TIME' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export type CashflowItemStatus = 'ACTIVE' | 'INACTIVE';
export type CashflowForecastSourceType =
  'CUSTOMER_RECEIVABLE' | 'SUPPLIER_PAYABLE' | 'RECURRING_ITEM' | 'MANUAL_FORECAST' | 'OTHER';
export type CashflowConfidence = 'CONFIRMED' | 'EXPECTED' | 'ESTIMATED';
export type CashflowBucketBy = 'weekly' | 'monthly';

/** `GET/POST /api/finance/cashflow/items` response shape — a management-entered
 *  future cash commitment, never a substitute for an Invoice/SupplierInvoice/
 *  Payment/SupplierPayment. `sourceType` is server-derived from `recurrence`. */
export interface CashflowForecastItem {
  id: string;
  cashAccountId: string | null;
  direction: CashflowDirection;
  sourceType: CashflowForecastSourceType;
  description: string;
  amount: number;
  currency: string;
  expectedDate: string;
  recurrence: CashflowRecurrence;
  recurrenceEndDate: string | null;
  status: CashflowItemStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCashflowForecastItemPayload {
  cashAccountId?: string;
  direction: CashflowDirection;
  description: string;
  amount: number;
  currency: string;
  expectedDate: string;
  recurrence?: CashflowRecurrence;
  recurrenceEndDate?: string;
  notes?: string;
  idempotencyKey?: string;
}

export interface UpdateCashflowForecastItemPayload {
  cashAccountId?: string | null;
  description?: string;
  amount?: number;
  expectedDate?: string;
  recurrenceEndDate?: string | null;
  notes?: string | null;
}

export function listCashflowForecastItems(
  params: { status?: CashflowItemStatus; cashAccountId?: string } = {},
): Promise<{ items: CashflowForecastItem[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.cashAccountId) query.set('cashAccountId', params.cashAccountId);
  const queryString = query.toString();
  return apiFetch<{ items: CashflowForecastItem[] }>(
    `/finance/cashflow/items${queryString ? `?${queryString}` : ''}`,
  );
}

export function createCashflowForecastItem(
  input: CreateCashflowForecastItemPayload,
): Promise<CashflowForecastItem> {
  return apiFetch<CashflowForecastItem>('/finance/cashflow/items', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCashflowForecastItem(
  id: string,
  input: UpdateCashflowForecastItemPayload,
): Promise<CashflowForecastItem> {
  return apiFetch<CashflowForecastItem>(`/finance/cashflow/items/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deactivateCashflowForecastItem(id: string): Promise<CashflowForecastItem> {
  return apiFetch<CashflowForecastItem>(`/finance/cashflow/items/${id}/deactivate`, {
    method: 'POST',
  });
}

export function activateCashflowForecastItem(id: string): Promise<CashflowForecastItem> {
  return apiFetch<CashflowForecastItem>(`/finance/cashflow/items/${id}/activate`, {
    method: 'POST',
  });
}

/** `GET/POST /api/finance/cashflow/scenarios` response shape — a named set of
 *  forecast-adjustment knobs, never a rules engine. */
export interface CashflowScenario {
  id: string;
  name: string;
  description: string | null;
  inflowDelayDays: number;
  inflowMultiplier: number;
  outflowDelayDays: number;
  outflowMultiplier: number;
  status: CashflowItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCashflowScenarioPayload {
  name: string;
  description?: string;
  inflowDelayDays?: number;
  inflowMultiplier?: number;
  outflowDelayDays?: number;
  outflowMultiplier?: number;
  idempotencyKey?: string;
}

export interface UpdateCashflowScenarioPayload {
  name?: string;
  description?: string | null;
  inflowDelayDays?: number;
  inflowMultiplier?: number;
  outflowDelayDays?: number;
  outflowMultiplier?: number;
}

export function listCashflowScenarios(
  params: { status?: CashflowItemStatus } = {},
): Promise<{ items: CashflowScenario[] }> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  const queryString = query.toString();
  return apiFetch<{ items: CashflowScenario[] }>(
    `/finance/cashflow/scenarios${queryString ? `?${queryString}` : ''}`,
  );
}

export function createCashflowScenario(
  input: CreateCashflowScenarioPayload,
): Promise<CashflowScenario> {
  return apiFetch<CashflowScenario>('/finance/cashflow/scenarios', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCashflowScenario(
  id: string,
  input: UpdateCashflowScenarioPayload,
): Promise<CashflowScenario> {
  return apiFetch<CashflowScenario>(`/finance/cashflow/scenarios/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deactivateCashflowScenario(id: string): Promise<CashflowScenario> {
  return apiFetch<CashflowScenario>(`/finance/cashflow/scenarios/${id}/deactivate`, {
    method: 'POST',
  });
}

/** `PUT /api/finance/cashflow/adjustments` — a per-invoice forecast override
 *  that never touches the underlying Invoice/SupplierInvoice row. */
export interface CashflowForecastAdjustment {
  id: string;
  sourceType: 'CUSTOMER_RECEIVABLE' | 'SUPPLIER_PAYABLE';
  sourceId: string;
  adjustedExpectedDate: string | null;
  adjustedAmount: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertCashflowForecastAdjustmentPayload {
  sourceType: 'CUSTOMER_RECEIVABLE' | 'SUPPLIER_PAYABLE';
  sourceId: string;
  adjustedExpectedDate?: string;
  adjustedAmount?: number;
  notes?: string;
  idempotencyKey?: string;
}

export function upsertCashflowForecastAdjustment(
  input: UpsertCashflowForecastAdjustmentPayload,
): Promise<CashflowForecastAdjustment> {
  return apiFetch<CashflowForecastAdjustment>('/finance/cashflow/adjustments', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

/** `GET/PUT /api/finance/cashflow/settings`. */
export interface CashflowSettings {
  minimumCashReserve: number;
  defaultCollectionDelayDays: number;
  defaultPaymentDelayDays: number;
}

export function getCashflowSettings(): Promise<CashflowSettings> {
  return apiFetch<CashflowSettings>('/finance/cashflow/settings');
}

export function updateCashflowSettings(
  input: Partial<CashflowSettings>,
): Promise<CashflowSettings> {
  return apiFetch<CashflowSettings>('/finance/cashflow/settings', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export interface CashflowForecastLineItem {
  sourceType: CashflowForecastSourceType;
  sourceId: string;
  description: string;
  direction: CashflowDirection;
  amount: number;
  expectedDate: string;
  confidence: CashflowConfidence;
  cashAccountId: string | null;
  adjusted: boolean;
}

export interface CashflowForecastBucket {
  periodStart: string;
  periodEnd: string;
  label: string;
  openingBalance: number;
  inflows: number;
  outflows: number;
  closingBalance: number;
  belowMinimumReserve: boolean;
  items: CashflowForecastLineItem[];
}

export interface CashflowForecastBreakdownRow {
  sourceType: CashflowForecastSourceType;
  total: number;
}

/** `GET /api/finance/cashflow/forecast` response shape — never stored; computed
 *  live on every request from AR/AP, Cash Accounts, and the models above. */
export interface CashflowForecastResult {
  horizonDays: number;
  bucketBy: CashflowBucketBy;
  scenarioId: string | null;
  cashAccountId: string | null;
  currentCash: number;
  forecastClosingCash: number;
  lowestProjectedCash: number;
  totalExpectedInflows: number;
  totalExpectedOutflows: number;
  minimumCashReserve: number;
  shortfallDetected: boolean;
  buckets: CashflowForecastBucket[];
  inflowBreakdown: CashflowForecastBreakdownRow[];
  outflowBreakdown: CashflowForecastBreakdownRow[];
}

export function getCashflowForecast(
  params: {
    horizonDays?: number;
    bucketBy?: CashflowBucketBy;
    scenarioId?: string;
    cashAccountId?: string;
  } = {},
): Promise<CashflowForecastResult> {
  const query = new URLSearchParams();
  if (params.horizonDays) query.set('horizonDays', String(params.horizonDays));
  if (params.bucketBy) query.set('bucketBy', params.bucketBy);
  if (params.scenarioId) query.set('scenarioId', params.scenarioId);
  if (params.cashAccountId) query.set('cashAccountId', params.cashAccountId);
  const queryString = query.toString();
  return apiFetch<CashflowForecastResult>(
    `/finance/cashflow/forecast${queryString ? `?${queryString}` : ''}`,
  );
}

export interface CashflowCashAccountForecastRow {
  cashAccountId: string;
  name: string;
  accountCode: string;
  currentBalance: number;
  projectedClosing: number;
}

export function getCashflowAccountBreakdown(
  horizonDays: number = 90,
): Promise<CashflowCashAccountForecastRow[]> {
  return apiFetch<CashflowCashAccountForecastRow[]>(
    `/finance/cashflow/accounts/breakdown?horizonDays=${horizonDays}`,
  );
}
