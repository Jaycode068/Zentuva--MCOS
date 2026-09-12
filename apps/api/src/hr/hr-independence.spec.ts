import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 23's central architectural guarantee, verified executably rather
 * than just documented (docs/domains/hr.md "Tenant Isolation & Domain
 * Independence"): creating/updating a Department, Position, Employee,
 * EmployeeDocument, or onboarding record never posts a Journal Entry and
 * never mutates any Accounting/Inventory/Procurement/Sales/Production/
 * Distribution/Asset/Maintenance table. Unlike Maintenance (which has one
 * deliberate Inventory-write exception), HR has **no** cross-domain write
 * exception at all — every table it touches is its own. Mirrors
 * `maintenance-independence.spec.ts`'s exact structural-guard technique.
 */
describe('HR Employee Lifecycle Foundation independence (Sprint 23)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const HR_FILES = [
    'hr-hierarchy.util.ts',
    'hr-audit-actions.ts',
    'employee-code.ts',
    'department.repository.ts',
    'department.service.ts',
    'department.controller.ts',
    'position.repository.ts',
    'position.service.ts',
    'position.controller.ts',
    'employee.repository.ts',
    'employee.service.ts',
    'employee.controller.ts',
    'employee-document.repository.ts',
    'employee-document.service.ts',
    'employee-onboarding.repository.ts',
    'employee-onboarding.service.ts',
    'hr-overview.service.ts',
    'hr-organisation-structure.service.ts',
    'hr-overview.controller.ts',
  ];

  const FORBIDDEN_WRITE_PATTERN =
    /\.(invoice|supplierInvoice|payment|supplierPayment|journalEntry|journalEntryLine|cashTransaction|bankStatementTransaction|bankReconciliation|cashAccount|cashflowForecastItem|cashflowScenario|budget|budgetLine|costCentre|debtFacility|debtDrawdown|debtRepayment|capitalProject|capitalProjectCostLine|capitalProjectFunding|decisionAnalysis|decisionScenario|purchaseOrder|purchaseOrderItem|goodsReceipt|goodsReceiptItem|supplier|salesOrder|salesFulfilment|productionOrder|dispatch|delivery|inventoryStock|inventoryTransaction|inventoryLocation|product|asset|assetDowntime|workOrder|maintenanceType|maintenanceCost|maintenancePartUsage)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;

  it('structural guard: no HR file writes any Accounting/Finance/Procurement/Supplier/Sales/Production/Distribution/Asset/Maintenance table', () => {
    for (const fileName of HR_FILES) {
      expect(readSource(fileName)).not.toMatch(FORBIDDEN_WRITE_PATTERN);
    }
  });

  it('structural guard: postSystemJournalEntry is never called anywhere in hr/ — HR never posts a Journal Entry', () => {
    for (const fileName of HR_FILES) {
      expect(readSource(fileName)).not.toMatch(/postSystemJournalEntry\(/);
    }
  });

  it('structural guard: no HR file imports a Finance/Sales/Production/Distribution/Inventory/Procurement/Suppliers/Assets/Maintenance/Catalogue service, controller, or module — only IdentityModule/UserService is a legitimate cross-domain import', () => {
    for (const fileName of HR_FILES) {
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

  it('structural guard: HrModule imports only IdentityModule/AuthModule/FileStorageModule — no other domain module', () => {
    const source = readFileSync(join(__dirname, 'hr.module.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"].*finance\/finance\.module/);
    expect(source).not.toMatch(/from ['"].*production\/production\.module/);
    expect(source).not.toMatch(/from ['"].*procurement\/.*\.module/);
    expect(source).not.toMatch(/from ['"].*inventory\/inventory\.module/);
    expect(source).not.toMatch(/from ['"].*assets\/assets\.module/);
    expect(source).not.toMatch(/from ['"].*maintenance\/maintenance\.module/);
    const importsMatch = source.match(/imports:\s*\[([^\]]*)\]/);
    expect(importsMatch).not.toBeNull();
    const importedModules = (importsMatch![1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(new Set(importedModules)).toEqual(
      new Set(['IdentityModule', 'AuthModule', 'FileStorageModule']),
    );
  });

  it("structural guard: only the domain's own repository files ever write their own hr_* tables — every service/controller file is read-only or pure composition", () => {
    const writingFiles = new Set([
      'department.repository.ts',
      'position.repository.ts',
      'employee.repository.ts',
      'employee-document.repository.ts',
      'employee-onboarding.repository.ts',
    ]);
    const ownWritePattern =
      /\.(department|position|employee|employeeDocument|employeeOnboarding|employeeOnboardingTask)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;
    for (const fileName of HR_FILES) {
      if (writingFiles.has(fileName)) continue;
      expect(readSource(fileName)).not.toMatch(ownWritePattern);
    }
  });

  it('structural guard: Employee.employeeCode is always server-generated — the controller never trusts a client-supplied employeeCode', () => {
    const controllerSource = readSource('employee.controller.ts');
    expect(controllerSource).not.toMatch(/body\.employeeCode/);
    const repositorySource = readSource('employee.repository.ts');
    expect(repositorySource).toMatch(/generateEmployeeCode\(tx, data\.organisationId\)/);
  });

  it('structural guard: linking an Employee to a User never grants a permission — no UserRole/RolePermission write anywhere in hr/', () => {
    for (const fileName of HR_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(
        /\.(userRole|rolePermission|role)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/,
      );
    }
  });
});
