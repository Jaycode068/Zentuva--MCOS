import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 15's central architectural guarantee, verified executably rather than
 * just documented (docs/domains/cashflow.md "Architecture"): the forecast layer
 * *reads* Finance/Cash/Accounting data, it never modifies any of it. No file in
 * this module may write `Invoice`/`SupplierInvoice`/`Payment`/`SupplierPayment`/
 * `JournalEntry`/`JournalEntryLine`/`CashTransaction`/`BankStatementTransaction`/
 * `BankReconciliation` directly, none may call `postSystemJournalEntry` at all
 * (the forecast posts nothing, ever — stricter than `cash-independence.spec.ts`,
 * which still permits it for `CashAccount`/`CashTransaction` postings), and none
 * may import a Sales/Inventory/Procurement/Production service, controller, or
 * module. Mirrors `cash-independence.spec.ts`'s exact structural-guard technique.
 */
describe('Cashflow Management independence (Sprint 15)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const CASHFLOW_FILES = [
    'cashflow-forecast.service.ts',
    'cashflow-forecast.controller.ts',
    'cashflow-item.repository.ts',
    'cashflow-item.service.ts',
    'cashflow-item.controller.ts',
    'cashflow-scenario.repository.ts',
    'cashflow-scenario.service.ts',
    'cashflow-scenario.controller.ts',
    'cashflow-adjustment.repository.ts',
    'cashflow-adjustment.service.ts',
    'cashflow-adjustment.controller.ts',
    'cashflow-settings.repository.ts',
    'cashflow-settings.service.ts',
    'cashflow-settings.controller.ts',
  ];

  const FORBIDDEN_WRITE_PATTERN =
    /\.(invoice|supplierInvoice|payment|supplierPayment|journalEntry|journalEntryLine|cashTransaction|bankStatementTransaction|bankStatementImport|bankReconciliation|reconciliationMatch|cashAccount|salesOrder|purchaseOrder|productionOrder|inventoryStock|inventoryTransaction|lender|capitalRequirement|debtFacility|debtDrawdown|debtRepayment|debtRepaymentSchedule|capitalProject|capitalProjectCostLine|capitalProjectFunding)\.(create|update|updateMany|delete|deleteMany|upsert)\(/;

  it('structural guard: no cashflow file writes Invoice/SupplierInvoice/Payment/SupplierPayment/JournalEntry/CashAccount/CashTransaction/BankReconciliation/any Debt table/any Capital Project table, or any Sales/Procurement/Production/Inventory table, directly', () => {
    for (const fileName of CASHFLOW_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(FORBIDDEN_WRITE_PATTERN);
    }
  });

  it('structural guard: no cashflow file ever calls postSystemJournalEntry — the forecast posts nothing, ever', () => {
    for (const fileName of CASHFLOW_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/postSystemJournalEntry\(/);
    }
  });

  it('structural guard: no cashflow file imports a Sales/Inventory/Procurement/Production service, controller, or module', () => {
    for (const fileName of CASHFLOW_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*inventory\//);
      expect(source).not.toMatch(/from ['"].*\bsales\//);
      expect(source).not.toMatch(/from ['"].*procurement\//);
      expect(source).not.toMatch(/from ['"].*production\//);
    }
  });

  it("structural guard: FinanceModule still never imports InventoryModule after Sprint 15's additions", () => {
    const source = readFileSync(join(__dirname, '..', 'finance.module.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"].*inventory\/inventory\.module/);
  });

  it('structural guard: only the four repository/upsert files ever write their own Cashflow* tables — the forecast service and every controller are read-only or pure composition', () => {
    const writingFiles = new Set([
      'cashflow-item.repository.ts',
      'cashflow-scenario.repository.ts',
      'cashflow-adjustment.repository.ts',
      'cashflow-settings.repository.ts',
    ]);
    const cashflowOwnWritePattern =
      /\.(cashflowForecastItem|cashflowScenario|cashflowForecastAdjustment|cashflowSettings)\.(create|update|updateMany|delete|deleteMany|upsert)\(/;
    for (const fileName of CASHFLOW_FILES) {
      if (writingFiles.has(fileName)) continue;
      const source = readSource(fileName);
      expect(source).not.toMatch(cashflowOwnWritePattern);
    }
  });
});
