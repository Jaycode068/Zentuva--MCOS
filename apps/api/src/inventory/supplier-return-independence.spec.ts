import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 11's architectural guarantee for `SupplierReturn` — mirrors
 * `sales-finance-independence.spec.ts`'s exact structural-guard technique. The only
 * accounting-mutating call `supplier-return.repository.ts`/`goods-receipt.repository.ts`
 * (the Replacement extension) are allowed to make is the shared `postSystemJournalEntry`
 * boundary — never a direct `JournalEntry`/`JournalEntryLine` write, never a Finance
 * repository/service class, never `FinanceModule`.
 */
describe('SupplierReturn / Replacement independence from Finance internals (Sprint 11)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  it('structural guard: SupplierReturnRepository never writes JournalEntry/JournalEntryLine directly', () => {
    const source = readSource('supplier-return.repository.ts');
    expect(source).not.toMatch(/tx\.journalEntry\.(create|update|delete|upsert)/);
    expect(source).not.toMatch(/tx\.journalEntryLine\.(create|update|delete|upsert)/);
    expect(source).toMatch(/postSystemJournalEntry\(tx,/);
  });

  it('structural guard: SupplierReturn/GoodsReceipt code never imports a Finance repository/service/controller class or FinanceModule', () => {
    for (const fileName of [
      'supplier-return.repository.ts',
      'supplier-return.service.ts',
      'goods-receipt.repository.ts',
      'inventory.service.ts',
      'inventory.controller.ts',
      'inventory.module.ts',
    ]) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*finance\/.*\.(repository|service|controller)/);
      expect(source).not.toMatch(/import.*FinanceModule/);
    }
  });

  it('structural guard: InventoryModule never imports FinanceModule', () => {
    const source = readSource('inventory.module.ts');
    expect(source).not.toMatch(/from ['"].*finance\/finance\.module/);
  });
});
