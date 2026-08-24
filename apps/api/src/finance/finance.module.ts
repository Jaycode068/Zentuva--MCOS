import { Module } from '@nestjs/common';

import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { CustomerModule } from '../retail/customer/customer.module';
import { OutletModule } from '../retail/outlet/outlet.module';
import { SalesModule } from '../sales/sales.module';
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
 */
@Module({
  imports: [IdentityModule, AuthModule, SalesModule, CustomerModule, OutletModule],
  controllers: [
    InvoiceController,
    PaymentController,
    CreditNoteController,
    AccountsReceivableController,
    ChartOfAccountController,
    AccountingPeriodController,
    JournalEntryController,
    LedgerController,
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
  ],
})
export class FinanceModule {}
