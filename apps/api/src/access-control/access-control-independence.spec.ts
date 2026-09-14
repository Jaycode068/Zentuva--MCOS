import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 25's central architectural guarantee, verified executably rather than just
 * documented (docs/domains/access-control.md §8/§9 "Tenant Isolation & Domain
 * Independence"): this module only ever writes `roles`/`role_permissions`/
 * `user_roles`/`permissions` (Identity's own tables, via `RoleService`) or
 * `Organisation.settings` (via `OrganisationService`) — never any Accounting/Finance/
 * Procurement/Supplier/Sales/Production/Distribution/Asset/Maintenance/HR table
 * directly. It imports `HrModule` read-only (the one deliberate, documented
 * exception — see `hr.module.ts`'s own doc comment) purely for the User Access admin
 * view's organisational-structure display; it never calls an HR write method.
 */
describe('Access Control independence (Sprint 25)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const ACCESS_CONTROL_FILES = [
    'access-audit-actions.ts',
    'access-role.controller.ts',
    'access-user.service.ts',
    'access-user.controller.ts',
    'access-common-policy.controller.ts',
    'access-overview.controller.ts',
    'access-control.module.ts',
  ];

  const FORBIDDEN_WRITE_PATTERN =
    /\.(invoice|supplierInvoice|payment|supplierPayment|journalEntry|journalEntryLine|cashTransaction|bankStatementTransaction|bankReconciliation|cashAccount|cashflowForecastItem|cashflowScenario|budget|budgetLine|costCentre|debtFacility|debtDrawdown|debtRepayment|capitalProject|capitalProjectCostLine|capitalProjectFunding|decisionAnalysis|decisionScenario|purchaseOrder|purchaseOrderItem|goodsReceipt|goodsReceiptItem|supplier|salesOrder|salesFulfilment|productionOrder|dispatch|delivery|inventoryStock|inventoryTransaction|inventoryLocation|product|asset|assetDowntime|workOrder|maintenanceType|maintenanceCost|maintenancePartUsage|department|position|employee|employeeDocument|employeeOnboarding|employeeOnboardingTask|workSchedule|attendanceRecord|attendanceCorrectionRequest|policy|policyVersion|policyAcknowledgement|trainingCourse|employeeTraining)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;

  it('structural guard: no Access Control file writes any Accounting/Finance/Procurement/Supplier/Sales/Production/Distribution/Asset/Maintenance/HR table', () => {
    for (const fileName of ACCESS_CONTROL_FILES) {
      expect(readSource(fileName)).not.toMatch(FORBIDDEN_WRITE_PATTERN);
    }
  });

  it('structural guard: postSystemJournalEntry is never called anywhere in access-control/', () => {
    for (const fileName of ACCESS_CONTROL_FILES) {
      expect(readSource(fileName)).not.toMatch(/postSystemJournalEntry\(/);
    }
  });

  it('structural guard: no Access Control file imports a Finance/Sales/Production/Distribution/Inventory/Procurement/Suppliers/Assets/Maintenance/Catalogue service, controller, or module — only Identity/Auth/HR (read-only) is a legitimate cross-domain import', () => {
    for (const fileName of ACCESS_CONTROL_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*\bfinance\//);
      expect(source).not.toMatch(/from ['"].*\bsales\//);
      expect(source).not.toMatch(/from ['"].*\bproduction\//);
      expect(source).not.toMatch(/from ['"].*\bdistribution\//);
      expect(source).not.toMatch(/from ['"].*\binventory\//);
      expect(source).not.toMatch(/from ['"].*\bprocurement\//);
      expect(source).not.toMatch(/from ['"].*\bsuppliers\//);
      expect(source).not.toMatch(/from ['"].*\bassets\//);
      expect(source).not.toMatch(/from ['"].*\bmaintenance\//);
      expect(source).not.toMatch(/from ['"].*\bcatalogue\//);
    }
  });

  it('structural guard: any HR import is limited to EmployeeService/DepartmentService/PositionService (read-only) — no HR repository is ever imported directly', () => {
    for (const fileName of ACCESS_CONTROL_FILES) {
      const source = readSource(fileName);
      const hrImportLines = source
        .split('\n')
        .filter((line) => /from ['"].*\/hr\//.test(line) || /from ['"]\.\.\/hr\//.test(line));
      for (const line of hrImportLines) {
        expect(line).not.toMatch(/Repository/);
        expect(line).toMatch(/EmployeeService|DepartmentService|PositionService|hr\.module/);
      }
    }
  });

  it('structural guard: AccessControlModule imports only IdentityModule/AuthModule/HrModule', () => {
    const source = readFileSync(join(__dirname, 'access-control.module.ts'), 'utf-8');
    const importsMatch = source.match(/imports:\s*\[([^\]]*)\]/);
    expect(importsMatch).not.toBeNull();
    const importedModules = (importsMatch![1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(new Set(importedModules)).toEqual(new Set(['IdentityModule', 'AuthModule', 'HrModule']));
  });

  it('structural guard: no UserRole/RolePermission/Role write bypasses RoleService (every write goes through the service layer, not a raw repository call from a controller)', () => {
    for (const fileName of ['access-role.controller.ts', 'access-user.controller.ts']) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/this\.prisma\.(role|permission|rolePermission|userRole)\./);
    }
  });
});
