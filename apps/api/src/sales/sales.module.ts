import { Module } from '@nestjs/common';

import { ProductModule } from '../catalogue/product/product.module';
import { HrModule } from '../hr/hr.module';
import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { FileStorageModule } from '../identity/organisation/infrastructure/file-storage.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CustomerModule } from '../retail/customer/customer.module';
import { OutletModule } from '../retail/outlet/outlet.module';
import { CustomerReturnController } from './customer-return.controller';
import { CustomerReturnRepository } from './customer-return.repository';
import { CustomerReturnService } from './customer-return.service';
import { SalesFulfilmentRepository } from './sales-fulfilment.repository';
import { SalesFulfilmentService } from './sales-fulfilment.service';
import { SalesOrderController } from './sales-order.controller';
import { SalesOrderRepository } from './sales-order.repository';
import { SalesOrderService } from './sales-order.service';

/**
 * Sales HTTP surface (Sprint 4.8/4.9, docs/domains/sales.md). Imports `CustomerModule`,
 * `OutletModule`, and `ProductModule` so `SalesOrderService` can validate a Sales Order's
 * customer/outlet/SKU references, and (Sprint 4.9) `InventoryModule` so
 * `SalesFulfilmentService`/`SalesFulfilmentRepository` can read `InventoryStock` and
 * write the one atomic Fulfilment transaction. Deliberately does NOT import
 * `NetworkRelationshipModule` — a Sales Order is a commercial transaction, never gated by
 * the distribution network (see docs/domains/retail-network.md "Capture the Market
 * First").
 *
 * Importing `InventoryModule` is a deliberate, narrow, Sprint-4.9-only exception to
 * Sprint 4.8's "Sales never touches Inventory" rule, confirmed to apply ONLY to the
 * Fulfilment path: `SalesOrderService` (order create/update/confirm/cancel) still has
 * zero Inventory imports of its own — enforced structurally by
 * `direct-sales-independence.spec.ts`'s narrowed guard, which now reads
 * `sales-order.service.ts`'s own source rather than this module's.
 *
 * `exports` (Sprint 5) — `SalesOrderRepository`/`SalesFulfilmentRepository` are exported
 * so `DistributionModule` can inject them read-only (a Dispatch references an existing
 * Sales Order/Fulfilment; it never creates or mutates one) via ADR-002's "consume
 * another domain only through its exported repository" convention — same shape as
 * `InventoryModule`/`ProductModule` already exporting their own repositories.
 *
 * `HrModule` (Sprint 25.1, docs/architecture/authorization-coverage.md) — a deliberate,
 * narrow, read-only exception for `sales.order.view`'s `OWN_TEAM` scope: `SalesOrderController`
 * injects `EmployeeService` directly (never a repository) to resolve the caller's direct
 * reports' linked `User.id`s, the same "read-only HR import" pattern `AccessControlModule`
 * already established. `SalesOrderService` itself still has zero HR imports — enforced by
 * `direct-sales-independence.spec.ts`'s existing structural guards.
 */
@Module({
  imports: [
    IdentityModule,
    AuthModule,
    CustomerModule,
    OutletModule,
    ProductModule,
    InventoryModule,
    FileStorageModule,
    HrModule,
  ],
  controllers: [SalesOrderController, CustomerReturnController],
  providers: [
    SalesOrderRepository,
    SalesOrderService,
    SalesFulfilmentRepository,
    SalesFulfilmentService,
    CustomerReturnRepository,
    CustomerReturnService,
  ],
  exports: [SalesOrderRepository, SalesFulfilmentRepository],
})
export class SalesModule {}
