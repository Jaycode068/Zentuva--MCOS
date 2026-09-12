import { Module } from '@nestjs/common';

import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { FileStorageModule } from '../identity/organisation/infrastructure/file-storage.module';
import { DepartmentController } from './department.controller';
import { DepartmentRepository } from './department.repository';
import { DepartmentService } from './department.service';
import { EmployeeController } from './employee.controller';
import { EmployeeDocumentRepository } from './employee-document.repository';
import { EmployeeDocumentService } from './employee-document.service';
import { EmployeeOnboardingRepository } from './employee-onboarding.repository';
import { EmployeeOnboardingService } from './employee-onboarding.service';
import { EmployeeRepository } from './employee.repository';
import { EmployeeService } from './employee.service';
import { HrOrganisationStructureService } from './hr-organisation-structure.service';
import { HrOverviewController } from './hr-overview.controller';
import { HrOverviewService } from './hr-overview.service';
import { PositionController } from './position.controller';
import { PositionRepository } from './position.repository';
import { PositionService } from './position.service';

/**
 * HR Employee Lifecycle Foundation (Sprint 23, docs/domains/hr.md) — a
 * genuinely new top-level domain, the `assets/`/`maintenance/` "one
 * umbrella module per top-level directory" convention.
 *
 * Imports `IdentityModule` (universal — `AuditService`, and specifically
 * `UserService` here, read-only, to validate `Employee.userId` linking:
 * the target User must exist and belong to the same organisation;
 * `UserService.getById()` is already org-scoped so this is a genuine
 * reuse of an exported service, not a duplicated lookup), `AuthModule`
 * (guards), and `FileStorageModule` (employee document uploads, the exact
 * `AssetDocument`/`MaintenanceDocument` url/key pattern). No other
 * domain module is imported — HR does not read or write Accounting,
 * Inventory, Procurement, Production, Sales, Distribution, Asset, or
 * Maintenance data, and none of those domains import HR either.
 *
 * `Department`/`Position`/`Employee`/`EmployeeDocument`/
 * `EmployeeOnboarding`/`EmployeeOnboardingTask` are all owned and written
 * exclusively by this module's own repositories — proven executably by
 * `hr-independence.spec.ts`, not just documented here.
 */
@Module({
  imports: [IdentityModule, AuthModule, FileStorageModule],
  controllers: [DepartmentController, PositionController, EmployeeController, HrOverviewController],
  providers: [
    DepartmentRepository,
    DepartmentService,
    PositionRepository,
    PositionService,
    EmployeeRepository,
    EmployeeService,
    EmployeeDocumentRepository,
    EmployeeDocumentService,
    EmployeeOnboardingRepository,
    EmployeeOnboardingService,
    HrOverviewService,
    HrOrganisationStructureService,
  ],
})
export class HrModule {}
