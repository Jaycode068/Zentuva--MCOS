import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 14's central architectural guarantee, verified executably rather than just
 * documented (docs/domains/cash-management.md "Architecture"): Cash & Bank
 * Management integrates with the existing accounting architecture, it never bypasses
 * it or creates a second one. No file in this module may write `JournalEntry`/
 * `JournalEntryLine` directly (every accounting-affecting write goes through the
 * shared `postSystemJournalEntry`), and none may write to a Sales/Inventory/
 * Procurement/Production table or import one of those domains' service/controller
 * classes. Mirrors `reports-independence.spec.ts`'s exact structural-guard
 * technique.
 */
describe('Cash & Bank Management independence (Sprint 14)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const CASH_FILES = [
    'cash-account.repository.ts',
    'cash-account.service.ts',
    'cash-account.controller.ts',
    'cash-transaction.repository.ts',
    'cash-transaction.service.ts',
    'cash-transaction.controller.ts',
    'bank-statement.repository.ts',
    'bank-statement.service.ts',
    'bank-statement.controller.ts',
    'bank-reconciliation.repository.ts',
    'bank-reconciliation.service.ts',
    'bank-reconciliation.controller.ts',
    'cash-dashboard.service.ts',
    'cash-dashboard.controller.ts',
  ];

  const FORBIDDEN_DOMAIN_WRITE_PATTERN =
    /\.(salesOrder|salesOrderItem|purchaseOrder|purchaseOrderItem|productionOrder|productionRun|inventoryStock|inventoryTransaction|goodsReceipt|goodsReceiptItem)\.(create|update|updateMany|delete|deleteMany|upsert)\(/;

  const DIRECT_JOURNAL_WRITE_PATTERN =
    /\.(journalEntry|journalEntryLine)\.(create|update|updateMany|delete|deleteMany|upsert)\(/;

  it('structural guard: no cash file writes a Sales/Procurement/Production/Inventory table directly', () => {
    for (const fileName of CASH_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(FORBIDDEN_DOMAIN_WRITE_PATTERN);
    }
  });

  it('structural guard: no cash file writes JournalEntry/JournalEntryLine directly — every accounting-affecting write goes through postSystemJournalEntry', () => {
    for (const fileName of CASH_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(DIRECT_JOURNAL_WRITE_PATTERN);
    }
  });

  it('structural guard: no cash file imports a Sales/Inventory/Procurement/Production service, controller, or module', () => {
    for (const fileName of CASH_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*inventory\//);
      expect(source).not.toMatch(/from ['"].*\bsales\//);
      expect(source).not.toMatch(/from ['"].*procurement\//);
      expect(source).not.toMatch(/from ['"].*production\//);
    }
  });

  it('structural guard: only cash-account.repository.ts and cash-transaction.repository.ts ever call postSystemJournalEntry — every other file is read-only or a pure composition/review layer', () => {
    const postingFiles = new Set(['cash-account.repository.ts', 'cash-transaction.repository.ts']);
    for (const fileName of CASH_FILES) {
      const source = readSource(fileName);
      if (postingFiles.has(fileName)) {
        expect(source).toMatch(/postSystemJournalEntry\(/);
      } else {
        expect(source).not.toMatch(/postSystemJournalEntry\(/);
      }
    }
  });

  it('structural guard: BankReconciliation posts nothing — it only reads/reviews already-posted JournalEntryLine rows and already-imported BankStatementTransaction rows', () => {
    const source = readSource('bank-reconciliation.repository.ts');
    expect(source).not.toMatch(/postSystemJournalEntry\(/);
    expect(source).not.toMatch(DIRECT_JOURNAL_WRITE_PATTERN);
  });

  it("structural guard: FinanceModule still never imports InventoryModule after Sprint 14's additions", () => {
    const source = readFileSync(join(__dirname, '..', 'finance.module.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"].*inventory\/inventory\.module/);
  });
});
