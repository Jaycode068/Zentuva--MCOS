import { Module } from '@nestjs/common';

import { ProductModule } from '../catalogue/product/product.module';
import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { PurchaseOrderModule } from '../procurement/purchase-order/purchase-order.module';
import { GoodsReceiptRepository } from './goods-receipt.repository';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { InventoryLocationRepository } from './inventory-location.repository';
import { InventoryStockRepository } from './inventory-stock.repository';
import { InventoryTransactionRepository } from './inventory-transaction.repository';

/**
 * Inventory HTTP surface (Sprint 4.4). Imports `IdentityModule` for
 * `AuditService`/`RoleService` (the latter needed by `RolesGuard`) and `AuthModule` for
 * `JwtAuthGuard`/`RolesGuard` — same shape as every other domain module.
 * `PurchaseOrderModule`/`ProductModule` are imported directly so `InventoryService` can
 * inject their exported repositories to validate a Purchase Order and its items without
 * duplicating Prisma access (ADR-002).
 *
 * `exports` (Sprint 4.6) — `GoodsReceiptRepository` is deliberately NOT exported;
 * Production never needs to read/write Goods Receipts. The other three are exported so
 * `ProductionModule` can inject them read-only (material-availability checks, location
 * validation) via ADR-002's "consume another domain only through its exported
 * repository" convention — same shape as `ProductModule`/`PurchaseOrderModule` already
 * exporting their own repositories for this module's own use. Production's actual
 * stock-moving *writes* (material issue, finished-goods receipt) do not go through these
 * exports — they follow `GoodsReceiptRepository.receive`'s own precedent of writing
 * directly to another domain's tables inside a self-owned `$transaction`, a narrow,
 * documented exception to ADR-002 justified by atomicity (see
 * docs/domains/production.md "Integration Points").
 */
@Module({
  imports: [IdentityModule, AuthModule, ProductModule, PurchaseOrderModule],
  controllers: [InventoryController],
  providers: [
    GoodsReceiptRepository,
    InventoryStockRepository,
    InventoryTransactionRepository,
    InventoryLocationRepository,
    InventoryService,
  ],
  exports: [InventoryStockRepository, InventoryTransactionRepository, InventoryLocationRepository],
})
export class InventoryModule {}
