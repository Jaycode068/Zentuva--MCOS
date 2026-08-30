import { Injectable } from '@nestjs/common';

import { SYSTEM_ACCOUNT_KEYS } from '../accounting/chart-of-account-keys';
import { LedgerService } from '../accounting/ledger.service';
import { InventoryValuationService } from './inventory-valuation.service';

export interface InventoryReconciliationResult {
  asOf: Date;
  /** Live `Σ(InventoryStock.quantityOnHand × averageUnitCost)` across every location
   *  — always "as of right now", since `InventoryStock` is a live balance, not a
   *  ledger with historical snapshots (unlike the GL side below). */
  inventorySubledgerValue: number;
  /** `INVENTORY + FINISHED_GOODS_INVENTORY` system account balances, combined.
   *  `WIP` is deliberately excluded — it represents in-progress production value
   *  with no corresponding `InventoryStock` row, not physical stock on a shelf
   *  (docs/domains/accounting.md §16.3). */
  glInventoryBalance: number;
  /** `inventorySubledgerValue − glInventoryBalance`. Reported, never corrected —
   *  this report never writes anything (brief §15/§33). */
  difference: number;
  reconciled: boolean;
}

/**
 * Inventory-to-Ledger Reconciliation (Sprint 13, docs/domains/accounting.md §16.3)
 * — a control/visibility mechanism only. Compares the Inventory subledger (live
 * `InventoryStock` valuation) against the General Ledger's own Inventory-related
 * system account balances. **Never adjusts either side** — a real difference is a
 * genuine finding for accounting/management to investigate, not something this
 * report is permitted to silently fix (brief §15/§33 explicit).
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly inventoryValuationService: InventoryValuationService,
    private readonly ledgerService: LedgerService,
  ) {}

  async getInventoryReconciliation(organisationId: string): Promise<InventoryReconciliationResult> {
    const [valuation, inventoryBalance, finishedGoodsBalance] = await Promise.all([
      this.inventoryValuationService.getValuation(organisationId),
      this.ledgerService.getSystemAccountBalance(organisationId, SYSTEM_ACCOUNT_KEYS.INVENTORY),
      this.ledgerService.getSystemAccountBalance(
        organisationId,
        SYSTEM_ACCOUNT_KEYS.FINISHED_GOODS_INVENTORY,
      ),
    ]);

    const inventorySubledgerValue = valuation.totals.grandTotal;
    const glInventoryBalance = roundCurrency(inventoryBalance + finishedGoodsBalance);
    const difference = roundCurrency(inventorySubledgerValue - glInventoryBalance);

    return {
      asOf: new Date(),
      inventorySubledgerValue,
      glInventoryBalance,
      difference,
      reconciled: Math.abs(difference) < 0.01,
    };
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
