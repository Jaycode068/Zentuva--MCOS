import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 13's central architectural guarantee, verified executably rather than just
 * documented (brief §37): the reporting layer *consumes* data, it never creates a
 * business transaction. None of these files may write `JournalEntry`/
 * `JournalEntryLine`/`InventoryStock`/`InventoryTransaction`, and none may import an
 * Inventory/Sales/Procurement/Production *service or controller* class — only the
 * two narrow, read-only exceptions this sprint's plan documents: a direct,
 * transaction-free `inventoryStock.findMany` read (mirroring Sprint 11/12's own
 * "reach into another domain's table" precedent, applied here to a plain read) and
 * `SalesFulfilmentRepository`'s exported, read-only `getCogsBreakdownByProduct`
 * (consumed via `SalesModule`, already imported by `FinanceModule` since Sprint 10).
 * Mirrors `accounts-payable-independence.spec.ts`'s exact structural-guard technique.
 */
describe('Reporting layer independence (Sprint 13)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const REPORT_FILES = [
    'financial-statement.service.ts',
    'inventory-valuation.service.ts',
    'reconciliation.service.ts',
    'revenue-cogs.service.ts',
    'dashboard.service.ts',
  ];

  const FORBIDDEN_WRITE_PATTERN =
    /\.(journalEntry|journalEntryLine|inventoryStock|inventoryTransaction|invoice|supplierInvoice|payment|supplierPayment|salesOrder|purchaseOrder|productionOrder)\.(create|update|updateMany|delete|deleteMany|upsert)\(/;

  it('structural guard: no reporting file writes JournalEntry/JournalEntryLine/InventoryStock/InventoryTransaction, or any Finance/Sales/Procurement transactional row, directly', () => {
    for (const fileName of REPORT_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(FORBIDDEN_WRITE_PATTERN);
    }
  });

  it('structural guard: no reporting file ever calls postSystemJournalEntry — reporting posts nothing', () => {
    for (const fileName of REPORT_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/postSystemJournalEntry\(/);
    }
  });

  it('structural guard: no reporting file imports an Inventory/Sales/Procurement/Production service or controller — only read-only repository exports', () => {
    for (const fileName of REPORT_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*inventory\/.*\.(service|controller)/);
      expect(source).not.toMatch(/from ['"].*sales\/.*\.(service|controller)/);
      expect(source).not.toMatch(/from ['"].*procurement\/.*\.(service|controller)/);
      expect(source).not.toMatch(/from ['"].*production\/.*\.(service|controller)/);
    }
  });

  it('structural guard: no reporting file imports InventoryModule — InventoryStock is read via a direct, transaction-free Prisma query, not a module dependency', () => {
    for (const fileName of REPORT_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*inventory\/inventory\.module/);
    }
  });

  it("structural guard: FinanceModule still never imports InventoryModule after Sprint 13's additions", () => {
    const source = readFileSync(join(__dirname, '..', 'finance.module.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"].*inventory\/inventory\.module/);
  });

  it('structural guard: InventoryValuationService reads InventoryStock only via a plain findMany, never inside a $transaction', () => {
    const source = readSource('inventory-valuation.service.ts');
    expect(source).toMatch(/this\.prisma\.inventoryStock\.findMany/);
    expect(source).not.toMatch(/\$transaction/);
  });
});
