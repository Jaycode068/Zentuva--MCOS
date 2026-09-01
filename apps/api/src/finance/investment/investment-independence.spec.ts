import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 18's central architectural guarantee, verified executably rather
 * than just documented (docs/domains/investment-projects.md "Structural
 * Independence"): a Capital Project is a management/planning layer over
 * Sprints 13-17 and Procurement — it never posts a Journal Entry, never
 * mutates a Budget/DebtFacility/CashAccount/PurchaseOrder/SupplierInvoice it
 * references, and never directly manipulates Inventory/Production/Sales/
 * Distribution. `PurchaseOrderRepository` (read-only, already exported into
 * `FinanceModule` since Sprint 12) is the one deliberate, narrow exception
 * to the "no Procurement import" rule other Finance sub-domains follow.
 */
describe('Investment / Capital Project Management independence (Sprint 18)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const INVESTMENT_FILES = [
    'capital-project.repository.ts',
    'capital-project.service.ts',
    'capital-project.controller.ts',
    'capital-project-cost-line.repository.ts',
    'capital-project-funding.repository.ts',
  ];

  const FORBIDDEN_WRITE_PATTERN =
    /\.(invoice|supplierInvoice|payment|supplierPayment|journalEntry|journalEntryLine|cashTransaction|bankStatementTransaction|bankStatementImport|bankReconciliation|reconciliationMatch|cashAccount|cashflowForecastItem|cashflowScenario|cashflowForecastAdjustment|cashflowSettings|budget|budgetLine|costCentre|lender|capitalRequirement|debtFacility|debtDrawdown|debtRepayment|debtRepaymentSchedule|purchaseOrder|purchaseOrderItem|goodsReceipt|goodsReceiptItem|salesOrder|productionOrder|inventoryStock|inventoryTransaction)\.(create|update|updateMany|delete|deleteMany|upsert)\(/;

  it('structural guard: no investment file writes any Finance/Cash/Cashflow/Budget/Debt/Procurement table it only reads, or any Sales/Production/Inventory table, directly', () => {
    for (const fileName of INVESTMENT_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(FORBIDDEN_WRITE_PATTERN);
    }
  });

  it('structural guard: postSystemJournalEntry is never called anywhere in this module — planning a capital project never posts a Journal Entry', () => {
    for (const fileName of INVESTMENT_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/postSystemJournalEntry\(/);
    }
  });

  it('structural guard: no investment file imports a Sales/Inventory/Production/Distribution service, controller, or module — Procurement is imported read-only (PurchaseOrderRepository) only', () => {
    for (const fileName of INVESTMENT_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*\binventory\//);
      expect(source).not.toMatch(/from ['"].*\bsales\//);
      expect(source).not.toMatch(/from ['"].*\bproduction\//);
      expect(source).not.toMatch(/from ['"].*\bdistribution\//);
      expect(source).not.toMatch(/from ['"].*procurement\/.*\.(controller|module)['"]/);
    }
  });

  it("structural guard: FinanceModule still never imports InventoryModule after Sprint 18's additions", () => {
    const source = readFileSync(join(__dirname, '..', 'finance.module.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"].*inventory\/inventory\.module/);
  });

  it('structural guard: only the three repository files ever write their own CapitalProject/CapitalProjectCostLine/CapitalProjectFunding tables — the service/controller are read-only or pure composition', () => {
    const writingFiles = new Set([
      'capital-project.repository.ts',
      'capital-project-cost-line.repository.ts',
      'capital-project-funding.repository.ts',
    ]);
    const ownWritePattern =
      /\.(capitalProject|capitalProjectCostLine|capitalProjectFunding)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;
    for (const fileName of INVESTMENT_FILES) {
      if (writingFiles.has(fileName)) continue;
      const source = readSource(fileName);
      expect(source).not.toMatch(ownWritePattern);
    }
  });
});
