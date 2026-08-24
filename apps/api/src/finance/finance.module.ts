import { Module } from '@nestjs/common';

import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { CustomerModule } from '../retail/customer/customer.module';
import { OutletModule } from '../retail/outlet/outlet.module';
import { SalesModule } from '../sales/sales.module';
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
 */
@Module({
  imports: [IdentityModule, AuthModule, SalesModule, CustomerModule, OutletModule],
  controllers: [
    InvoiceController,
    PaymentController,
    CreditNoteController,
    AccountsReceivableController,
  ],
  providers: [
    InvoiceRepository,
    InvoiceService,
    PaymentRepository,
    PaymentService,
    CreditNoteRepository,
    CreditNoteService,
    AccountsReceivableService,
  ],
})
export class FinanceModule {}
