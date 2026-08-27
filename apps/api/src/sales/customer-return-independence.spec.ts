import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 11's architectural guarantee for `CustomerReturn`, verified executably rather
 * than just documented — mirrors `sales-finance-independence.spec.ts`'s exact
 * structural-guard technique (Sprint 10). The one deliberate, narrow, documented
 * exception this sprint introduces: `customer-return.repository.ts` imports the plain,
 * DI-free `issueCreditNoteWithinTransaction` function from
 * `finance/credit-note.repository.ts` (the same "plain function, not a NestJS
 * provider" contract `postSystemJournalEntry` already established) — never the
 * `CreditNoteRepository`/`CreditNoteService` class, never `FinanceModule`.
 */
describe('CustomerReturn independence from Finance internals (Sprint 11)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  it('structural guard: CustomerReturnRepository never writes JournalEntry/JournalEntryLine directly', () => {
    const source = readSource('customer-return.repository.ts');
    expect(source).not.toMatch(/tx\.journalEntry\.(create|update|delete|upsert)/);
    expect(source).not.toMatch(/tx\.journalEntryLine\.(create|update|delete|upsert)/);
    // The only accounting-mutating calls allowed are the two shared posting boundaries.
    expect(source).toMatch(/postSystemJournalEntry\(tx,/);
    expect(source).toMatch(/issueCreditNoteWithinTransaction\(/);
  });

  it('structural guard: CustomerReturn code never imports the CreditNoteRepository/CreditNoteService class or FinanceModule', () => {
    for (const fileName of [
      'customer-return.repository.ts',
      'customer-return.service.ts',
      'customer-return.controller.ts',
      'sales.module.ts',
    ]) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/import\s*{[^}]*\bCreditNoteRepository\b/);
      expect(source).not.toMatch(/import\s*{[^}]*\bCreditNoteService\b/);
      expect(source).not.toMatch(/import.*FinanceModule/);
      expect(source).not.toMatch(/from ['"].*finance\/finance\.module/);
    }
  });

  it('structural guard: the only import CustomerReturnRepository takes from credit-note.repository is the plain issueCreditNoteWithinTransaction function', () => {
    const source = readSource('customer-return.repository.ts');
    const importLine = source
      .split('\n')
      .find((line) => line.includes("from '../finance/credit-note.repository'"));
    expect(importLine).toMatch(/import\s*{\s*issueCreditNoteWithinTransaction\s*}/);
  });

  it('structural guard: SalesModule never imports FinanceModule', () => {
    const source = readSource('sales.module.ts');
    expect(source).not.toMatch(/from ['"].*finance\/finance\.module/);
  });
});
