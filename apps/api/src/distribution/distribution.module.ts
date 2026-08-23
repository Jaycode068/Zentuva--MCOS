import { Module } from '@nestjs/common';

import { FileStorageModule } from '../identity/organisation/infrastructure/file-storage.module';
import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CustomerModule } from '../retail/customer/customer.module';
import { OutletModule } from '../retail/outlet/outlet.module';
import { SalesModule } from '../sales/sales.module';
import { DeliveryRepository } from './delivery.repository';
import { DeliveryService } from './delivery.service';
import { DispatchController } from './dispatch.controller';
import { DispatchRepository } from './dispatch.repository';
import { DispatchService } from './dispatch.service';

/**
 * Distribution HTTP surface (Sprint 5, docs/domains/distribution.md) — Dispatch (the
 * physical release of already-fulfilled goods) and Delivery (confirmation of what
 * actually arrived).
 *
 * Imports `SalesModule` to read `SalesFulfilmentRepository` read-only (a Dispatch
 * references an existing Sales Fulfilment; it never creates or mutates one), via
 * ADR-002's "consume another domain only through its exported repository" convention.
 * Imports `CustomerModule`/`OutletModule` for the same read-only destination
 * validation/display `SalesModule` already uses. Imports `InventoryModule` **only** for
 * `InventoryLocationRepository` — source-location validation/display — never
 * `InventoryStockRepository`/`InventoryTransactionRepository`; Sales Fulfilment remains
 * the sole inventory-deducting event in this codebase.
 *
 * Deliberately does NOT import `NetworkRelationshipModule` or `TerritoryModule` — the
 * distribution network is contextual display only, never a gate on dispatch/delivery
 * (see docs/domains/retail-network.md "Capture the Market First"). Both structural
 * guarantees are proven executably by `distribution-inventory-independence.spec.ts`, not
 * just documented here.
 */
@Module({
  imports: [
    IdentityModule,
    AuthModule,
    SalesModule,
    CustomerModule,
    OutletModule,
    InventoryModule,
    FileStorageModule,
  ],
  controllers: [DispatchController],
  providers: [DispatchRepository, DispatchService, DeliveryRepository, DeliveryService],
})
export class DistributionModule {}
