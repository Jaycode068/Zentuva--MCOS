import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 10's central architectural guarantee, verified executably rather than just
 * documented (brief §28): Sales posts accounting entries only through the approved
 * boundary (`postSystemJournalEntry`, a plain, non-DI function import) — never by
 * importing Finance's own repositories/services, never by writing to
 * `JournalEntry`/`JournalEntryLine` directly. Mirrors
 * `production-finance-independence.spec.ts`'s exact structural-guard technique —
 * reading each file's own raw source and asserting a forbidden import/usage never
 * appears.
 */
describe('Sales independence from Finance internals (Sprint 10)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  it('structural guard: SalesFulfilmentRepository never writes JournalEntry/JournalEntryLine directly', () => {
    const source = readSource('sales-fulfilment.repository.ts');
    expect(source).not.toMatch(/tx\.journalEntry\.(create|update|delete|upsert)/);
    expect(source).not.toMatch(/tx\.journalEntryLine\.(create|update|delete|upsert)/);
    // The only accounting-mutating call allowed is the shared posting boundary.
    expect(source).toMatch(/postSystemJournalEntry\(tx,/);
  });

  it('structural guard: Sales never imports a Finance repository/service/controller — only the plain journal-posting/chart-of-account-keys functions', () => {
    for (const fileName of [
      'sales-fulfilment.repository.ts',
      'sales-fulfilment.service.ts',
      'sales-order.service.ts',
      'sales-order.controller.ts',
      'sales.module.ts',
    ]) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*finance\/.*\.(repository|service|controller)/);
      expect(source).not.toMatch(/import.*FinanceModule/);
    }
  });

  it('structural guard: SalesModule never imports FinanceModule', () => {
    const source = readSource('sales.module.ts');
    expect(source).not.toMatch(/from ['"].*finance\/finance\.module/);
  });
});
