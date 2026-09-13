import { Module } from '@nestjs/common';

import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { FileStorageModule } from '../identity/organisation/infrastructure/file-storage.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceCorrectionRepository } from './attendance-correction.repository';
import { AttendanceCorrectionService } from './attendance-correction.service';
import { AttendanceRepository } from './attendance.repository';
import { AttendanceService } from './attendance.service';
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
import { EmployeeTrainingRepository } from './employee-training.repository';
import { EmployeeTrainingService } from './employee-training.service';
import { HrOrganisationStructureService } from './hr-organisation-structure.service';
import { HrOverviewController } from './hr-overview.controller';
import { HrOverviewService } from './hr-overview.service';
import { PolicyAcknowledgementRepository } from './policy-acknowledgement.repository';
import { PolicyController } from './policy.controller';
import { PolicyRepository } from './policy.repository';
import { PolicyService } from './policy.service';
import { PositionController } from './position.controller';
import { PositionRepository } from './position.repository';
import { PositionService } from './position.service';
import { TrainingController } from './training.controller';
import { TrainingCourseRepository } from './training-course.repository';
import { TrainingCourseService } from './training-course.service';
import { WorkScheduleController } from './work-schedule.controller';
import { WorkScheduleRepository } from './work-schedule.repository';
import { WorkScheduleService } from './work-schedule.service';

/**
 * HR domain module (Sprint 23 Employee Lifecycle Foundation + Sprint 24
 * Attendance, Training & People Operations, docs/domains/hr.md) — the
 * `assets/`/`maintenance/` "one umbrella module per top-level directory"
 * convention.
 *
 * Imports `IdentityModule` (universal — `AuditService`, `OrganisationService`
 * for `timeZone`-based attendance-date bucketing added Sprint 24, and
 * `UserService` for Employee↔User link validation), `AuthModule` (guards),
 * and `FileStorageModule` (employee document uploads). No other domain
 * module is imported — HR does not read or write Accounting, Inventory,
 * Procurement, Production, Sales, Distribution, Asset, or Maintenance data,
 * and none of those domains import HR either.
 *
 * Every `hr_*`-mapped table is owned and written exclusively by this
 * module's own repositories — proven executably by
 * `hr-independence.spec.ts`/`hr-attendance-independence.spec.ts`, not just
 * documented here.
 */
@Module({
  imports: [IdentityModule, AuthModule, FileStorageModule],
  controllers: [
    DepartmentController,
    PositionController,
    EmployeeController,
    HrOverviewController,
    WorkScheduleController,
    AttendanceController,
    PolicyController,
    TrainingController,
  ],
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
    WorkScheduleRepository,
    WorkScheduleService,
    AttendanceRepository,
    AttendanceService,
    AttendanceCorrectionRepository,
    AttendanceCorrectionService,
    PolicyRepository,
    PolicyAcknowledgementRepository,
    PolicyService,
    TrainingCourseRepository,
    TrainingCourseService,
    EmployeeTrainingRepository,
    EmployeeTrainingService,
  ],
})
export class HrModule {}
