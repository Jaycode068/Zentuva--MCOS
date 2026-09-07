import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 20's central architectural guarantee, verified executably rather
 * than just documented (docs/domains/assets.md "Structural Independence"):
 * registering, updating, transitioning, transferring, or recording a
 * meter reading on an Asset never posts a Journal Entry and never mutates
 * any real Finance/Inventory/Sales/Production/Distribution table.
 * `PurchaseOrderRepository`/`SupplierRepository` (read-only, already
 * exported into `AssetsModule`) are the two deliberate, narrow exceptions
 * other Finance sub-domains already establish this same pattern for; the
 * optional `CapitalProject` reference is validated via a narrow, direct
 * read inside `asset.repository.ts` — never via importing `FinanceModule`.
 * Mirrors `investment-independence.spec.ts`'s exact structural-guard
 * technique.
 */
describe('Asset Register & Asset Management independence (Sprint 20)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const ASSET_FILES = [
    'hierarchy-guard.ts',
    'asset-category.repository.ts',
    'asset-category.service.ts',
    'asset-category.controller.ts',
    'asset-location.repository.ts',
    'asset-location.service.ts',
    'asset-location.controller.ts',
    'asset.repository.ts',
    'asset.service.ts',
    'asset.controller.ts',
    'asset-document.repository.ts',
    'asset-document.service.ts',
    'asset-meter.repository.ts',
    'asset-meter.service.ts',
  ];

  const FORBIDDEN_WRITE_PATTERN =
    /\.(invoice|supplierInvoice|payment|supplierPayment|journalEntry|journalEntryLine|cashTransaction|bankStatementTransaction|bankStatementImport|bankReconciliation|reconciliationMatch|cashAccount|cashflowForecastItem|cashflowScenario|cashflowForecastAdjustment|cashflowSettings|budget|budgetLine|costCentre|lender|capitalRequirement|debtFacility|debtDrawdown|debtRepayment|debtRepaymentSchedule|capitalProject|capitalProjectCostLine|capitalProjectFunding|decisionAnalysis|decisionScenario|purchaseOrder|purchaseOrderItem|goodsReceipt|goodsReceiptItem|supplier|salesOrder|productionOrder|inventoryStock|inventoryTransaction|inventoryLocation)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;

  it('structural guard: no asset file writes any Finance/Procurement/Supplier/Sales/Production/Inventory table, directly', () => {
    for (const fileName of ASSET_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(FORBIDDEN_WRITE_PATTERN);
    }
  });

  it('structural guard: postSystemJournalEntry is never called anywhere in assets/ — registering an asset never posts a Journal Entry', () => {
    for (const fileName of ASSET_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/postSystemJournalEntry\(/);
    }
  });

  it('structural guard: no asset file imports a Finance/Sales/Inventory/Production/Distribution service, controller, or module — Procurement/Suppliers are imported read-only (their repositories) only', () => {
    for (const fileName of ASSET_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*\bfinance\//);
      expect(source).not.toMatch(/from ['"].*\binventory\//);
      expect(source).not.toMatch(/from ['"].*\bsales\//);
      expect(source).not.toMatch(/from ['"].*\bproduction\//);
      expect(source).not.toMatch(/from ['"].*\bdistribution\//);
      expect(source).not.toMatch(/from ['"].*procurement\/.*\.(controller|module)['"]/);
      expect(source).not.toMatch(/from ['"].*suppliers\/.*\.(controller|module)['"]/);
    }
  });

  it('structural guard: AssetsModule never imports FinanceModule or InventoryModule', () => {
    const source = readFileSync(join(__dirname, 'assets.module.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"].*finance\/finance\.module/);
    expect(source).not.toMatch(/from ['"].*inventory\/inventory\.module/);
  });

  it('structural guard: the Capital Project reference is read-only — asset.repository.ts never writes the capitalProject table (only findFirst)', () => {
    const source = readSource('asset.repository.ts');
    expect(source).toMatch(/capitalProject\.findFirst\(/);
    expect(source).not.toMatch(
      /capitalProject\.(create|update|updateMany|delete|deleteMany|upsert)\(/,
    );
  });

  it('structural guard: only the four repository files ever write their own Asset*/AssetCategory/AssetLocation/AssetDocument/AssetMovement/AssetMeter(Reading) tables — every service/controller file is read-only or pure composition', () => {
    const writingFiles = new Set([
      'asset-category.repository.ts',
      'asset-location.repository.ts',
      'asset.repository.ts',
      'asset-document.repository.ts',
      'asset-meter.repository.ts',
    ]);
    const ownWritePattern =
      /\.(assetCategory|assetLocation|asset|assetDocument|assetMovement|assetMeter|assetMeterReading)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;
    for (const fileName of ASSET_FILES) {
      if (writingFiles.has(fileName)) continue;
      const source = readSource(fileName);
      expect(source).not.toMatch(ownWritePattern);
    }
  });
});
