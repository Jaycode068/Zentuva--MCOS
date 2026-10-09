import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 45 — Reporting & Business Intelligence Foundation (brief §4 "Reporting must
 * not mutate business records"). Verified executably rather than just documented —
 * the same structural-guard technique `finance/reports/reports-independence.spec.ts`
 * (Sprint 13) already established: no file in this module may write any business
 * table, and no file may import a domain *service or controller* class beyond the
 * small, explicit, documented set this sprint actually reuses
 * (`FinancialStatementService`/`AccountsReceivableService`/`AccountsPayableService`/
 * `InventoryValuationService`/`RevenueCogsService` from Finance,
 * `MaintenanceOverviewService` from Maintenance, `EmployeeService` from HR,
 * `ProductionMaterialIssueRepository` from Production — every one newly exported
 * this sprint specifically for this purpose, see each module's own updated doc
 * comment).
 */
describe('Reporting module independence (Sprint 45)', () => {
  function readSource(relativePath: string): string {
    return readFileSync(join(__dirname, relativePath), 'utf-8');
  }

  const SERVICE_FILES = [
    'reporting.service.ts',
    'reports/receivables-report.service.ts',
    'reports/payables-report.service.ts',
    'reports/inventory-position-report.service.ts',
    'reports/sales-performance-report.service.ts',
    'reports/production-performance-report.service.ts',
    'reports/workforce-summary-report.service.ts',
    'reports/operational-exceptions-report.service.ts',
  ];

  const FORBIDDEN_WRITE_PATTERN =
    /\.(journalEntry|journalEntryLine|inventoryStock|inventoryTransaction|invoice|supplierInvoice|payment|supplierPayment|salesOrder|purchaseOrder|productionOrder|productionRun|employee|workflowInstance|workflowStepInstance|emailDelivery|whatsAppDelivery)\.(create|update|updateMany|delete|deleteMany|upsert)\(/;

  it('structural guard: no reporting service file writes any business/transactional row directly', () => {
    for (const fileName of SERVICE_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(FORBIDDEN_WRITE_PATTERN);
    }
  });

  it('structural guard: no reporting file ever calls postSystemJournalEntry — reporting posts nothing', () => {
    for (const fileName of SERVICE_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/postSystemJournalEntry\(/);
    }
  });

  it('structural guard: no reporting file imports a domain service beyond the explicitly documented, newly-exported set', () => {
    // Keyed by import PATH (not just the imported name) — `PrismaService`,
    // `OrganisationService`/`EffectiveAccessResolver` (identity, universal to every
    // module), and this module's OWN `reports/*.service.ts` files are all expected
    // and excluded; only a genuine cross-DOMAIN service import is checked against
    // the explicit allowlist below.
    const ALLOWED_DOMAIN_SERVICE_PATHS = new Set([
      '../../finance/accounts-receivable.service',
      '../../finance/accounts-payable.service',
      '../../finance/reports/revenue-cogs.service',
      '../../finance/reports/inventory-valuation.service',
      '../../maintenance/maintenance-overview.service',
      '../../hr/employee.service',
    ]);
    const DOMAIN_SERVICE_IMPORT_PATTERN =
      /from\s*['"](\.\.\/\.\.\/(?:finance|sales|inventory|hr|maintenance|production|workflow|notifications|d2c)\/[\w./-]*\.service)['"]/g;

    for (const fileName of SERVICE_FILES) {
      const source = readSource(fileName);
      let match: RegExpExecArray | null;
      while ((match = DOMAIN_SERVICE_IMPORT_PATTERN.exec(source)) !== null) {
        expect(ALLOWED_DOMAIN_SERVICE_PATHS.has(match[1]!)).toBe(true);
      }
      // No reporting file ever imports a *.controller — a report service calling
      // into another domain's HTTP controller would be a structural layering
      // violation regardless of which controller it is.
      expect(source).not.toMatch(/from ['"].*\.controller['"]/);
    }
  });

  it('structural guard: no reporting file imports Sales/Inventory/Workflow/Notifications modules — those domains are read via a narrow, direct, read-only Prisma query instead', () => {
    for (const fileName of SERVICE_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*sales\/sales\.module['"]/);
      expect(source).not.toMatch(/from ['"].*inventory\/inventory\.module['"]/);
      expect(source).not.toMatch(/from ['"].*workflow\/workflow\.module['"]/);
      expect(source).not.toMatch(/from ['"].*notifications\/notifications\.module['"]/);
    }
  });

  it('structural guard: the ReportingModule only imports the documented domain modules, never a reverse dependency from any domain module back onto ReportingModule', () => {
    const moduleSource = readSource('reporting.module.ts');
    expect(moduleSource).toMatch(/imports:\s*\[[^\]]*FinanceModule/);
    expect(moduleSource).toMatch(/imports:\s*\[[^\]]*MaintenanceModule/);
    expect(moduleSource).toMatch(/imports:\s*\[[^\]]*HrModule/);
    expect(moduleSource).toMatch(/imports:\s*\[[^\]]*ProductionModule/);

    // No domain module anywhere in the API actually IMPORTS ReportingModule — the
    // dependency is strictly one-directional (reporting depends on domains, never
    // the reverse). A plain code-comment MENTION of "ReportingModule" (several of
    // these files' own updated doc comments explain, in prose, why they widened
    // their exports FOR the Reporting module) is not a violation — only a real
    // `import { ReportingModule } ...` statement or its use inside the `@Module`
    // decorator's `imports: [...]` array would be.
    const domainModuleFiles = [
      '../finance/finance.module.ts',
      '../maintenance/maintenance.module.ts',
      '../hr/hr.module.ts',
      '../production/production.module.ts',
      '../sales/sales.module.ts',
      '../inventory/inventory.module.ts',
      '../workflow/workflow.module.ts',
      '../notifications/notifications.module.ts',
    ];
    for (const relativePath of domainModuleFiles) {
      const source = readSource(relativePath);
      expect(source).not.toMatch(/import\s*\{[^}]*ReportingModule[^}]*\}/);
      expect(source).not.toMatch(/imports:\s*\[[^\]]*ReportingModule/);
    }
  });
});
