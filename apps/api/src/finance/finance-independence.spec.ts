import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 6's central architectural guarantee, verified executably rather than just
 * documented: Finance owns Invoices/Payments/CreditNotes/Accounts Receivable and NEVER
 * writes to `SalesOrder`/`Dispatch`/`Delivery`/`InventoryStock`/`InventoryTransaction`
 * — it only *reads* Sales Order data, read-only, via `SalesModule`'s exported
 * `SalesOrderRepository`. Mirrors `distribution-inventory-independence.spec.ts`'s
 * structural-guard technique — reading each file's own raw source and asserting a
 * forbidden import/usage never appears.
 */
describe('Finance independence from Sales/Inventory/Distribution write paths (Sprint 6)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  const FORBIDDEN_WRITE_PATTERN =
    /tx\.(salesOrder|salesOrderItem|dispatch|dispatchItem|delivery|deliveryItem|inventoryStock|inventoryTransaction)\.(create|update|updateMany|delete|deleteMany|upsert)/;

  it('structural guard: InvoiceRepository never writes to Sales/Dispatch/Delivery/Inventory tables', () => {
    const source = readSource('invoice.repository.ts');
    expect(source).not.toMatch(FORBIDDEN_WRITE_PATTERN);
  });

  it('structural guard: PaymentRepository never writes to Sales/Dispatch/Delivery/Inventory tables', () => {
    const source = readSource('payment.repository.ts');
    expect(source).not.toMatch(FORBIDDEN_WRITE_PATTERN);
  });

  it('structural guard: CreditNoteRepository never writes to Sales/Dispatch/Delivery/Inventory tables', () => {
    const source = readSource('credit-note.repository.ts');
    expect(source).not.toMatch(FORBIDDEN_WRITE_PATTERN);
  });

  it('structural guard: InvoiceService/PaymentService/CreditNoteService never import InventoryStock/InventoryTransaction/Dispatch/Delivery', () => {
    for (const fileName of ['invoice.service.ts', 'payment.service.ts', 'credit-note.service.ts']) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/from ['"].*inventory-stock/);
      expect(source).not.toMatch(/from ['"].*inventory-transaction/);
      expect(source).not.toMatch(/from ['"].*dispatch\.repository/);
      expect(source).not.toMatch(/from ['"].*delivery\.repository/);
    }
  });

  it('structural guard: FinanceModule never imports InventoryModule or DistributionModule', () => {
    const source = readSource('finance.module.ts');
    expect(source).not.toMatch(/from ['"].*inventory\/inventory\.module/);
    expect(source).not.toMatch(/from ['"].*distribution\/distribution\.module/);
  });
});
