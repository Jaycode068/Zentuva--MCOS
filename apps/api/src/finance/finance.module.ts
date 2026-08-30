import { Module } from '@nestjs/common';

import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { PurchaseOrderModule } from '../procurement/purchase-order/purchase-order.module';
import { CustomerModule } from '../retail/customer/customer.module';
import { OutletModule } from '../retail/outlet/outlet.module';
import { SalesModule } from '../sales/sales.module';
import { SupplierModule } from '../suppliers/supplier/supplier.module';
import { AccountingPeriodController } from './accounting/accounting-period.controller';
import { AccountingPeriodRepository } from './accounting/accounting-period.repository';
import { AccountingPeriodService } from './accounting/accounting-period.service';
import { ChartOfAccountController } from './accounting/chart-of-account.controller';
import { ChartOfAccountRepository } from './accounting/chart-of-account.repository';
import { ChartOfAccountService } from './accounting/chart-of-account.service';
import { JournalEntryController } from './accounting/journal-entry.controller';
import { JournalEntryRepository } from './accounting/journal-entry.repository';
import { JournalEntryService } from './accounting/journal-entry.service';
import { LedgerController } from './accounting/ledger.controller';
import { LedgerService } from './accounting/ledger.service';
import { AccountsReceivableController } from './accounts-receivable.controller';
import { AccountsReceivableService } from './accounts-receivable.service';
import { CreditNoteController } from './credit-note.controller';
import { CreditNoteRepository } from './credit-note.repository';
import { CreditNoteService } from './credit-note.service';
import { InvoiceController } from './invoice.controller';
import { InvoiceRepository } from './invoice.repository';
import { InvoiceService } from './invoice.service';
import { PaymentController } from './payment.controller';
import { PaymentRepository } from './payment.repository';
import { PaymentService } from './payment.service';
import { AccountsPayableController } from './accounts-payable.controller';
import { AccountsPayableService } from './accounts-payable.service';
import { SupplierCreditNoteController } from './supplier-credit-note.controller';
import { SupplierCreditNoteRepository } from './supplier-credit-note.repository';
import { SupplierCreditNoteService } from './supplier-credit-note.service';
import { SupplierInvoiceController } from './supplier-invoice.controller';
import { SupplierInvoiceRepository } from './supplier-invoice.repository';
import { SupplierInvoiceService } from './supplier-invoice.service';
import { SupplierPaymentController } from './supplier-payment.controller';
import { SupplierPaymentRepository } from './supplier-payment.repository';
import { SupplierPaymentService } from './supplier-payment.service';
import { DashboardController } from './reports/dashboard.controller';
import { DashboardService } from './reports/dashboard.service';
import { FinancialStatementController } from './reports/financial-statement.controller';
import { FinancialStatementService } from './reports/financial-statement.service';
import { InventoryValuationController } from './reports/inventory-valuation.controller';
import { InventoryValuationService } from './reports/inventory-valuation.service';
import { ReconciliationController } from './reports/reconciliation.controller';
import { ReconciliationService } from './reports/reconciliation.service';
import { RevenueCogsController } from './reports/revenue-cogs.controller';
import { RevenueCogsService } from './reports/revenue-cogs.service';

/**
 * Finance HTTP surface (Sprint 6, docs/domains/finance.md) — Invoices, Payments, Credit
 * Notes, Accounts Receivable. Deliberately NOT a General Ledger/accounting system — see
 * docs/domains/finance.md "Deferred Accounting Work".
 *
 * Imports `SalesModule` to read `SalesOrderRepository` read-only (an Invoice references
 * an existing, fulfilled Sales Order; it never creates or mutates one), via ADR-002's
 * "consume another domain only through its exported repository" convention — same shape
 * as `DistributionModule` importing `SalesModule`. Imports `CustomerModule`/
 * `OutletModule` for the same read-only reference validation/display Sales and
 * Distribution already use. Imports `IdentityModule` for `AuditService`/
 * `OrganisationService` (currency snapshotting).
 *
 * Deliberately does NOT import `InventoryModule` or `DistributionModule` — Finance never
 * touches `InventoryStock`/`InventoryTransaction`/`Dispatch`/`Delivery` in any way,
 * proven executably by `finance-independence.spec.ts`, not just documented here.
 *
 * Sprint 7 (docs/domains/accounting.md) adds the Chart of Accounts/Accounting Period/
 * Journal Entry/Ledger controllers+services here too, rather than as a separate NestJS
 * module — `FinanceModule` already bundles several sub-concepts as one module (not
 * one-module-per-concept, unlike Retail's `customer/`/`outlet/`/...), and the new HTTP
 * routes stay under the same `/api/finance/*` prefix the frontend's `/settings/finance`
 * nav already expects. The actual atomic accounting-posting logic
 * (`accounting/journal-posting.ts`) is plain, DI-free functions imported directly by
 * `invoice.repository.ts`/`payment.repository.ts`/`credit-note.repository.ts` — no
 * module wiring is needed for that path at all, and future domains (Procurement,
 * Production, Inventory) will be able to import those same functions without depending
 * on `FinanceModule`.
 *
 * Sprint 12 (docs/domains/finance.md "Accounts Payable") adds `SupplierInvoice`/
 * `SupplierPayment`/`SupplierCreditNote`/`AccountsPayableService` here too, same
 * "bundle the sub-concept, don't spin up a new module" convention. Imports
 * `SupplierModule`/`PurchaseOrderModule` to read `SupplierRepository`/
 * `PurchaseOrderRepository` read-only (identity/eligibility resolution) — same ADR-002
 * shape as `SalesModule`/`CustomerModule`/`OutletModule` above. Still deliberately does
 * NOT import `InventoryModule`: `SupplierInvoiceRepository` reaches directly into
 * `GoodsReceiptItem` inside its own self-owned transaction for the 3-way match, the
 * exact same precedent `SupplierReturnRepository`/`CustomerReturnRepository` (Sprint 11)
 * already established — see `accounts-payable-independence.spec.ts`.
 *
 * Sprint 13 (docs/domains/accounting.md §16, "Financial Statements & Management
 * Reporting") adds `reports/` — Profit & Loss, Balance Sheet, AR/AP aging (added
 * directly to the existing AR/AP services above), Inventory Valuation, Inventory-
 * to-Ledger Reconciliation, Revenue/COGS drill-downs, and a Management Dashboard.
 * All read-only, deriving strictly from posted `JournalEntry`/`JournalEntryLine`
 * rows and existing operational data — no schema change, no new Journal Entries
 * ever posted from this code. `InventoryValuationService`/`ReconciliationService`
 * read `InventoryStock` directly (a narrow, read-only, transaction-free exception
 * mirroring Sprint 11/12's own "reach into another domain's table" precedent) —
 * `FinanceModule` still never imports `InventoryModule`; see
 * `reports-independence.spec.ts`.
 */
@Module({
  imports: [
    IdentityModule,
    AuthModule,
    SalesModule,
    CustomerModule,
    OutletModule,
    SupplierModule,
    PurchaseOrderModule,
  ],
  controllers: [
    InvoiceController,
    PaymentController,
    CreditNoteController,
    AccountsReceivableController,
    ChartOfAccountController,
    AccountingPeriodController,
    JournalEntryController,
    LedgerController,
    SupplierInvoiceController,
    SupplierPaymentController,
    SupplierCreditNoteController,
    AccountsPayableController,
    FinancialStatementController,
    InventoryValuationController,
    ReconciliationController,
    RevenueCogsController,
    DashboardController,
  ],
  providers: [
    InvoiceRepository,
    InvoiceService,
    PaymentRepository,
    PaymentService,
    CreditNoteRepository,
    CreditNoteService,
    AccountsReceivableService,
    ChartOfAccountRepository,
    ChartOfAccountService,
    AccountingPeriodRepository,
    AccountingPeriodService,
    JournalEntryRepository,
    JournalEntryService,
    LedgerService,
    SupplierInvoiceRepository,
    SupplierInvoiceService,
    SupplierPaymentRepository,
    SupplierPaymentService,
    SupplierCreditNoteRepository,
    SupplierCreditNoteService,
    AccountsPayableService,
    FinancialStatementService,
    InventoryValuationService,
    ReconciliationService,
    RevenueCogsService,
    DashboardService,
  ],
})
export class FinanceModule {}
