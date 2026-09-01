import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 19's central architectural guarantee, verified executably rather
 * than just documented (docs/domains/financial-decision-analysis.md
 * "Structural Independence"): the Decision Analysis layer reads Financial
 * Statements/AR/AP/Cashflow Forecast/Budget/Debt/Capital Project data
 * read-only and composes it into ROI/NPV/IRR/payback/sensitivity/funding
 * comparison, but it **never posts a Journal Entry and never mutates any
 * real Cash/Debt/Budget/Capital Project record — scenario analysis is
 * 100% side-effect-free.** Mirrors `debt-independence.spec.ts`'s exact
 * structural-guard technique.
 */
describe('Financial Decision & Scenario Analysis independence (Sprint 19)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const DECISION_FILES = [
    'decision-calculations.ts',
    'decision-analysis.repository.ts',
    'decision-analysis.service.ts',
    'decision-analysis.controller.ts',
    'decision-scenario.repository.ts',
    'decision-scenario.service.ts',
  ];

  const FORBIDDEN_WRITE_PATTERN =
    /\.(invoice|supplierInvoice|payment|supplierPayment|journalEntry|journalEntryLine|cashTransaction|bankStatementTransaction|bankStatementImport|bankReconciliation|reconciliationMatch|cashAccount|cashflowForecastItem|cashflowScenario|cashflowForecastAdjustment|cashflowSettings|budget|budgetLine|costCentre|lender|capitalRequirement|debtFacility|debtDrawdown|debtRepayment|debtRepaymentSchedule|capitalProject|capitalProjectCostLine|capitalProjectFunding|salesOrder|purchaseOrder|productionOrder|inventoryStock|inventoryTransaction)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;

  it('structural guard: no decision file writes any real Cash/Debt/Budget/Capital-Project/Cashflow/Sales/Procurement/Production/Inventory table, directly', () => {
    for (const fileName of DECISION_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(FORBIDDEN_WRITE_PATTERN);
    }
  });

  it('structural guard: postSystemJournalEntry is never called anywhere in decision/ — this module posts nothing, ever', () => {
    for (const fileName of DECISION_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/postSystemJournalEntry\(/);
    }
  });

  it('structural guard: no decision file imports a Sales/Inventory/Procurement/Production service, controller, or module', () => {
    for (const fileName of DECISION_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*inventory\//);
      expect(source).not.toMatch(/from ['"].*\bsales\//);
      expect(source).not.toMatch(/from ['"].*procurement\//);
      expect(source).not.toMatch(/from ['"].*production\//);
    }
  });

  it("structural guard: FinanceModule still never imports InventoryModule after Sprint 19's additions", () => {
    const source = readFileSync(join(__dirname, '..', 'finance.module.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"].*inventory\/inventory\.module/);
  });

  it('structural guard: only decision-analysis.repository.ts / decision-scenario.repository.ts ever write DecisionAnalysis/DecisionScenario — every service/controller/calculation file is read-only or pure composition', () => {
    const writingFiles = new Set([
      'decision-analysis.repository.ts',
      'decision-scenario.repository.ts',
    ]);
    const ownWritePattern =
      /\.(decisionAnalysis|decisionScenario)\.(create|update|updateMany|delete|deleteMany|upsert|createMany)\(/;
    for (const fileName of DECISION_FILES) {
      if (writingFiles.has(fileName)) continue;
      const source = readSource(fileName);
      expect(source).not.toMatch(ownWritePattern);
    }
  });

  it('structural guard: decision-calculations.ts is pure — no Prisma/PrismaService import, no NestJS Injectable', () => {
    const source = readSource('decision-calculations.ts');
    expect(source).not.toMatch(/PrismaService/);
    expect(source).not.toMatch(/@Injectable/);
  });
});
