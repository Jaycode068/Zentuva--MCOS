import { Module } from '@nestjs/common';

import { ProductModule } from '../catalogue/product/product.module';
import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { CustomerModule } from '../retail/customer/customer.module';
import { OutletModule } from '../retail/outlet/outlet.module';
import { SalesOrderController } from './sales-order.controller';
import { SalesOrderRepository } from './sales-order.repository';
import { SalesOrderService } from './sales-order.service';

/**
 * Sales HTTP surface (Sprint 4.8, docs/domains/sales.md). Imports `CustomerModule`,
 * `OutletModule`, and `ProductModule` so `SalesOrderService` can validate a Sales Order's
 * customer/outlet/SKU references. Deliberately does NOT import `NetworkRelationshipModule`
 * or `InventoryModule` — a Sales Order is a commercial transaction, never gated by the
 * distribution network, and creating/confirming one never touches inventory (see
 * docs/domains/retail-network.md "Capture the Market First" and docs/domains/sales.md
 * "Inventory Is Never Touched").
 */
@Module({
  imports: [IdentityModule, AuthModule, CustomerModule, OutletModule, ProductModule],
  controllers: [SalesOrderController],
  providers: [SalesOrderRepository, SalesOrderService],
})
export class SalesModule {}
