import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 9's central architectural guarantee, verified executably rather than just
 * documented (brief §16): Production posts accounting entries only through the
 * approved boundary (`postSystemJournalEntry`, a plain, non-DI function import) —
 * never by importing Finance's own repositories/services, never by writing to
 * `JournalEntry`/`JournalEntryLine` directly. Mirrors
 * `distribution-inventory-independence.spec.ts`'s structural-guard technique — reading
 * each file's own raw source and asserting a forbidden import/usage never appears.
 */
describe('Production independence from Finance internals (Sprint 9)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  it('structural guard: ProductionMaterialIssueRepository never writes JournalEntry/JournalEntryLine directly', () => {
    const source = readSource('production-material-issue.repository.ts');
    expect(source).not.toMatch(/tx\.journalEntry\.(create|update|delete|upsert)/);
    expect(source).not.toMatch(/tx\.journalEntryLine\.(create|update|delete|upsert)/);
    // The only accounting-mutating call allowed is the shared posting boundary.
    expect(source).toMatch(/postSystemJournalEntry\(tx,/);
  });

  it('structural guard: ProductionRunRepository never writes JournalEntry/JournalEntryLine directly', () => {
    const source = readSource('production-run.repository.ts');
    expect(source).not.toMatch(/tx\.journalEntry\.(create|update|delete|upsert)/);
    expect(source).not.toMatch(/tx\.journalEntryLine\.(create|update|delete|upsert)/);
    expect(source).toMatch(/postSystemJournalEntry\(tx,/);
  });

  it('structural guard: Production never imports a Finance repository/service/controller — only the plain journal-posting/chart-of-account-keys functions', () => {
    for (const fileName of [
      'production-material-issue.repository.ts',
      'production-run.repository.ts',
      'production-order.service.ts',
      'production-order.controller.ts',
      'production.module.ts',
    ]) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*finance\/.*\.(repository|service|controller)/);
      expect(source).not.toMatch(/import.*FinanceModule/);
    }
  });

  it('structural guard: ProductionModule never imports FinanceModule', () => {
    const source = readSource('production.module.ts');
    expect(source).not.toMatch(/from ['"].*finance\/finance\.module/);
  });
});
