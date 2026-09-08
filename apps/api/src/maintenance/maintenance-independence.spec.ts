import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 21's central architectural guarantee, verified executably rather
 * than just documented (docs/domains/maintenance.md "Structural
 * Independence"): recording a maintenance request, plan, schedule, work
 * order, task, downtime window, part usage, or cost never posts a Journal
 * Entry and never mutates any real Finance/Inventory/Sales/Production/
 * Distribution table. `ProductRepository`/`SupplierRepository` (read-only,
 * already exported into `MaintenanceModule`) are the two deliberate,
 * narrow exceptions every prior sprint's own independence spec already
 * establishes this same pattern for. Mirrors `asset-independence.spec.ts`'s
 * exact structural-guard technique (Sprint 20).
 */
describe('Maintenance Management independence (Sprint 21)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const MAINTENANCE_FILES = [
    'work-order-code.ts',
    'maintenance-type.repository.ts',
    'maintenance-type.service.ts',
    'maintenance-type.controller.ts',
    'maintenance-plan.repository.ts',
    'maintenance-plan.service.ts',
    'maintenance-plan.controller.ts',
    'maintenance-schedule.repository.ts',
    'maintenance-schedule.service.ts',
    'maintenance-schedule.controller.ts',
    'maintenance-request.repository.ts',
    'maintenance-request.service.ts',
    'maintenance-request.controller.ts',
    'work-order.repository.ts',
    'work-order.service.ts',
    'work-order.controller.ts',
    'asset-downtime.repository.ts',
    'asset-downtime.service.ts',
    'asset-downtime.controller.ts',
    'maintenance-part-usage.repository.ts',
    'maintenance-part-usage.service.ts',
    'maintenance-part-usage.controller.ts',
    'maintenance-cost.repository.ts',
    'maintenance-cost.service.ts',
    'maintenance-cost.controller.ts',
    'maintenance-document.repository.ts',
    'maintenance-document.service.ts',
    'maintenance-overview.service.ts',
    'maintenance-overview.controller.ts',
  ];

  const FORBIDDEN_WRITE_PATTERN =
    /\.(invoice|supplierInvoice|payment|supplierPayment|journalEntry|journalEntryLine|cashTransaction|bankStatementTransaction|bankReconciliation|cashAccount|cashflowForecastItem|cashflowScenario|budget|budgetLine|costCentre|debtFacility|debtDrawdown|debtRepayment|capitalProject|capitalProjectCostLine|capitalProjectFunding|decisionAnalysis|decisionScenario|purchaseOrder|purchaseOrderItem|goodsReceipt|goodsReceiptItem|supplier|salesOrder|salesFulfilment|productionOrder|dispatch|delivery|inventoryStock|inventoryTransaction|inventoryLocation|product)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;

  it('structural guard: no maintenance file writes any Finance/Procurement/Supplier/Sales/Production/Inventory/Product table, directly', () => {
    for (const fileName of MAINTENANCE_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(FORBIDDEN_WRITE_PATTERN);
    }
  });

  it('structural guard: postSystemJournalEntry is never called anywhere in maintenance/ — no maintenance operation ever posts a Journal Entry', () => {
    for (const fileName of MAINTENANCE_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/postSystemJournalEntry\(/);
    }
  });

  it('structural guard: InventoryStock/InventoryTransaction are never written — recording a maintenance part usage never deducts inventory', () => {
    const source = readSource('maintenance-part-usage.repository.ts');
    expect(source).not.toMatch(/\.(inventoryStock|inventoryTransaction)\.(create|update|upsert)\(/);
    // inventoryTransactionId is always written as null/undefined — never
    // resolved to a real InventoryTransaction row this sprint.
    expect(source).not.toMatch(/tx\.inventoryTransaction\.create/);
  });

  it('structural guard: no maintenance file imports a Finance/Sales/Inventory/Production/Distribution service, controller, or module — Asset/Product/Supplier are imported read-only only', () => {
    for (const fileName of MAINTENANCE_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*\bfinance\//);
      expect(source).not.toMatch(/from ['"].*\binventory\//);
      expect(source).not.toMatch(/from ['"].*\bsales\//);
      expect(source).not.toMatch(/from ['"].*\bproduction\//);
      expect(source).not.toMatch(/from ['"].*\bdistribution\//);
      expect(source).not.toMatch(/from ['"].*procurement\/.*\.(controller|module)['"]/);
      expect(source).not.toMatch(/from ['"].*suppliers\/.*\.(controller|module)['"]/);
      expect(source).not.toMatch(/from ['"].*catalogue\/.*\.(controller|module)['"]/);
    }
  });

  it('structural guard: MaintenanceModule never imports FinanceModule or InventoryModule', () => {
    const source = readFileSync(join(__dirname, 'maintenance.module.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"].*finance\/finance\.module/);
    expect(source).not.toMatch(/from ['"].*inventory\/inventory\.module/);
  });

  it('structural guard: the Asset lifecycle transition is only ever driven through AssetService — no raw Prisma write against the asset table', () => {
    for (const fileName of MAINTENANCE_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/\.asset\.(update|updateMany|upsert)\(/);
    }
    // Confirmed present exactly where expected: work-order.service.ts
    // drives the transition through AssetService's own lifecycle methods.
    const workOrderServiceSource = readSource('work-order.service.ts');
    expect(workOrderServiceSource).toMatch(/assetService\.startMaintenance\(/);
    expect(workOrderServiceSource).toMatch(/assetService\.resumeService\(/);
  });

  it("structural guard: only the domain's own repository files ever write their own Maintenance*/WorkOrder*/AssetDowntime tables — every service/controller file is read-only or pure composition", () => {
    const writingFiles = new Set([
      'maintenance-type.repository.ts',
      'maintenance-plan.repository.ts',
      'maintenance-schedule.repository.ts',
      'maintenance-request.repository.ts',
      'work-order.repository.ts',
      'asset-downtime.repository.ts',
      'maintenance-part-usage.repository.ts',
      'maintenance-cost.repository.ts',
      'maintenance-document.repository.ts',
    ]);
    const ownWritePattern =
      /\.(maintenanceType|maintenancePlan|maintenancePlanTask|maintenanceSchedule|maintenanceRequest|workOrder|workOrderTask|assetDowntime|maintenancePartUsage|maintenanceCost|maintenanceDocument)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;
    for (const fileName of MAINTENANCE_FILES) {
      if (writingFiles.has(fileName)) continue;
      const source = readSource(fileName);
      expect(source).not.toMatch(ownWritePattern);
    }
  });

  it('structural guard: MaintenanceCost.totalCost is always server-computed inside maintenance-cost.repository.ts — never trusts a client-supplied total', () => {
    const controllerSource = readSource('maintenance-cost.controller.ts');
    // The controller never reads a `totalCost` field off the request body.
    expect(controllerSource).not.toMatch(/body\.totalCost/);
    const repositorySource = readSource('maintenance-cost.repository.ts');
    expect(repositorySource).toMatch(/roundCurrency\(data\.quantity \* data\.unitCost\)/);
  });
});
