import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 12's central architectural guarantee, verified executably rather than just
 * documented (plan Architecture Decision #1): the Accounts Payable files post
 * accounting entries only through the approved boundary (`postSystemJournalEntry`) —
 * never by writing to `JournalEntry`/`JournalEntryLine` directly — and reach into
 * `GoodsReceiptItem`/`ChartOfAccount` only as a narrow, self-owned-transaction
 * exception (the same precedent `SupplierReturnRepository`/`CustomerReturnRepository`,
 * Sprint 11, already established), never by importing an Inventory/Procurement/
 * Supplier *service or controller* — only the two exported repositories, read-only.
 * Mirrors `sales-finance-independence.spec.ts`'s exact structural-guard technique.
 */
describe('Accounts Payable independence from Inventory/Procurement/Supplier internals (Sprint 12)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const REPOSITORY_FILES = [
    'supplier-invoice.repository.ts',
    'supplier-payment.repository.ts',
    'supplier-credit-note.repository.ts',
  ];

  const ALL_AP_FILES = [
    ...REPOSITORY_FILES,
    'supplier-invoice-matching.ts',
    'supplier-invoice.service.ts',
    'supplier-invoice.controller.ts',
    'supplier-payment.service.ts',
    'supplier-payment.controller.ts',
    'supplier-credit-note.service.ts',
    'supplier-credit-note.controller.ts',
    'accounts-payable.service.ts',
    'accounts-payable.controller.ts',
  ];

  it('structural guard: no AP repository writes JournalEntry/JournalEntryLine directly — only the shared posting boundary', () => {
    for (const fileName of REPOSITORY_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/tx\.journalEntry\.(create|update|delete|upsert)/);
      expect(source).not.toMatch(/tx\.journalEntryLine\.(create|update|delete|upsert)/);
    }
    // SupplierInvoiceRepository/SupplierPaymentRepository/SupplierCreditNoteRepository
    // each post at least once through the approved boundary.
    for (const fileName of REPOSITORY_FILES) {
      const source = readSource(fileName);
      expect(source).toMatch(/postSystemJournalEntry\(tx,/);
    }
  });

  it('structural guard: no AP file imports an Inventory/Procurement/Supplier service or controller — only their exported repositories, read-only', () => {
    for (const fileName of ALL_AP_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*inventory\/.*\.(service|controller)/);
      expect(source).not.toMatch(/from ['"].*procurement\/.*\.(service|controller)/);
      expect(source).not.toMatch(/from ['"].*suppliers\/.*\.(service|controller)/);
    }
  });

  it('structural guard: no AP file imports InventoryModule at all — GoodsReceiptItem is reached directly inside SupplierInvoiceRepository’s own transaction', () => {
    for (const fileName of ALL_AP_FILES) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*inventory\/inventory\.module/);
    }
  });

  it('structural guard: FinanceModule never imports InventoryModule (Sprint 12 additions still hold this)', () => {
    const source = readSource('finance.module.ts');
    expect(source).not.toMatch(/from ['"].*inventory\/inventory\.module/);
    expect(source).toMatch(/from ['"].*suppliers\/supplier\/supplier\.module/);
    expect(source).toMatch(/from ['"].*procurement\/purchase-order\/purchase-order\.module/);
  });

  it('structural guard: SupplierInvoiceRepository reaches GoodsReceiptItem only inside its own $transaction, never findMany/findFirst outside a tx callback', () => {
    const source = readSource('supplier-invoice.repository.ts');
    // Every `goodsReceiptItem.` access must be qualified through the `tx` parameter,
    // never `this.prisma.goodsReceiptItem` — no such access is legitimate outside the
    // repository's own atomic transaction.
    expect(source).not.toMatch(/this\.prisma\.goodsReceiptItem/);
    expect(source).toMatch(/tx\.goodsReceiptItem\.findMany/);
    expect(source).toMatch(/tx\.goodsReceiptItem\.update/);
  });
});
