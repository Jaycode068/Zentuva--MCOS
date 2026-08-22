import { Module } from '@nestjs/common';

import { AuthModule } from '../../identity/auth/auth.module';
import { FileStorageModule } from '../../identity/organisation/infrastructure/file-storage.module';
import { IdentityModule } from '../../identity/identity.module';
import { CustomerModule } from '../customer/customer.module';
import { TerritoryModule } from '../territory/territory.module';
import { OutletController } from './outlet.controller';
import { OutletRepository } from './outlet.repository';
import { OutletPhotoRepository } from './outlet-photo.repository';
import { OutletService } from './outlet.service';

/**
 * Outlet HTTP surface (Sprint 4.8, docs/domains/outlets.md). Imports `CustomerModule` +
 * `TerritoryModule` so `OutletService` can validate an outlet's `customerId`/optional
 * `territoryId`, and `FileStorageModule` for outlet-photo uploads (the port itself is
 * unmodified — see `OutletPhotoRepository`'s docblock). Exports `OutletRepository` so
 * `SalesModule` can inject it to validate a Sales Order's optional `outletId` belongs to
 * the order's own customer.
 */
@Module({
  imports: [IdentityModule, AuthModule, CustomerModule, TerritoryModule, FileStorageModule],
  controllers: [OutletController],
  providers: [OutletRepository, OutletPhotoRepository, OutletService],
  exports: [OutletRepository],
})
export class OutletModule {}
