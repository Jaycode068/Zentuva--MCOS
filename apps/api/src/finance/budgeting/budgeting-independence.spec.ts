import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 16's central architectural guarantee, verified executably rather than
 * just documented (docs/domains/budgeting.md "Accounting Integration"): the
 * budgeting layer *reads* Finance/Accounting/Cash/Cashflow data (actuals via
 * the Ledger, forecasts via `CashflowForecastService`), it never modifies any
 * of it. No file in this module may write `Invoice`/`SupplierInvoice`/
 * `Payment`/`SupplierPayment`/`JournalEntry`/`JournalEntryLine`/
 * `CashTransaction`/`CashAccount`/`BankStatementTransaction`/
 * `BankReconciliation`/any `Cashflow*` table directly, none may call
 * `postSystemJournalEntry` at all (a budget write is a planning record, never
 * an accounting event), and none may import a Sales/Inventory/Procurement/
 * Production service, controller, or module. Mirrors
 * `cashflow-independence.spec.ts`'s exact structural-guard technique.
 */
describe('Budgeting & Financial Planning independence (Sprint 16)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const BUDGETING_FILES = [
    'fiscal-year.ts',
    'budget.repository.ts',
    'budget.service.ts',
    'budget.controller.ts',
    'budget-line.repository.ts',
    'budget-line.service.ts',
    'budget-actuals.service.ts',
    'budget-forecast.service.ts',
    'cost-centre.repository.ts',
    'cost-centre.service.ts',
    'cost-centre.controller.ts',
  ];

  const FORBIDDEN_WRITE_PATTERN =
    /\.(invoice|supplierInvoice|payment|supplierPayment|journalEntry|journalEntryLine|cashTransaction|bankStatementTransaction|bankStatementImport|bankReconciliation|reconciliationMatch|cashAccount|salesOrder|purchaseOrder|productionOrder|inventoryStock|inventoryTransaction|cashflowForecastItem|cashflowScenario|cashflowForecastAdjustment|cashflowSettings)\.(create|update|updateMany|delete|deleteMany|upsert)\(/;

  it('structural guard: no budgeting file writes Invoice/SupplierInvoice/Payment/JournalEntry/CashAccount/CashTransaction/BankReconciliation/any Cashflow* table, or any Sales/Procurement/Production/Inventory table, directly', () => {
    for (const fileName of BUDGETING_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(FORBIDDEN_WRITE_PATTERN);
    }
  });

  it('structural guard: no budgeting file ever calls postSystemJournalEntry — a budget write is a planning record, never an accounting event', () => {
    for (const fileName of BUDGETING_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/postSystemJournalEntry\(/);
    }
  });

  it('structural guard: no budgeting file imports a Sales/Inventory/Procurement/Production service, controller, or module', () => {
    for (const fileName of BUDGETING_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*inventory\//);
      expect(source).not.toMatch(/from ['"].*\bsales\//);
      expect(source).not.toMatch(/from ['"].*procurement\//);
      expect(source).not.toMatch(/from ['"].*production\//);
    }
  });

  it("structural guard: FinanceModule still never imports InventoryModule after Sprint 16's additions", () => {
    const source = readFileSync(join(__dirname, '..', 'finance.module.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"].*inventory\/inventory\.module/);
  });

  it('structural guard: only the three repository files ever write their own Budget/BudgetLine/CostCentre tables — every service/controller is read-only or pure composition', () => {
    const writingFiles = new Set([
      'budget.repository.ts',
      'budget-line.repository.ts',
      'cost-centre.repository.ts',
    ]);
    const ownWritePattern =
      /\.(budget|budgetLine|costCentre)\.(create|update|updateMany|delete|deleteMany|upsert)\(/;
    for (const fileName of BUDGETING_FILES) {
      if (writingFiles.has(fileName)) continue;
      const source = readSource(fileName);
      expect(source).not.toMatch(ownWritePattern);
    }
  });
});
