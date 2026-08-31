import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 17's central architectural guarantee, verified executably rather
 * than just documented (docs/domains/debt-management.md "Structural
 * Independence"): the debt layer reads Finance/Accounting/Cash/Cashflow/
 * Budgeting data and posts through the shared Ledger boundary, but it never
 * directly manipulates Inventory/Production/Sales/Distribution, and
 * `postSystemJournalEntry` is only ever called from the two repositories
 * that actually record a cash event. Mirrors `budgeting-independence.spec.ts`'s
 * exact structural-guard technique.
 */
describe('Capital & Debt Management independence (Sprint 17)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const DEBT_FILES = [
    'repayment-schedule.ts',
    'debt-balance.ts',
    'lender.repository.ts',
    'lender.service.ts',
    'lender.controller.ts',
    'capital-requirement.repository.ts',
    'capital-requirement.service.ts',
    'capital-requirement.controller.ts',
    'debt-facility.repository.ts',
    'debt-facility.service.ts',
    'debt-facility.controller.ts',
    'debt-drawdown.repository.ts',
    'debt-drawdown.service.ts',
    'debt-repayment.repository.ts',
    'debt-repayment.service.ts',
    'debt-analysis.service.ts',
    'debt-dashboard.controller.ts',
  ];

  const FORBIDDEN_WRITE_PATTERN =
    /\.(invoice|supplierInvoice|payment|supplierPayment|journalEntry|journalEntryLine|cashTransaction|bankStatementTransaction|bankStatementImport|bankReconciliation|reconciliationMatch|cashAccount|cashflowForecastItem|cashflowScenario|cashflowForecastAdjustment|cashflowSettings|budget|budgetLine|costCentre|salesOrder|purchaseOrder|productionOrder|inventoryStock|inventoryTransaction)\.(create|update|updateMany|delete|deleteMany|upsert)\(/;

  it('structural guard: no debt file writes Invoice/SupplierInvoice/Payment/JournalEntry/CashAccount/any Cashflow*/any Budget*/CostCentre table, or any Sales/Procurement/Production/Inventory table, directly', () => {
    for (const fileName of DEBT_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(FORBIDDEN_WRITE_PATTERN);
    }
  });

  it('structural guard: postSystemJournalEntry is only ever called from debt-drawdown.repository.ts / debt-repayment.repository.ts', () => {
    const postingFiles = new Set(['debt-drawdown.repository.ts', 'debt-repayment.repository.ts']);
    for (const fileName of DEBT_FILES) {
      const source = readSource(fileName);
      if (postingFiles.has(fileName)) {
        expect(source).toMatch(/postSystemJournalEntry\(/);
      } else {
        expect(source).not.toMatch(/postSystemJournalEntry\(/);
      }
    }
  });

  it('structural guard: no debt file imports a Sales/Inventory/Procurement/Production service, controller, or module', () => {
    for (const fileName of DEBT_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*inventory\//);
      expect(source).not.toMatch(/from ['"].*\bsales\//);
      expect(source).not.toMatch(/from ['"].*procurement\//);
      expect(source).not.toMatch(/from ['"].*production\//);
    }
  });

  it("structural guard: FinanceModule still never imports InventoryModule after Sprint 17's additions", () => {
    const source = readFileSync(join(__dirname, '..', 'finance.module.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"].*inventory\/inventory\.module/);
  });

  it('structural guard: only the five repository files ever write their own Lender/CapitalRequirement/DebtFacility/DebtDrawdown/DebtRepayment(Schedule) tables — every service/controller/analysis file is read-only or pure composition', () => {
    const writingFiles = new Set([
      'lender.repository.ts',
      'capital-requirement.repository.ts',
      'debt-facility.repository.ts',
      'debt-drawdown.repository.ts',
      'debt-repayment.repository.ts',
    ]);
    const ownWritePattern =
      /\.(lender|capitalRequirement|debtFacility|debtDrawdown|debtRepayment|debtRepaymentSchedule)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;
    for (const fileName of DEBT_FILES) {
      if (writingFiles.has(fileName)) continue;
      const source = readSource(fileName);
      expect(source).not.toMatch(ownWritePattern);
    }
  });
});
