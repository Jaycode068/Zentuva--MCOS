import { Injectable } from '@nestjs/common';

import { AccountsPayableService } from '../accounts-payable.service';
import { SYSTEM_ACCOUNT_KEYS } from '../accounting/chart-of-account-keys';
import { LedgerService } from '../accounting/ledger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { computeRemainingPayableQuantity } from '../supplier-invoice-matching';

export interface PayablesReconciliationResult {
  asOf: Date;
  /** `LedgerService.getSystemAccountBalance(org, AP)` — the General Ledger's own
   *  Accounts Payable control-account balance, including every goods-receipt accrual
   *  regardless of whether a matching `SupplierInvoice` has been created yet. */
  glAccountsPayableBalance: number;
  /** `AccountsPayableService.getSummary(org).totalOutstanding` — the existing,
   *  unchanged Payables subledger figure (SupplierInvoice-based). Never recomputed or
   *  overridden here; this report only ever reads it alongside the GL figure. */
  supplierInvoiceOutstandingBalance: number;
  /** `glAccountsPayableBalance − supplierInvoiceOutstandingBalance`. Reported, never
   *  corrected — same "visibility only" convention as `ReconciliationService`'s
   *  existing Inventory-to-Ledger report. */
  difference: number;
  /**
   * Stage 4E.4A correction — replaces the earlier (Stage 4E.2) `explainedBy
   * UnmatchedGoodsReceipts` field, which summed *every* `GOODS_RECEIPT`-sourced AP
   * journal line unconditionally, regardless of whether a Supplier Invoice had since
   * matched against it (Stage 4E.1/4E.3 found this would go wrong — and silently
   * produce a negative, nonsensical "unexplained residual" — the moment any goods
   * receipt in this organisation is actually invoice-matched, which the seed baseline
   * never exercised).
   *
   * This field instead sums, across every `GoodsReceiptItem` for this organisation,
   * `computeRemainingPayableQuantity(item) × item.purchaseOrderItem.unitPrice` — the
   * exact same formula (not a reimplementation — the shared, exported function)
   * `computeLineMatch` already uses to cap a matching Supplier Invoice line. A line
   * that has since been fully matched (`invoicedQuantity` already consumes its whole
   * `payableQuantity`) contributes `0` here, by construction — never double-counted.
   */
  unmatchedGoodsReceiptLiability: number;
  /** `difference − unmatchedGoodsReceiptLiability`. Whatever remains after the
   *  genuinely-unmatched-goods-receipt component is measured and subtracted —
   *  reported separately rather than folded into, or assumed to be covered by, that
   *  explanation. A non-zero value here means part of the gap has no known
   *  explanation yet. */
  unexplainedResidual: number;
  reconciled: boolean;
}

/**
 * Payables-to-Ledger Reconciliation (Stage 4E.2, corrected Stage 4E.4A), following
 * docs/domains/accounting.md §16.3's existing Inventory-to-Ledger Reconciliation
 * convention. A control/visibility mechanism only — never adjusts either side.
 * Compares the GL's Accounts Payable control-account balance against the existing
 * SupplierInvoice-based Payables subledger figure (`AccountsPayableService`,
 * unchanged), and separately measures how much of any difference is attributable to
 * goods-receipt accruals genuinely still awaiting an invoice match, using the
 * matching-state fields (`GoodsReceiptItem.invoicedQuantity` et al.) rather than
 * journal-entry activity alone — journal entries don't change when a match happens
 * (Stage 4E.1), so they cannot answer "is this matched yet?" on their own.
 *
 * Preserves the existing accounting design confirmed in Stage 4E.1: goods receipts
 * recognise the accrued liability once, at receiving time; a later Path-A matching
 * supplier-invoice line never posts a second journal entry. This report does not
 * change that — it only makes the resulting GL/subledger difference visible and
 * explains as much of it as the underlying records support.
 */
@Injectable()
export class PayablesReconciliationService {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly accountsPayableService: AccountsPayableService,
    private readonly prisma: PrismaService,
  ) {}

  async getPayablesReconciliation(organisationId: string): Promise<PayablesReconciliationResult> {
    const [glAccountsPayableBalance, apSummary] = await Promise.all([
      this.ledgerService.getSystemAccountBalance(organisationId, SYSTEM_ACCOUNT_KEYS.AP),
      this.accountsPayableService.getSummary(organisationId),
    ]);

    const supplierInvoiceOutstandingBalance = apSummary.totalOutstanding;
    const difference = roundCurrency(glAccountsPayableBalance - supplierInvoiceOutstandingBalance);

    const unmatchedGoodsReceiptLiability =
      await this.sumUnmatchedGoodsReceiptLiability(organisationId);
    const unexplainedResidual = roundCurrency(difference - unmatchedGoodsReceiptLiability);

    return {
      asOf: new Date(),
      glAccountsPayableBalance,
      supplierInvoiceOutstandingBalance,
      difference,
      unmatchedGoodsReceiptLiability,
      unexplainedResidual,
      reconciled: Math.abs(difference) < 0.01,
    };
  }

  /**
   * Read-only reach into Inventory/Procurement's own `GoodsReceiptItem` table — the
   * same "narrow, documented exception" `InventoryValuationService` already
   * established for Finance reading another domain's tables directly for a report,
   * rather than importing that domain's whole module.
   */
  private async sumUnmatchedGoodsReceiptLiability(organisationId: string): Promise<number> {
    const items = await this.prisma.goodsReceiptItem.findMany({
      where: { goodsReceipt: { organisationId } },
      select: {
        payableQuantity: true,
        returnedQuantity: true,
        returnedExcessQuantity: true,
        invoicedQuantity: true,
        purchaseOrderItem: { select: { unitPrice: true } },
      },
    });

    const total = items.reduce((sum, item) => {
      const remainingQuantity = computeRemainingPayableQuantity(item);
      return sum + remainingQuantity * item.purchaseOrderItem.unitPrice;
    }, 0);

    return roundCurrency(total);
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
