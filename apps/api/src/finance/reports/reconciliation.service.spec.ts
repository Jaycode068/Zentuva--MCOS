import { InventoryValuationService } from './inventory-valuation.service';
import { LedgerService } from '../accounting/ledger.service';
import { ReconciliationService } from './reconciliation.service';

function makeService(grandTotal: number, inventoryBalance: number, finishedGoodsBalance: number) {
  const inventoryValuationService = {
    getValuation: jest
      .fn()
      .mockResolvedValue({ lines: [], totals: { grandTotal, byLocation: [], byProductType: [] } }),
  } as unknown as jest.Mocked<InventoryValuationService>;
  const ledgerService = {
    getSystemAccountBalance: jest
      .fn()
      .mockImplementation(async (_org: string, systemKey: string) =>
        systemKey === 'INVENTORY' ? inventoryBalance : finishedGoodsBalance,
      ),
  } as unknown as jest.Mocked<LedgerService>;
  return {
    service: new ReconciliationService(inventoryValuationService, ledgerService),
    inventoryValuationService,
    ledgerService,
  };
}

describe('ReconciliationService', () => {
  it('reports a matched reconciliation when the subledger and GL agree', async () => {
    const { service } = makeService(1_500_000, 1_000_000, 500_000);

    const result = await service.getInventoryReconciliation('org-1');

    expect(result.inventorySubledgerValue).toBe(1_500_000);
    expect(result.glInventoryBalance).toBe(1_500_000);
    expect(result.difference).toBe(0);
    expect(result.reconciled).toBe(true);
  });

  it('surfaces a real difference without correcting it', async () => {
    const { service } = makeService(1_500_000, 1_000_000, 400_000);

    const result = await service.getInventoryReconciliation('org-1');

    expect(result.glInventoryBalance).toBe(1_400_000);
    expect(result.difference).toBe(100_000);
    expect(result.reconciled).toBe(false);
  });

  it('excludes WIP from the GL side — only queries INVENTORY and FINISHED_GOODS_INVENTORY', async () => {
    const { service, ledgerService } = makeService(0, 0, 0);

    await service.getInventoryReconciliation('org-1');

    const queriedKeys = ledgerService.getSystemAccountBalance.mock.calls.map((call) => call[1]);
    expect(queriedKeys).toEqual(expect.arrayContaining(['INVENTORY', 'FINISHED_GOODS_INVENTORY']));
    expect(queriedKeys).not.toContain('WIP');
  });

  it('never mutates anything — the service exposes no write method', () => {
    const { service } = makeService(0, 0, 0);
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
    expect(methodNames).toEqual(['constructor', 'getInventoryReconciliation']);
  });
});
