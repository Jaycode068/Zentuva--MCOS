import { Module } from '@nestjs/common';

import { ProductModule } from '../catalogue/product/product.module';
import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { PurchaseOrderModule } from '../procurement/purchase-order/purchase-order.module';
import { GoodsReceiptRepository } from './goods-receipt.repository';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { InventoryStockRepository } from './inventory-stock.repository';
import { InventoryTransactionRepository } from './inventory-transaction.repository';

/**
 * Inventory HTTP surface (Sprint 4.4). Imports `IdentityModule` for
 * `AuditService`/`RoleService` (the latter needed by `RolesGuard`) and `AuthModule` for
 * `JwtAuthGuard`/`RolesGuard` — same shape as every other domain module.
 * `PurchaseOrderModule`/`ProductModule` are imported directly so `InventoryService` can
 * inject their exported repositories to validate a Purchase Order and its items without
 * duplicating Prisma access (ADR-002).
 */
@Module({
  imports: [IdentityModule, AuthModule, ProductModule, PurchaseOrderModule],
  controllers: [InventoryController],
  providers: [
    GoodsReceiptRepository,
    InventoryStockRepository,
    InventoryTransactionRepository,
    InventoryService,
  ],
})
export class InventoryModule {}
