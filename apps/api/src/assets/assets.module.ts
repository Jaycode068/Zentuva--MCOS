import { Module } from '@nestjs/common';

import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { FileStorageModule } from '../identity/organisation/infrastructure/file-storage.module';
import { PurchaseOrderModule } from '../procurement/purchase-order/purchase-order.module';
import { SupplierModule } from '../suppliers/supplier/supplier.module';
import { AssetCategoryController } from './asset-category.controller';
import { AssetCategoryRepository } from './asset-category.repository';
import { AssetCategoryService } from './asset-category.service';
import { AssetDocumentRepository } from './asset-document.repository';
import { AssetDocumentService } from './asset-document.service';
import { AssetLocationController } from './asset-location.controller';
import { AssetLocationRepository } from './asset-location.repository';
import { AssetLocationService } from './asset-location.service';
import { AssetMeterRepository } from './asset-meter.repository';
import { AssetMeterService } from './asset-meter.service';
import { AssetController } from './asset.controller';
import { AssetRepository } from './asset.repository';
import { AssetService } from './asset.service';

/**
 * Asset Register & Asset Management HTTP surface (Sprint 20, docs/domains/
 * assets.md) — a genuinely new, first-class top-level domain, the
 * `production/`/`sales/`/`distribution/`/`inventory/` "one umbrella module
 * per top-level directory" convention, not folded into `FinanceModule`.
 *
 * Imports `IdentityModule`/`AuthModule` for `AuditService`/`UserService`/
 * guards (universal), `FileStorageModule` for asset photo/document
 * uploads, `PurchaseOrderModule`/`SupplierModule` (both small,
 * single-purpose, already-exported modules) so an Asset can validate/read
 * an optional acquisition-time Purchase Order/Supplier link read-only.
 *
 * **Deliberately never imports `FinanceModule` or `InventoryModule`.** An
 * Asset's optional `capitalProjectId` reference is validated via a
 * narrow, documented, read-only direct-Prisma reach inside
 * `AssetRepository.findCapitalProjectRef()` — not via importing Finance's
 * (unexported) `CapitalProjectRepository` — the same technique Sprint 13's
 * `InventoryValuationService` already established for `InventoryStock`.
 * `AssetLocation` is a new, purpose-built model (never `InventoryLocation`
 * — see docs/domains/assets.md "Why Not InventoryLocation"), so Asset
 * never touches Inventory at all. Proven executably by
 * `asset-independence.spec.ts`, not just documented here.
 */
@Module({
  imports: [IdentityModule, AuthModule, FileStorageModule, PurchaseOrderModule, SupplierModule],
  controllers: [AssetCategoryController, AssetLocationController, AssetController],
  providers: [
    AssetCategoryRepository,
    AssetCategoryService,
    AssetLocationRepository,
    AssetLocationService,
    AssetRepository,
    AssetService,
    AssetDocumentRepository,
    AssetDocumentService,
    AssetMeterRepository,
    AssetMeterService,
  ],
})
export class AssetsModule {}
