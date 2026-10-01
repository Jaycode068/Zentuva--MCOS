import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { FileStorageModule } from '../../identity/organisation/infrastructure/file-storage.module';
import { IdentityModule } from '../../identity/identity.module';
import { InventoryModule } from '../../inventory/inventory.module';
import { CustomerModule } from '../customer/customer.module';
import { TerritoryModule } from '../territory/territory.module';
import { OutletController } from './outlet.controller';
import { OutletRepository } from './outlet.repository';
import { OutletPhotoRepository } from './outlet-photo.repository';
import { OutletService } from './outlet.service';

/**
 * Outlet HTTP surface (Sprint 4.8, docs/domains/outlets.md). Imports `CustomerModule` +
 * `TerritoryModule` so `OutletService` can validate an outlet's `customerId`/optional
 * `territoryId`, `FileStorageModule` for outlet-photo uploads (the port itself is
 * unmodified — see `OutletPhotoRepository`'s docblock), and `InventoryModule` (Sprint 37)
 * so `OutletService` can validate a Collection Point's optional `inventoryLocationId`
 * bridge. Exports `OutletRepository` so `SalesModule` can inject it to validate a Sales
 * Order's optional `outletId` belongs to the order's own customer, and so the new
 * Sprint 37 Collection Point Fulfillment module can look up an assigned outlet directly.
 */
@Module({
  imports: [
    IdentityModule,
    AuthModule,
    CustomerModule,
    TerritoryModule,
    FileStorageModule,
    InventoryModule,
  ],
  controllers: [OutletController],
  providers: [OutletRepository, OutletPhotoRepository, OutletService],
  exports: [OutletRepository],
})
export class OutletModule {}
