import { Module } from '@nestjs/common';

import { ProductModule } from '../../catalogue/product/product.module';
import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { SupplierModule } from '../../suppliers/supplier/supplier.module';
import { PurchaseOrderController } from './purchase-order.controller';
import { PurchaseOrderRepository } from './purchase-order.repository';
import { PurchaseOrderService } from './purchase-order.service';

/**
 * Procurement HTTP surface (Sprint 4.3). Imports `IdentityModule` for
 * `AuditService`/`RoleService` (the latter needed by `RolesGuard`) and `AuthModule` for
 * `JwtAuthGuard`/`RolesGuard` — same shape as `ProductModule`/`SupplierModule`.
 * `ProductModule`/`SupplierModule` are imported directly (not just transitively) so
 * `PurchaseOrderService` can inject their repositories to validate a PO's supplier and
 * item products without duplicating Prisma access (ADR-002: reference other domains by
 * their exported repository/service, never write to their tables directly).
 *
 * Exports `PurchaseOrderRepository` so other domains can read purchase orders without
 * duplicating Prisma access — first consumed by `InventoryModule` (Sprint 4.4) to
 * validate a Purchase Order is eligible to be received (exists, not cancelled, not
 * already received) before attempting to receive it. Inventory's actual *write* to
 * `PurchaseOrder.status` happens separately, inside `GoodsReceiptRepository.receive`'s
 * own transaction — see that file's doc comment for why.
 */
@Module({
  imports: [IdentityModule, AuthModule, ProductModule, SupplierModule],
  controllers: [PurchaseOrderController],
  providers: [PurchaseOrderRepository, PurchaseOrderService],
  exports: [PurchaseOrderRepository],
})
export class PurchaseOrderModule {}
