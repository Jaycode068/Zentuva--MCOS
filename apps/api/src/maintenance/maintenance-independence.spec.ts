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
 *
 * **Extended Sprint 22** (docs/domains/maintenance-integration.md
 * "Structural Guard", decision #17): Maintenance now legitimately writes
 * `inventoryStock`/`inventoryTransaction` from exactly one file
 * (`maintenance-part-usage.repository.ts`) and legitimately reads (never
 * writes) `purchaseOrder`/`supplier`/`budget`/`budgetLine`/`costCentre`/
 * `capitalProject`/`supplierInvoice`. Every one of those tables must still
 * never be *written* from any maintenance file, `MaintenanceModule` must
 * still never import `FinanceModule`/`ProductionModule`, and no maintenance
 * file may ever create a `PurchaseOrder`.
 */
describe('Maintenance Management independence (Sprint 21-22)', () => {
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
    // Sprint 22 additions
    'maintenance-procurement.repository.ts',
    'maintenance-procurement.service.ts',
    'maintenance-procurement.controller.ts',
    'maintenance-analytics.service.ts',
    'maintenance-analytics.controller.ts',
    'maintenance-events.ts',
  ];

  /** Every file EXCEPT `maintenance-part-usage.repository.ts` (decision
   *  #2/#17(b) — the one deliberate, narrow exception, mirroring Sales/
   *  Production's own stock-issuing writers) must never write any of
   *  these tables. */
  const FORBIDDEN_WRITE_PATTERN =
    /\.(invoice|supplierInvoice|payment|supplierPayment|journalEntry|journalEntryLine|cashTransaction|bankStatementTransaction|bankReconciliation|cashAccount|cashflowForecastItem|cashflowScenario|budget|budgetLine|costCentre|debtFacility|debtDrawdown|debtRepayment|capitalProject|capitalProjectCostLine|capitalProjectFunding|decisionAnalysis|decisionScenario|purchaseOrder|purchaseOrderItem|goodsReceipt|goodsReceiptItem|supplier|salesOrder|salesFulfilment|productionOrder|dispatch|delivery|inventoryStock|inventoryTransaction|inventoryLocation|product)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;

  /** Same list, minus `inventoryStock`/`inventoryTransaction` — applied
   *  only to `maintenance-part-usage.repository.ts`, which is allowed to
   *  write exactly those two tables and nothing else forbidden. */
  const FORBIDDEN_WRITE_PATTERN_EXCEPT_INVENTORY =
    /\.(invoice|supplierInvoice|payment|supplierPayment|journalEntry|journalEntryLine|cashTransaction|bankStatementTransaction|bankReconciliation|cashAccount|cashflowForecastItem|cashflowScenario|budget|budgetLine|costCentre|debtFacility|debtDrawdown|debtRepayment|capitalProject|capitalProjectCostLine|capitalProjectFunding|decisionAnalysis|decisionScenario|purchaseOrder|purchaseOrderItem|goodsReceipt|goodsReceiptItem|supplier|salesOrder|salesFulfilment|productionOrder|dispatch|delivery|inventoryLocation|product)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;

  const INVENTORY_WRITE_EXCEPTION_FILE = 'maintenance-part-usage.repository.ts';

  it('structural guard: no maintenance file writes any Finance/Procurement/Supplier/Sales/Production/Inventory/Product table, directly', () => {
    for (const fileName of MAINTENANCE_FILES) {
      const source = readSource(fileName);
      if (fileName === INVENTORY_WRITE_EXCEPTION_FILE) {
        expect(source).not.toMatch(FORBIDDEN_WRITE_PATTERN_EXCEPT_INVENTORY);
        continue;
      }
      expect(source).not.toMatch(FORBIDDEN_WRITE_PATTERN);
    }
  });

  it('structural guard: MaintenanceProcurementRepository never creates/updates/deletes a PurchaseOrder or Supplier — only ever reads them', () => {
    const source = readSource('maintenance-procurement.repository.ts');
    expect(source).not.toMatch(
      /\.purchaseOrder\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/,
    );
    expect(source).not.toMatch(
      /\.supplier\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/,
    );
  });

  it('structural guard: postSystemJournalEntry is never called anywhere in maintenance/ — no maintenance operation ever posts a Journal Entry', () => {
    for (const fileName of MAINTENANCE_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/postSystemJournalEntry\(/);
    }
  });

  it('structural guard: InventoryStock/InventoryTransaction are written from exactly one file — maintenance-part-usage.repository.ts issue(), and nowhere else', () => {
    const exceptionSource = readSource(INVENTORY_WRITE_EXCEPTION_FILE);
    // Sprint 22: issue() legitimately deducts stock and creates the
    // InventoryTransaction row (decision #2), inside its own transaction —
    // the exact narrow ADR-002 exception Sales/Production's own
    // stock-issuing writers already establish.
    expect(exceptionSource).toMatch(/tx\.inventoryStock\.upsert\(/);
    expect(exceptionSource).toMatch(/tx\.inventoryTransaction\.create\(/);

    for (const fileName of MAINTENANCE_FILES) {
      if (fileName === INVENTORY_WRITE_EXCEPTION_FILE) continue;
      const source = readSource(fileName);
      expect(source).not.toMatch(
        /\.(inventoryStock|inventoryTransaction)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/,
      );
    }
  });

  it('structural guard: no maintenance file imports a Finance/Sales/Production/Distribution service, controller, or module, or an Inventory/Procurement/Supplier/Product service/controller/module — Inventory/PurchaseOrder/Supplier/Product/Asset repositories are the only read-only exceptions', () => {
    for (const fileName of MAINTENANCE_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*\bfinance\//);
      expect(source).not.toMatch(/from ['"].*\bsales\//);
      expect(source).not.toMatch(/from ['"].*\bproduction\//);
      expect(source).not.toMatch(/from ['"].*\bdistribution\//);
      // Sprint 22: Inventory/PurchaseOrder repositories are now legitimate,
      // read-only imports (decision #1) — only their service/controller/
      // module forms stay forbidden.
      expect(source).not.toMatch(/from ['"].*\binventory\/.*\.(service|controller|module)['"]/);
      expect(source).not.toMatch(/from ['"].*procurement\/.*\.(service|controller|module)['"]/);
      expect(source).not.toMatch(/from ['"].*suppliers\/.*\.(controller|module)['"]/);
      expect(source).not.toMatch(/from ['"].*catalogue\/.*\.(controller|module)['"]/);
    }
  });

  it('structural guard: MaintenanceModule imports only IdentityModule/AuthModule/FileStorageModule/AssetsModule/ProductModule/SupplierModule/InventoryModule/PurchaseOrderModule — never FinanceModule/ProductionModule/a hypothetical ProcurementModule', () => {
    const source = readFileSync(join(__dirname, 'maintenance.module.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"].*finance\/finance\.module/);
    expect(source).not.toMatch(/from ['"].*production\/production\.module/);
    expect(source).not.toMatch(/from ['"].*procurement\/procurement\.module/);
    expect(source).toMatch(/from ['"].*inventory\/inventory\.module['"]/);
    expect(source).toMatch(/from ['"].*procurement\/purchase-order\/purchase-order\.module['"]/);
    const importsMatch = source.match(/imports:\s*\[([^\]]*)\]/);
    expect(importsMatch).not.toBeNull();
    const importedModules = (importsMatch![1] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(new Set(importedModules)).toEqual(
      new Set([
        'IdentityModule',
        'AuthModule',
        'FileStorageModule',
        'AssetsModule',
        'ProductModule',
        'SupplierModule',
        'InventoryModule',
        'PurchaseOrderModule',
      ]),
    );
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
      'maintenance-procurement.repository.ts',
    ]);
    const ownWritePattern =
      /\.(maintenanceType|maintenancePlan|maintenancePlanTask|maintenanceSchedule|maintenanceRequest|workOrder|workOrderTask|assetDowntime|maintenancePartUsage|maintenanceCost|maintenanceDocument|maintenanceProcurementRequirement)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;
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
