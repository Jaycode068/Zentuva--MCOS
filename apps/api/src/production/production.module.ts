import { Module } from '@nestjs/common';

import { ProductModule } from '../catalogue/product/product.module';
import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { InventoryModule } from '../inventory/inventory.module';
import { BillOfMaterialController } from './bill-of-material.controller';
import { BillOfMaterialRepository } from './bill-of-material.repository';
import { BillOfMaterialService } from './bill-of-material.service';
import { ProductionMaterialIssueRepository } from './production-material-issue.repository';
import { ProductionOrderController } from './production-order.controller';
import { ProductionOrderRepository } from './production-order.repository';
import { ProductionOrderService } from './production-order.service';
import { ProductionRunRepository } from './production-run.repository';

/**
 * Production & Bill of Materials HTTP surface (Sprint 4.6, docs/domains/production.md).
 * Imports `IdentityModule` for `AuditService`/`RoleService` (the latter needed by
 * `RolesGuard`) and `AuthModule` for `JwtAuthGuard`/`RolesGuard` — same shape as every
 * other domain module. `ProductModule` is imported so `BillOfMaterialService` can inject
 * its exported `ProductRepository` to validate finished-product/component-type
 * restrictions without duplicating Prisma access (ADR-002). `InventoryModule` is
 * imported so `ProductionOrderService` can inject its exported
 * `InventoryStockRepository`/`InventoryLocationRepository` for read-only availability
 * checks and location validation — the atomic stock-moving *writes* (material issue,
 * finished-goods receipt) do not go through these imports; they follow
 * `GoodsReceiptRepository.receive`'s own precedent of writing directly to another
 * domain's tables inside a self-owned `$transaction`, a narrow, documented exception to
 * ADR-002 justified by atomicity (see `ProductionMaterialIssueRepository`/
 * `ProductionRunRepository`).
 *
 * Sprint 9 — `ProductionMaterialIssueRepository.issue`/`ProductionRunRepository.
 * complete` also post a Journal Entry via `postSystemJournalEntry`
 * (`../finance/accounting/journal-posting`). This is a plain TypeScript function
 * import, not a NestJS provider, so it introduces **no** module dependency on
 * `FinanceModule` here — this module's own `imports` array is unchanged by that
 * integration (see docs/domains/accounting.md "Accounting Posting Boundary", and
 * `production-finance-independence.spec.ts` for the executable proof).
 *
 * No `exports` — nothing else consumes Production this sprint.
 */
@Module({
  imports: [IdentityModule, AuthModule, ProductModule, InventoryModule],
  controllers: [BillOfMaterialController, ProductionOrderController],
  providers: [
    BillOfMaterialRepository,
    BillOfMaterialService,
    ProductionOrderRepository,
    ProductionMaterialIssueRepository,
    ProductionRunRepository,
    ProductionOrderService,
  ],
})
export class ProductionModule {}
