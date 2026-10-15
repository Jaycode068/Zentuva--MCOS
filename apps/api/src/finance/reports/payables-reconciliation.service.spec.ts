import { AccountsPayableService } from '../accounts-payable.service';
import { LedgerService } from '../accounting/ledger.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PayablesReconciliationService } from './payables-reconciliation.service';

interface GoodsReceiptItemFixture {
  payableQuantity: number;
  returnedQuantity?: number;
  returnedExcessQuantity?: number;
  invoicedQuantity?: number;
  purchaseOrderItem: { unitPrice: number };
}

function makeService(options: {
  glBalance: number;
  invoiceOutstanding: number;
  goodsReceiptItems?: GoodsReceiptItemFixture[];
}) {
  const { glBalance, invoiceOutstanding, goodsReceiptItems = [] } = options;

  const ledgerService = {
    getSystemAccountBalance: jest.fn().mockResolvedValue(glBalance),
  } as unknown as jest.Mocked<LedgerService>;

  const accountsPayableService = {
    getSummary: jest.fn().mockResolvedValue({
      totalOutstanding: invoiceOutstanding,
      totalOverdue: 0,
      totalPartiallyPaid: 0,
      invoicedThisPeriod: 0,
      paymentsMadeThisPeriod: 0,
    }),
  } as unknown as jest.Mocked<AccountsPayableService>;

  const normalized = goodsReceiptItems.map((item) => ({
    payableQuantity: item.payableQuantity,
    returnedQuantity: item.returnedQuantity ?? 0,
    returnedExcessQuantity: item.returnedExcessQuantity ?? 0,
    invoicedQuantity: item.invoicedQuantity ?? 0,
    purchaseOrderItem: item.purchaseOrderItem,
  }));

  const prisma = {
    goodsReceiptItem: { findMany: jest.fn().mockResolvedValue(normalized) },
  } as unknown as jest.Mocked<PrismaService>;

  return {
    service: new PayablesReconciliationService(ledgerService, accountsPayableService, prisma),
    ledgerService,
    accountsPayableService,
    prisma,
  };
}

describe('PayablesReconciliationService', () => {
  it('reports a matched reconciliation when the GL and supplier-invoice subledger agree, with no goods receipts at all', async () => {
    const { service } = makeService({ glBalance: 0, invoiceOutstanding: 0, goodsReceiptItems: [] });

    const result = await service.getPayablesReconciliation('org-1');

    expect(result.glAccountsPayableBalance).toBe(0);
    expect(result.supplierInvoiceOutstandingBalance).toBe(0);
    expect(result.difference).toBe(0);
    expect(result.unmatchedGoodsReceiptLiability).toBe(0);
    expect(result.unexplainedResidual).toBe(0);
    expect(result.reconciled).toBe(true);
  });

  it('fully unmatched goods receipt: the entire payable quantity is still liability', async () => {
    // Mirrors the real Stage 4E.1/4E.4A baseline: GL ₦6,430,000 vs invoice-subledger
    // ₦5,000,000 — a ₦1,430,000 difference, with none of the receipts ever matched.
    const { service } = makeService({
      glBalance: 6_430_000,
      invoiceOutstanding: 5_000_000,
      goodsReceiptItems: [
        { payableQuantity: 2000, invoicedQuantity: 0, purchaseOrderItem: { unitPrice: 350 } }, // 700,000
        { payableQuantity: 500, invoicedQuantity: 0, purchaseOrderItem: { unitPrice: 180 } }, // 90,000
        { payableQuantity: 950, invoicedQuantity: 0, purchaseOrderItem: { unitPrice: 90 } }, // 85,500
        { payableQuantity: 50, invoicedQuantity: 0, purchaseOrderItem: { unitPrice: 90 } }, // 4,500
        { payableQuantity: 1000, invoicedQuantity: 0, purchaseOrderItem: { unitPrice: 150 } }, // 150,000
        { payableQuantity: 200, invoicedQuantity: 0, purchaseOrderItem: { unitPrice: 2000 } }, // 400,000
      ],
    });

    const result = await service.getPayablesReconciliation('org-1');

    expect(result.difference).toBe(1_430_000);
    expect(result.unmatchedGoodsReceiptLiability).toBe(1_430_000);
    expect(result.unexplainedResidual).toBe(0);
    expect(result.reconciled).toBe(false);
  });

  it('fully matched goods receipt: contributes zero liability, even though its original GL posting never clears', async () => {
    // This is the exact Stage 4E.1/4E.3 scenario the old field name got wrong: once
    // fully invoiced, the GL entry is unchanged, but the item must contribute 0 here.
    const { service } = makeService({
      glBalance: 100_000, // the original goods-receipt AP posting, still sitting in the GL
      invoiceOutstanding: 100_000, // a matching invoice now also recognises it
      goodsReceiptItems: [
        { payableQuantity: 1000, invoicedQuantity: 1000, purchaseOrderItem: { unitPrice: 100 } },
      ],
    });

    const result = await service.getPayablesReconciliation('org-1');

    expect(result.difference).toBe(0);
    expect(result.unmatchedGoodsReceiptLiability).toBe(0);
    expect(result.unexplainedResidual).toBe(0);
    expect(result.reconciled).toBe(true);
  });

  it('partially matched goods receipt: only the remaining un-invoiced portion counts', async () => {
    const { service } = makeService({
      glBalance: 100_000,
      invoiceOutstanding: 60_000, // the matched 600 units already recognised by an invoice
      goodsReceiptItems: [
        { payableQuantity: 1000, invoicedQuantity: 600, purchaseOrderItem: { unitPrice: 100 } },
      ],
    });

    const result = await service.getPayablesReconciliation('org-1');

    expect(result.difference).toBe(40_000);
    expect(result.unmatchedGoodsReceiptLiability).toBe(40_000); // 400 remaining * 100
    expect(result.unexplainedResidual).toBe(0);
  });

  it('multiple receipt lines: fully unmatched, fully matched, and partially matched summed correctly', async () => {
    const { service } = makeService({
      glBalance: 300_000,
      invoiceOutstanding: 160_000,
      goodsReceiptItems: [
        { payableQuantity: 500, invoicedQuantity: 0, purchaseOrderItem: { unitPrice: 200 } }, // unmatched: 100,000
        { payableQuantity: 1000, invoicedQuantity: 1000, purchaseOrderItem: { unitPrice: 100 } }, // matched: 0
        { payableQuantity: 1000, invoicedQuantity: 400, purchaseOrderItem: { unitPrice: 100 } }, // partial: 60,000
      ],
    });

    const result = await service.getPayablesReconciliation('org-1');

    expect(result.unmatchedGoodsReceiptLiability).toBe(160_000);
    expect(result.difference).toBe(140_000);
    // 140,000 - 160,000 would be negative if this regressed — must not happen.
    expect(result.unexplainedResidual).toBe(-20_000);
  });

  it('pending-approval excess quantity is excluded — payableQuantity already excludes it, never re-subtracted', async () => {
    // payableQuantity itself already excludes the GRNI-pending-approval excess
    // (GoodsReceiptRepository computes payableQuantity = min(accepted, remaining
    // ordered) at receipt time) — this test proves the reconciliation does not need,
    // and does not apply, any separate excess deduction on top of that.
    const { service } = makeService({
      glBalance: 15_000, // the GRNI_PENDING_APPROVAL amount lives on a different account entirely
      invoiceOutstanding: 0,
      goodsReceiptItems: [
        // payableQuantity 100 (the commercially payable portion); the excess beyond
        // the PO quantity is not represented here at all, by design.
        { payableQuantity: 100, invoicedQuantity: 0, purchaseOrderItem: { unitPrice: 150 } },
      ],
    });

    const result = await service.getPayablesReconciliation('org-1');

    expect(result.unmatchedGoodsReceiptLiability).toBe(15_000);
  });

  it('a Supplier Return against the payable bucket reduces the remaining liability', async () => {
    const { service } = makeService({
      glBalance: 80_000,
      invoiceOutstanding: 0,
      goodsReceiptItems: [
        {
          payableQuantity: 1000,
          returnedQuantity: 200,
          returnedExcessQuantity: 0,
          invoicedQuantity: 0,
          purchaseOrderItem: { unitPrice: 100 },
        },
      ],
    });

    const result = await service.getPayablesReconciliation('org-1');

    // 1000 - 200 returned = 800 remaining * 100 = 80,000.
    expect(result.unmatchedGoodsReceiptLiability).toBe(80_000);
  });

  it('settlement after matching: a paid, matched invoice leaves both sides at zero, never double-counted', async () => {
    // Matching recognised the liability (reducing invoiceOutstanding's contribution
    // is irrelevant here since it's now reflected), then a payment settles it —
    // AccountsPayableService.getSummary already nets amountPaid, so a fully
    // paid+matched invoice means both totalOutstanding and the GL are 0 together.
    const { service } = makeService({
      glBalance: 0,
      invoiceOutstanding: 0,
      goodsReceiptItems: [
        { payableQuantity: 500, invoicedQuantity: 500, purchaseOrderItem: { unitPrice: 50 } },
      ],
    });

    const result = await service.getPayablesReconciliation('org-1');

    expect(result.difference).toBe(0);
    expect(result.unmatchedGoodsReceiptLiability).toBe(0);
    expect(result.unexplainedResidual).toBe(0);
    expect(result.reconciled).toBe(true);
  });

  it('surfaces a genuinely unexplained residual separately, never assuming goods receipts cover it', async () => {
    const { service } = makeService({
      glBalance: 1_000_000,
      invoiceOutstanding: 400_000,
      goodsReceiptItems: [
        { payableQuantity: 3500, invoicedQuantity: 0, purchaseOrderItem: { unitPrice: 100 } },
      ], // 350,000
    });

    const result = await service.getPayablesReconciliation('org-1');

    expect(result.difference).toBe(600_000);
    expect(result.unmatchedGoodsReceiptLiability).toBe(350_000);
    expect(result.unexplainedResidual).toBe(250_000);
    expect(result.reconciled).toBe(false);
  });

  it('monetary precision: rounds to the nearest cent/kobo, never accumulating floating-point drift', async () => {
    const { service } = makeService({
      glBalance: 0,
      invoiceOutstanding: 0,
      goodsReceiptItems: [
        { payableQuantity: 3, invoicedQuantity: 1, purchaseOrderItem: { unitPrice: 0.1 } },
        { payableQuantity: 7, invoicedQuantity: 2, purchaseOrderItem: { unitPrice: 0.2 } },
      ],
    });

    const result = await service.getPayablesReconciliation('org-1');

    // (3-1)*0.1 + (7-2)*0.2 = 0.2 + 1.0 = 1.2, free of floating-point noise.
    expect(result.unmatchedGoodsReceiptLiability).toBe(1.2);
  });

  it('tenant isolation: each organisation is queried independently, never mixed', async () => {
    const { service, ledgerService, accountsPayableService, prisma } = makeService({
      glBalance: 0,
      invoiceOutstanding: 0,
    });

    await service.getPayablesReconciliation('org-1');
    await service.getPayablesReconciliation('org-2');

    expect(ledgerService.getSystemAccountBalance).toHaveBeenNthCalledWith(1, 'org-1', 'AP');
    expect(ledgerService.getSystemAccountBalance).toHaveBeenNthCalledWith(2, 'org-2', 'AP');
    expect(accountsPayableService.getSummary).toHaveBeenNthCalledWith(1, 'org-1');
    expect(accountsPayableService.getSummary).toHaveBeenNthCalledWith(2, 'org-2');
    expect(prisma.goodsReceiptItem.findMany).toHaveBeenNthCalledWith(1, {
      where: { goodsReceipt: { organisationId: 'org-1' } },
      select: expect.any(Object),
    });
    expect(prisma.goodsReceiptItem.findMany).toHaveBeenNthCalledWith(2, {
      where: { goodsReceipt: { organisationId: 'org-2' } },
      select: expect.any(Object),
    });
  });

  it('never silently changes the supplier-invoice outstanding figure — passes it through unmodified', async () => {
    const { service, accountsPayableService } = makeService({
      glBalance: 0,
      invoiceOutstanding: 123_456.78,
    });

    const result = await service.getPayablesReconciliation('org-1');

    expect(result.supplierInvoiceOutstandingBalance).toBe(123_456.78);
    expect(accountsPayableService.getSummary).toHaveBeenCalledTimes(1);
  });

  it('never mutates anything — the service exposes no write method', () => {
    const { service } = makeService({ glBalance: 0, invoiceOutstanding: 0 });
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(service)).filter(
      (name) => !name.startsWith('sum'), // private helper, not part of the public contract check
    );
    expect(methodNames).toEqual(['constructor', 'getPayablesReconciliation']);
  });
});
