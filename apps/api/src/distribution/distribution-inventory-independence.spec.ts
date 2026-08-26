import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Sprint 5's central architectural guarantee, verified executably rather than just
 * documented: `Dispatch`/`Delivery` never re-deduct inventory (Sales Fulfilment already
 * did, once), and the distribution network/territory context never gates dispatch or
 * delivery. Mirrors `direct-sales-independence.spec.ts`'s structural-guard technique —
 * reading each file's own raw source and asserting a forbidden import/usage never
 * appears.
 */
describe('Distribution independence from Inventory and the Distribution Network (Sprint 5)', () => {
  function readSource(fileName: string): string {
    return readFileSync(join(__dirname, fileName), 'utf-8');
  }

  it('structural guard: DispatchService never imports InventoryStock/InventoryTransaction', () => {
    const source = readSource('dispatch.service.ts');
    expect(source).not.toMatch(/from ['"].*inventory-stock/);
    expect(source).not.toMatch(/from ['"].*inventory-transaction/);
  });

  it('structural guard: DeliveryService never imports InventoryStock/InventoryTransaction', () => {
    const source = readSource('delivery.service.ts');
    expect(source).not.toMatch(/from ['"].*inventory-stock/);
    expect(source).not.toMatch(/from ['"].*inventory-transaction/);
  });

  it('structural guard: DispatchRepository never touches InventoryStock/InventoryTransaction', () => {
    const source = readSource('dispatch.repository.ts');
    expect(source).not.toMatch(/from ['"].*inventory-stock/);
    expect(source).not.toMatch(/from ['"].*inventory-transaction/);
    expect(source).not.toMatch(/tx\.inventoryStock/);
    expect(source).not.toMatch(/tx\.inventoryTransaction/);
  });

  it('structural guard: DeliveryRepository never touches InventoryStock/InventoryTransaction', () => {
    const source = readSource('delivery.repository.ts');
    expect(source).not.toMatch(/from ['"].*inventory-stock/);
    expect(source).not.toMatch(/from ['"].*inventory-transaction/);
    expect(source).not.toMatch(/tx\.inventoryStock/);
    expect(source).not.toMatch(/tx\.inventoryTransaction/);
  });

  it('structural guard: DistributionModule never imports NetworkRelationshipModule or TerritoryModule', () => {
    const source = readSource('distribution.module.ts');
    expect(source).not.toMatch(/from ['"].*retail\/network/);
    expect(source).not.toMatch(/from ['"].*retail\/territory/);
  });

  // Sprint 10 (brief §15/§28): Sales Fulfilment is the sole accounting-triggering
  // event — inventory already left stock and COGS already posted there. Dispatch and
  // Delivery are pure logistics/receipt-confirmation events and must never post a
  // second accounting entry for the same goods.
  it('structural guard: DispatchService/DeliveryService/DispatchRepository/DeliveryRepository never post accounting entries', () => {
    for (const fileName of [
      'dispatch.service.ts',
      'delivery.service.ts',
      'dispatch.repository.ts',
      'delivery.repository.ts',
    ]) {
      const source = readSource(fileName);
      expect(source).not.toMatch(/postSystemJournalEntry\(/);
      expect(source).not.toMatch(/tx\.journalEntry\./);
    }
  });

  it('structural guard: DistributionModule never imports FinanceModule or a Finance repository/service/controller', () => {
    const source = readSource('distribution.module.ts');
    expect(source).not.toMatch(/from ['"].*finance\/finance\.module/);
    expect(source).not.toMatch(/from ['"].*finance\/.*\.(repository|service|controller)/);
  });
});
