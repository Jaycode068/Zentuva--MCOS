import { Module } from '@nestjs/common';

import { FinanceModule } from '../finance/finance.module';
import { HrModule } from '../hr/hr.module';
import { AuthModule } from '../identity/auth/auth.module';
import { IdentityModule } from '../identity/identity.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { ProductionModule } from '../production/production.module';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';
import { InventoryPositionReportService } from './reports/inventory-position-report.service';
import { OperationalExceptionsReportService } from './reports/operational-exceptions-report.service';
import { PayablesReportService } from './reports/payables-report.service';
import { ProductionPerformanceReportService } from './reports/production-performance-report.service';
import { ReceivablesReportService } from './reports/receivables-report.service';
import { SalesPerformanceReportService } from './reports/sales-performance-report.service';
import { WorkforceSummaryReportService } from './reports/workforce-summary-report.service';

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation (docs/domains/reporting.md
 * "Reporting Module"). Deliberately sits ABOVE every domain it reports on — the
 * opposite coupling direction from every other domain-independence rule in this
 * codebase (Finance never imports Inventory, Production never imports Sales, etc.):
 * this module is ALLOWED to import many domain modules, because cross-domain
 * aggregation reusing each domain's own authoritative read services is this module's
 * entire purpose (brief §5A/§5D). No domain module imports `ReportingModule` back —
 * the dependency is strictly one-directional, verified by
 * `reporting-independence.spec.ts`.
 *
 * `FinanceModule` is imported for `FinancialStatementService`/`AccountsReceivableService`/
 * `AccountsPayableService`/`InventoryValuationService`/`RevenueCogsService` (all newly
 * exported this sprint, see `finance.module.ts`'s own updated doc comment).
 * `MaintenanceModule` for `MaintenanceOverviewService` (newly exported). `HrModule`
 * for the already-exported `EmployeeService` (widened this sprint with two new
 * headcount pass-throughs). `ProductionModule` for `ProductionMaterialIssueRepository`
 * (newly exported). `IdentityModule`/`AuthModule` for `OrganisationService`/
 * `EffectiveAccessResolver`/the JWT and permission guards — the same universal import
 * every domain module already has.
 *
 * Deliberately does NOT import `SalesModule`, `InventoryModule`, or `WorkflowModule`/
 * `NotificationsModule` — `SalesPerformanceReportService`/
 * `OperationalExceptionsReportService` read `SalesOrder`/`WorkflowStepInstance`/
 * `EmailDelivery`/`WhatsAppDelivery` via a narrow, direct, read-only `PrismaService`
 * query instead, the same "documented exception" shape `finance/reports/*` already
 * established for reading `InventoryStock` without importing `InventoryModule`.
 */
@Module({
  imports: [
    IdentityModule,
    AuthModule,
    FinanceModule,
    MaintenanceModule,
    HrModule,
    ProductionModule,
  ],
  controllers: [ReportingController],
  providers: [
    ReportingService,
    ReceivablesReportService,
    PayablesReportService,
    InventoryPositionReportService,
    SalesPerformanceReportService,
    ProductionPerformanceReportService,
    WorkforceSummaryReportService,
    OperationalExceptionsReportService,
  ],
})
export class ReportingModule {}
