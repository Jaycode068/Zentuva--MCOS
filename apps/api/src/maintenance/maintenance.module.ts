import { Module } from '@nestjs/common';

import { AssetsModule } from '../assets/assets.module';
import { ProductModule } from '../catalogue/product/product.module';
import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { FileStorageModule } from '../identity/organisation/infrastructure/file-storage.module';
import { SupplierModule } from '../suppliers/supplier/supplier.module';
import { AssetDowntimeController } from './asset-downtime.controller';
import { AssetDowntimeRepository } from './asset-downtime.repository';
import { AssetDowntimeService } from './asset-downtime.service';
import { MaintenanceCostController } from './maintenance-cost.controller';
import { MaintenanceCostRepository } from './maintenance-cost.repository';
import { MaintenanceCostService } from './maintenance-cost.service';
import { MaintenanceDocumentRepository } from './maintenance-document.repository';
import { MaintenanceDocumentService } from './maintenance-document.service';
import { MaintenanceOverviewController } from './maintenance-overview.controller';
import { MaintenanceOverviewService } from './maintenance-overview.service';
import { MaintenancePartUsageController } from './maintenance-part-usage.controller';
import { MaintenancePartUsageRepository } from './maintenance-part-usage.repository';
import { MaintenancePartUsageService } from './maintenance-part-usage.service';
import { MaintenancePlanController } from './maintenance-plan.controller';
import { MaintenancePlanRepository } from './maintenance-plan.repository';
import { MaintenancePlanService } from './maintenance-plan.service';
import { MaintenanceRequestController } from './maintenance-request.controller';
import { MaintenanceRequestRepository } from './maintenance-request.repository';
import { MaintenanceRequestService } from './maintenance-request.service';
import { MaintenanceScheduleController } from './maintenance-schedule.controller';
import { MaintenanceScheduleRepository } from './maintenance-schedule.repository';
import { MaintenanceScheduleService } from './maintenance-schedule.service';
import { MaintenanceTypeController } from './maintenance-type.controller';
import { MaintenanceTypeRepository } from './maintenance-type.repository';
import { MaintenanceTypeService } from './maintenance-type.service';
import { WorkOrderController } from './work-order.controller';
import { WorkOrderRepository } from './work-order.repository';
import { WorkOrderService } from './work-order.service';

/**
 * Maintenance Management HTTP surface (Sprint 21, docs/domains/
 * maintenance.md) — a genuinely new top-level domain built on top of
 * Sprint 20's Asset Register, the `assets/`/`production/`/`sales/` "one
 * umbrella module per top-level directory" convention.
 *
 * Imports `AssetsModule` (now exporting `AssetRepository`/`AssetService`/
 * `AssetMeterRepository`/`AssetMeterService`/`AssetCategoryRepository` —
 * see `assets.module.ts`'s own updated doc comment) so Maintenance can
 * validate/read assets and drive the `IN_SERVICE ⇄ UNDER_MAINTENANCE`
 * transition through `AssetService`'s own lifecycle methods, and reuse
 * the existing meter infrastructure — never a second meter system.
 * `ProductModule`/`SupplierModule` (both small, already-exported modules)
 * are imported read-only, for `MaintenancePartUsage.productId`/
 * `MaintenanceCost.supplierId`/`WorkOrder.externalSupplierId` validation.
 * `IdentityModule`/`AuthModule` for `AuditService`/`UserService`/guards
 * (universal); `FileStorageModule` for request/work-order photo uploads.
 *
 * **Deliberately never imports `FinanceModule` or `InventoryModule`.**
 * Recording a maintenance cost never posts a Journal Entry; recording a
 * part usage never deducts `InventoryStock`/creates an
 * `InventoryTransaction` — proven executably by
 * `maintenance-independence.spec.ts`, not just documented here.
 */
@Module({
  imports: [
    IdentityModule,
    AuthModule,
    FileStorageModule,
    AssetsModule,
    ProductModule,
    SupplierModule,
  ],
  controllers: [
    MaintenanceTypeController,
    MaintenancePlanController,
    MaintenanceScheduleController,
    MaintenanceRequestController,
    WorkOrderController,
    AssetDowntimeController,
    MaintenancePartUsageController,
    MaintenanceCostController,
    MaintenanceOverviewController,
  ],
  providers: [
    MaintenanceTypeRepository,
    MaintenanceTypeService,
    MaintenancePlanRepository,
    MaintenancePlanService,
    MaintenanceScheduleRepository,
    MaintenanceScheduleService,
    MaintenanceRequestRepository,
    MaintenanceRequestService,
    WorkOrderRepository,
    WorkOrderService,
    AssetDowntimeRepository,
    AssetDowntimeService,
    MaintenancePartUsageRepository,
    MaintenancePartUsageService,
    MaintenanceCostRepository,
    MaintenanceCostService,
    MaintenanceDocumentRepository,
    MaintenanceDocumentService,
    MaintenanceOverviewService,
  ],
})
export class MaintenanceModule {}
