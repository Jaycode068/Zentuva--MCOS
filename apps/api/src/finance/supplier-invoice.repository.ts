import { Injectable } from '@nestjs/common';
import {
  JournalEntryStatus,
  PaymentTermType,
  Prisma,
  SupplierInvoice,
  SupplierInvoiceItem,
  SupplierInvoiceStatus,
} from '@prisma/client';

import { SYSTEM_ACCOUNT_KEYS } from './accounting/chart-of-account-keys';
import { postSystemJournalEntry, resolveOpenPeriodId } from './accounting/journal-posting';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeHeaderMatchStatus,
  computeLineMatch,
  validatePathBAccount,
} from './supplier-invoice-matching';

const SUPPLIER_SELECT = { id: true, supplierCode: true, supplierName: true };
const PURCHASE_ORDER_SELECT = { id: true, purchaseOrderNumber: true };
const PRODUCT_SELECT = { id: true, code: true, name: true, unit: true };
const ACCOUNT_SELECT = { id: true, code: true, name: true };

export type SupplierInvoiceWithRelations = SupplierInvoice & {
  supplier: { id: string; supplierCode: string; supplierName: string };
  purchaseOrder: { id: string; purchaseOrderNumber: string } | null;
  items: (SupplierInvoiceItem & {
    product: { id: string; code: string; name: string; unit: string } | null;
    goodsReceiptItem: { id: string; goodsReceiptId: string } | null;
    debitAccount: { id: string; code: string; name: string } | null;
  })[];
};

const RELATIONS_INCLUDE = {
  supplier: { select: SUPPLIER_SELECT },
  purchaseOrder: { select: PURCHASE_ORDER_SELECT },
  items: {
    include: {
      product: { select: PRODUCT_SELECT },
      goodsReceiptItem: { select: { id: true, goodsReceiptId: true } },
      debitAccount: { select: ACCOUNT_SELECT },
    },
    orderBy: { createdAt: 'asc' as const },
  },
};

/** Eligible to receive a `SupplierPayment`/`SupplierCreditNote` — anything still
 *  genuinely owing money. Never `DRAFT` (not yet a real financial document), `PAID`,
 *  or `VOID` — same rule as `PAYABLE_INVOICE_STATUSES`. */
export const PAYABLE_SUPPLIER_INVOICE_STATUSES: SupplierInvoiceStatus[] = [
  SupplierInvoiceStatus.POSTED,
  SupplierInvoiceStatus.PARTIALLY_PAID,
  SupplierInvoiceStatus.OVERDUE,
];

/** One row of `getOutstandingForAging`'s result (Sprint 13, docs/domains/finance.md
 *  "Accounts Payable Aging") — everything `AccountsPayableService.getAgingReport()`
 *  needs to bucket by days-past-due, nothing more. */
export interface AgingSupplierInvoiceRow {
  id: string;
  invoiceNumber: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  dueDate: Date;
  amountOutstanding: number;
}

export interface JournalEntrySummary {
  id: string;
  journalNumber: string;
  status: JournalEntryStatus;
  totalAmount: number;
}

export interface ListSupplierInvoicesParams {
  status?: SupplierInvoiceStatus;
  supplierId?: string;
  purchaseOrderId?: string;
  search?: string;
}

export interface SupplierInvoiceItemData {
  productId?: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  goodsReceiptItemId?: string;
  debitAccountId?: string;
}

export interface CreateSupplierInvoiceData {
  organisationId: string;
  supplierId: string;
  purchaseOrderId?: string;
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  paymentTerms: PaymentTermType;
  currency: string;
  taxAmount?: number;
  notes?: string;
  idempotencyKey?: string;
  createdById: string;
  items: SupplierInvoiceItemData[];
}

export interface CreateSupplierInvoiceResult {
  supplierInvoice: SupplierInvoiceWithRelations;
  wasCreated: boolean;
}

export interface UpdateSupplierInvoiceData {
  purchaseOrderId?: string | null;
  invoiceNumber?: string;
  invoiceDate?: Date;
  dueDate?: Date;
  paymentTerms?: PaymentTermType;
  taxAmount?: number;
  notes?: string;
  items?: SupplierInvoiceItemData[];
}

export interface PostSupplierInvoiceResult {
  supplierInvoice: SupplierInvoiceWithRelations;
  journalEntry: JournalEntrySummary | null;
  wasCreated: boolean;
}

/** Thrown when `post()`/`void()`/`update()` is attempted on an invoice that isn't in
 *  the expected status for that transition — re-checked inside the transaction to
 *  close the race against a concurrent change, same role as
 *  `SalesFulfilmentConflictError`. */
export class SupplierInvoiceConflictError extends Error {}

/** Thrown when a line's `goodsReceiptItemId` doesn't resolve to a real
 *  `GoodsReceiptItem` belonging to this organisation and this invoice's own
 *  supplier. */
export class InvalidGoodsReceiptReferenceError extends Error {}

/** Thrown when a line has neither `goodsReceiptItemId` nor `debitAccountId` set at
 *  `post()` time — never defaulted/guessed (brief §15/§20 "PO-less/GR-less
 *  clarification"). */
export class MissingLineReferenceError extends Error {}

/**
 * Thin Prisma access for the `SupplierInvoice` aggregate (Sprint 12,
 * docs/domains/finance.md "Accounts Payable"). `create()`/`update()` are plain DRAFT
 * writes; `post()` is the one atomic, money-critical transaction — see its own doc
 * comment below. `void()` mirrors `InvoiceRepository.updateStatus()`'s exact
 * tenant-scoped conditional-transition shape.
 *
 * Writing directly into `GoodsReceiptItem`/`ChartOfAccount` here (read for Path A/B
 * resolution, and a cumulative-counter write on `GoodsReceiptItem.invoicedQuantity`)
 * is the same deliberate, narrow exception to ADR-002's domain-ownership convention
 * that `SupplierReturnRepository`/`CustomerReturnRepository` (Sprint 11) already
 * establish, made for atomicity — no new NestJS module dependency on Inventory.
 */
@Injectable()
export class SupplierInvoiceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<SupplierInvoiceWithRelations | null> {
    return this.prisma.supplierInvoice.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  async findManyByOrganisation(
    organisationId: string,
    params: ListSupplierInvoicesParams = {},
  ): Promise<SupplierInvoiceWithRelations[]> {
    await this.sweepOverdue(organisationId);
    return this.prisma.supplierInvoice.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.supplierId ? { supplierId: params.supplierId } : {}),
        ...(params.purchaseOrderId ? { purchaseOrderId: params.purchaseOrderId } : {}),
        ...(params.search
          ? {
              OR: [
                { invoiceNumber: { contains: params.search, mode: 'insensitive' } },
                { supplier: { supplierName: { contains: params.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Scoped to `supplierId` — never globally unique (brief explicit requirement, a
   *  supplier's own invoice numbering). */
  async existsByNumber(supplierId: string, invoiceNumber: string): Promise<boolean> {
    const count = await this.prisma.supplierInvoice.count({ where: { supplierId, invoiceNumber } });
    return count > 0;
  }

  /** Pre-transaction idempotency lookup, same role as
   *  `CustomerReturnRepository.findByIdempotencyKey` (Sprint 11) —
   *  `SupplierInvoiceService.create()` checks this *before* any business-rule
   *  pre-check (duplicate invoice number, supplier/PO eligibility), so a genuine
   *  retry never gets rejected by a check that's only valid against a request that
   *  hasn't already succeeded. */
  async findByIdempotencyKey(
    organisationId: string,
    supplierId: string,
    idempotencyKey: string,
  ): Promise<SupplierInvoiceWithRelations | null> {
    const existing = await this.prisma.supplierInvoice.findUnique({
      where: { supplierId_idempotencyKey: { supplierId, idempotencyKey } },
      include: RELATIONS_INCLUDE,
    });
    if (!existing || existing.organisationId !== organisationId) {
      return null;
    }
    return existing;
  }

  private async findJournalEntry(
    tx: Prisma.TransactionClient,
    organisationId: string,
    supplierInvoiceId: string,
  ): Promise<JournalEntrySummary | null> {
    const journalEntry = await tx.journalEntry.findUnique({
      where: {
        organisationId_sourceType_sourceId: {
          organisationId,
          sourceType: 'SUPPLIER_INVOICE',
          sourceId: supplierInvoiceId,
        },
      },
      include: { lines: { select: { debit: true } } },
    });
    if (!journalEntry) {
      return null;
    }
    return {
      id: journalEntry.id,
      journalNumber: journalEntry.journalNumber,
      status: journalEntry.status,
      totalAmount: roundCurrency(journalEntry.lines.reduce((sum, line) => sum + line.debit, 0)),
    };
  }

  async create(data: CreateSupplierInvoiceData): Promise<CreateSupplierInvoiceResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.supplierInvoice.findUnique({
          where: {
            supplierId_idempotencyKey: {
              supplierId: data.supplierId,
              idempotencyKey: data.idempotencyKey,
            },
          },
          include: RELATIONS_INCLUDE,
        });
        if (existing) {
          return { supplierInvoice: existing, wasCreated: false };
        }
      }

      const { subtotal, total, items } = buildItems(data.items, data.taxAmount ?? 0);

      const supplierInvoice = await tx.supplierInvoice.create({
        data: {
          organisationId: data.organisationId,
          supplierId: data.supplierId,
          purchaseOrderId: data.purchaseOrderId,
          invoiceNumber: data.invoiceNumber,
          invoiceDate: data.invoiceDate,
          dueDate: data.dueDate,
          paymentTerms: data.paymentTerms,
          status: SupplierInvoiceStatus.DRAFT,
          currency: data.currency,
          subtotal,
          taxAmount: data.taxAmount ?? 0,
          total,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
          updatedById: data.createdById,
          items: { create: items },
        },
        include: RELATIONS_INCLUDE,
      });

      return { supplierInvoice, wasCreated: true };
    });
  }

  /** DRAFT only — a full items replace (delete-then-recreate), same convention as
   *  `PurchaseOrderRepository.update()`. Returns `null` if no row matched
   *  `(id, organisationId)`; throws `SupplierInvoiceConflictError` if the row exists
   *  but isn't `DRAFT`. */
  async update(
    organisationId: string,
    id: string,
    data: UpdateSupplierInvoiceData,
    actorUserId: string,
  ): Promise<SupplierInvoiceWithRelations | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.supplierInvoice.findFirst({ where: { id, organisationId } });
      if (!existing) {
        return null;
      }
      if (existing.status !== SupplierInvoiceStatus.DRAFT) {
        throw new SupplierInvoiceConflictError('Only a draft supplier invoice can be edited');
      }

      const headerData: Prisma.SupplierInvoiceUncheckedUpdateManyInput = {
        updatedById: actorUserId,
      };
      if (data.purchaseOrderId !== undefined) headerData.purchaseOrderId = data.purchaseOrderId;
      if (data.invoiceNumber !== undefined) headerData.invoiceNumber = data.invoiceNumber;
      if (data.invoiceDate !== undefined) headerData.invoiceDate = data.invoiceDate;
      if (data.dueDate !== undefined) headerData.dueDate = data.dueDate;
      if (data.paymentTerms !== undefined) headerData.paymentTerms = data.paymentTerms;

      if (data.items) {
        const { subtotal, total, items } = buildItems(
          data.items,
          data.taxAmount ?? existing.taxAmount,
        );
        headerData.subtotal = subtotal;
        headerData.taxAmount = data.taxAmount ?? existing.taxAmount;
        headerData.total = total;
        await tx.supplierInvoiceItem.deleteMany({ where: { supplierInvoiceId: id } });
        await tx.supplierInvoiceItem.createMany({
          data: items.map((item) => ({ ...item, supplierInvoiceId: id })),
        });
      } else if (data.taxAmount !== undefined) {
        headerData.taxAmount = data.taxAmount;
        headerData.total = roundCurrency(existing.subtotal + data.taxAmount);
      }

      await tx.supplierInvoice.updateMany({ where: { id }, data: headerData });
      return tx.supplierInvoice.findUniqueOrThrow({ where: { id }, include: RELATIONS_INCLUDE });
    });
  }

  /**
   * `DRAFT -> POSTED` — the one atomic, money-critical transaction (docs/domains/
   * accounting.md "Supplier Invoice Matching"). For each line: Path A
   * (`goodsReceiptItemId` set) is capped against that Goods Receipt line's remaining
   * payable value (`computeLineMatch`) — never a new journal, since Goods Receipt
   * already posted the liability; Path B (`debitAccountId` set) is recognised in
   * full and grouped into one `DR <account> / CR AP` journal entry per invoice (not
   * per line). Every line must resolve to exactly one path or the whole posting
   * rolls back (`MissingLineReferenceError`). Idempotency is checked *before* the
   * `DRAFT`-status precheck (Sprint 9→10 lesson) via `postIdempotencyKey`, a
   * separate key from `create()`'s own `idempotencyKey` — same two-key convention
   * `CustomerReturn` (Sprint 11) established for its own two-phase lifecycle.
   */
  async post(
    organisationId: string,
    id: string,
    actorUserId: string,
    postIdempotencyKey?: string,
  ): Promise<PostSupplierInvoiceResult> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.supplierInvoice.findFirst({
        where: { id, organisationId },
        include: RELATIONS_INCLUDE,
      });
      if (!existing) {
        throw new SupplierInvoiceConflictError('Supplier invoice not found');
      }

      if (postIdempotencyKey && existing.postIdempotencyKey === postIdempotencyKey) {
        const journalEntry = await this.findJournalEntry(tx, organisationId, existing.id);
        return { supplierInvoice: existing, journalEntry, wasCreated: false };
      }

      if (existing.status !== SupplierInvoiceStatus.DRAFT) {
        throw new SupplierInvoiceConflictError('Only a draft supplier invoice can be posted');
      }

      // Resolve every referenced GoodsReceiptItem in one query, scoped to this
      // organisation and this invoice's own supplier (a defensive check — an item
      // referencing another supplier's receipt is never legitimate).
      const goodsReceiptItemIds = existing.items
        .map((item) => item.goodsReceiptItemId)
        .filter((value): value is string => Boolean(value));
      const goodsReceiptItems =
        goodsReceiptItemIds.length > 0
          ? await tx.goodsReceiptItem.findMany({
              where: {
                id: { in: goodsReceiptItemIds },
                goodsReceipt: { organisationId, supplierId: existing.supplierId },
              },
              include: { purchaseOrderItem: { select: { unitPrice: true } } },
            })
          : [];
      const goodsReceiptItemById = new Map(goodsReceiptItems.map((row) => [row.id, row]));

      // Resolve every referenced debit account in one query, scoped to this
      // organisation.
      const debitAccountIds = existing.items
        .map((item) => item.debitAccountId)
        .filter((value): value is string => Boolean(value));
      const debitAccounts =
        debitAccountIds.length > 0
          ? await tx.chartOfAccount.findMany({
              where: { id: { in: debitAccountIds }, organisationId },
            })
          : [];
      const debitAccountById = new Map(debitAccounts.map((row) => [row.id, row]));

      // Running local counters so multiple lines against the same GoodsReceiptItem
      // within one invoice correctly compound against each other, not just the
      // value already in the database before this transaction started.
      const runningInvoicedQuantity = new Map(
        goodsReceiptItems.map((row) => [row.id, row.invoicedQuantity]),
      );

      const pathAVariances: number[] = [];
      let recognizedTotal = 0;
      const pathBByAccount = new Map<string, number>();
      const itemUpdates: { id: string; recognizedAmount: number; varianceAmount: number }[] = [];
      const invoicedQuantityIncrements = new Map<string, number>();

      for (const item of existing.items) {
        if (item.goodsReceiptItemId) {
          const goodsReceiptItem = goodsReceiptItemById.get(item.goodsReceiptItemId);
          if (!goodsReceiptItem) {
            throw new InvalidGoodsReceiptReferenceError(
              'One or more items reference a goods receipt that does not belong to this supplier',
            );
          }
          const match = computeLineMatch(
            {
              payableQuantity: goodsReceiptItem.payableQuantity,
              returnedQuantity: goodsReceiptItem.returnedQuantity,
              returnedExcessQuantity: goodsReceiptItem.returnedExcessQuantity,
              invoicedQuantity: runningInvoicedQuantity.get(item.goodsReceiptItemId) ?? 0,
            },
            goodsReceiptItem.purchaseOrderItem.unitPrice,
            { quantity: item.quantity, lineTotal: item.lineTotal },
          );
          runningInvoicedQuantity.set(
            item.goodsReceiptItemId,
            (runningInvoicedQuantity.get(item.goodsReceiptItemId) ?? 0) +
              match.invoicedQuantityDelta,
          );
          invoicedQuantityIncrements.set(
            item.goodsReceiptItemId,
            (invoicedQuantityIncrements.get(item.goodsReceiptItemId) ?? 0) +
              match.invoicedQuantityDelta,
          );
          pathAVariances.push(match.varianceAmount);
          recognizedTotal = roundCurrency(recognizedTotal + match.recognizedAmount);
          itemUpdates.push({
            id: item.id,
            recognizedAmount: match.recognizedAmount,
            varianceAmount: match.varianceAmount,
          });
        } else if (item.debitAccountId) {
          const account = debitAccountById.get(item.debitAccountId) ?? null;
          validatePathBAccount(
            account ? { type: account.type, isSystemAccount: account.isSystemAccount } : null,
          );
          recognizedTotal = roundCurrency(recognizedTotal + item.lineTotal);
          pathBByAccount.set(
            item.debitAccountId,
            roundCurrency((pathBByAccount.get(item.debitAccountId) ?? 0) + item.lineTotal),
          );
          itemUpdates.push({ id: item.id, recognizedAmount: item.lineTotal, varianceAmount: 0 });
        } else {
          throw new MissingLineReferenceError(
            'Every line must reference either a Goods Receipt item or a debit account before posting',
          );
        }
      }

      for (const update of itemUpdates) {
        await tx.supplierInvoiceItem.update({
          where: { id: update.id },
          data: {
            recognizedAmount: update.recognizedAmount,
            varianceAmount: update.varianceAmount,
          },
        });
      }
      for (const [goodsReceiptItemId, delta] of invoicedQuantityIncrements) {
        if (delta > 0) {
          await tx.goodsReceiptItem.update({
            where: { id: goodsReceiptItemId },
            data: { invoicedQuantity: { increment: delta } },
          });
        }
      }

      const matchStatus = computeHeaderMatchStatus(pathAVariances);
      const varianceAmount = roundCurrency(existing.total - recognizedTotal);

      // Accounting posting (docs/domains/accounting.md) — only for the Path B
      // portion, if any. Path A lines need no new journal: Goods Receipt already
      // posted the liability they reconcile against.
      let journalEntry: JournalEntrySummary | null = null;
      if (pathBByAccount.size > 0) {
        const totalPathBValue = roundCurrency(
          [...pathBByAccount.values()].reduce((sum, value) => sum + value, 0),
        );
        const posted = await postSystemJournalEntry(tx, {
          organisationId,
          date: existing.invoiceDate,
          description: `Supplier invoice ${existing.invoiceNumber} posted`,
          reference: existing.invoiceNumber,
          sourceType: 'SUPPLIER_INVOICE',
          sourceId: existing.id,
          actorUserId,
          lines: [
            ...[...pathBByAccount.entries()].map(([accountId, debit]) => ({ accountId, debit })),
            { systemKey: SYSTEM_ACCOUNT_KEYS.AP, credit: totalPathBValue },
          ],
        });
        journalEntry = {
          id: posted.journalEntry.id,
          journalNumber: posted.journalEntry.journalNumber,
          status: posted.journalEntry.status,
          totalAmount: totalPathBValue,
        };
      } else {
        // Still validated even when nothing posts, for consistency with every other
        // financial event and future period-close integrity.
        await resolveOpenPeriodId(tx, organisationId, existing.invoiceDate);
      }

      const supplierInvoice = await tx.supplierInvoice.update({
        where: { id },
        data: {
          status: SupplierInvoiceStatus.POSTED,
          matchStatus,
          recognizedAmount: recognizedTotal,
          varianceAmount,
          postedAt: new Date(),
          postedById: actorUserId,
          postIdempotencyKey,
          updatedById: actorUserId,
        },
        include: RELATIONS_INCLUDE,
      });

      return { supplierInvoice, journalEntry, wasCreated: true };
    });
  }

  /** A human sign-off on a `DISCREPANCY`-status invoice — never changes
   *  `recognizedAmount`/AP (brief §6). Returns `null` if no row matched. */
  async acknowledgeDiscrepancy(
    organisationId: string,
    id: string,
    actorUserId: string,
    notes?: string,
  ): Promise<SupplierInvoiceWithRelations | null> {
    const result = await this.prisma.supplierInvoice.updateMany({
      where: { id, organisationId },
      data: {
        discrepancyResolvedAt: new Date(),
        discrepancyResolvedById: actorUserId,
        discrepancyResolutionNotes: notes,
      },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.supplierInvoice.findUniqueOrThrow({
      where: { id },
      include: RELATIONS_INCLUDE,
    });
  }

  /** Tenant-scoped conditional status transition — mirrors
   *  `InvoiceRepository.updateStatus()` exactly. */
  async void(
    organisationId: string,
    id: string,
    fromStatuses: SupplierInvoiceStatus[],
    actorUserId: string,
  ): Promise<SupplierInvoiceWithRelations | null> {
    const result = await this.prisma.supplierInvoice.updateMany({
      where: { id, organisationId, status: { in: fromStatuses } },
      data: { status: SupplierInvoiceStatus.VOID, updatedById: actorUserId },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.supplierInvoice.findUniqueOrThrow({
      where: { id },
      include: RELATIONS_INCLUDE,
    });
  }

  /** Org-wide Accounts Payable aggregate — one row per supplier with at least one
   *  non-VOID supplier invoice. Uses `groupBy`, matching `InvoiceRepository.
   *  getArByCustomer`'s established idiom. `recognizedAmount` (not `total`) is the
   *  basis for "what's actually payable" — see `SupplierInvoice.recognizedAmount`'s
   *  own doc comment for why. */
  async getApBySupplier(organisationId: string) {
    await this.sweepOverdue(organisationId);
    return this.prisma.supplierInvoice.groupBy({
      by: ['supplierId'],
      where: { organisationId, status: { not: SupplierInvoiceStatus.VOID } },
      _sum: { total: true, recognizedAmount: true, amountPaid: true, amountCredited: true },
    });
  }

  /** Org-wide summary aggregate powering the Payables Overview cards. */
  async getApSummary(organisationId: string) {
    await this.sweepOverdue(organisationId);
    const [totals, overdue, partiallyPaid] = await Promise.all([
      this.prisma.supplierInvoice.aggregate({
        where: { organisationId, status: { not: SupplierInvoiceStatus.VOID } },
        _sum: { recognizedAmount: true, amountPaid: true, amountCredited: true },
      }),
      this.prisma.supplierInvoice.aggregate({
        where: { organisationId, status: SupplierInvoiceStatus.OVERDUE },
        _sum: { recognizedAmount: true, amountPaid: true, amountCredited: true },
      }),
      this.prisma.supplierInvoice.aggregate({
        where: { organisationId, status: SupplierInvoiceStatus.PARTIALLY_PAID },
        _sum: { recognizedAmount: true, amountPaid: true, amountCredited: true },
      }),
    ]);
    return { totals, overdue, partiallyPaid };
  }

  /** A single Purchase Order's own Accounts Payable aggregate — same shape as
   *  `getApBySupplier`'s per-row figures, scoped to one PO instead of grouped by
   *  supplier. Powers `AccountsPayableService.getPurchaseOrderFinancialSummary`. */
  async getApByPurchaseOrder(organisationId: string, purchaseOrderId: string) {
    await this.sweepOverdue(organisationId);
    const [aggregate, discrepancyCount] = await Promise.all([
      this.prisma.supplierInvoice.aggregate({
        where: { organisationId, purchaseOrderId, status: { not: SupplierInvoiceStatus.VOID } },
        _count: true,
        _sum: { total: true, recognizedAmount: true, amountPaid: true, amountCredited: true },
      }),
      this.prisma.supplierInvoice.count({
        where: { organisationId, purchaseOrderId, matchStatus: 'DISCREPANCY' },
      }),
    ]);
    return { aggregate, discrepancyCount };
  }

  /** Every still-payable supplier invoice's `dueDate`+outstanding balance — the raw
   *  material for `AccountsPayableService.getAgingReport()` (Sprint 13). Basis is
   *  `recognizedAmount`, never `total` — same rule as every other AP balance
   *  computation (an over-invoiced/discrepant amount is never "owed"). */
  async getOutstandingForAging(organisationId: string): Promise<AgingSupplierInvoiceRow[]> {
    await this.sweepOverdue(organisationId);
    const invoices = await this.prisma.supplierInvoice.findMany({
      where: { organisationId, status: { in: PAYABLE_SUPPLIER_INVOICE_STATUSES } },
      select: {
        id: true,
        invoiceNumber: true,
        dueDate: true,
        recognizedAmount: true,
        amountPaid: true,
        amountCredited: true,
        supplier: { select: SUPPLIER_SELECT },
      },
    });
    return invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      supplierId: invoice.supplier.id,
      supplierCode: invoice.supplier.supplierCode,
      supplierName: invoice.supplier.supplierName,
      dueDate: invoice.dueDate,
      amountOutstanding: roundCurrency(
        invoice.recognizedAmount - invoice.amountPaid - invoice.amountCredited,
      ),
    }));
  }

  /** Cheap counts for a supplier's recent-activity summary — no full row fetch. */
  async countBySupplier(organisationId: string, supplierId: string): Promise<number> {
    return this.prisma.supplierInvoice.count({
      where: { organisationId, supplierId, status: { not: SupplierInvoiceStatus.VOID } },
    });
  }

  /** Org-wide count of non-`VOID` `DISCREPANCY`-matchStatus invoices, for the AP
   *  Aging report's own discrepancy surfacing (Sprint 13, brief §13). */
  async countDiscrepancies(organisationId: string): Promise<number> {
    return this.prisma.supplierInvoice.count({
      where: {
        organisationId,
        status: { not: SupplierInvoiceStatus.VOID },
        matchStatus: 'DISCREPANCY',
      },
    });
  }

  /** Everything invoiced (by `recognizedAmount`) within `[from, to)`, for the
   *  "Invoiced This Period" card. */
  async sumInvoicedBetween(organisationId: string, from: Date, to: Date): Promise<number> {
    const result = await this.prisma.supplierInvoice.aggregate({
      where: {
        organisationId,
        status: { not: SupplierInvoiceStatus.VOID },
        invoiceDate: { gte: from, lt: to },
      },
      _sum: { recognizedAmount: true },
    });
    return result._sum.recognizedAmount ?? 0;
  }

  /** Cheap, tenant-scoped conditional `updateMany` transitioning any invoice past its
   *  `dueDate` and still `POSTED`/`PARTIALLY_PAID` to `OVERDUE` — mirrors
   *  `InvoiceRepository`'s own lazy sweep exactly (no cron/scheduler infrastructure
   *  in this codebase). */
  private async sweepOverdue(organisationId: string): Promise<void> {
    await this.prisma.supplierInvoice.updateMany({
      where: {
        organisationId,
        status: { in: [SupplierInvoiceStatus.POSTED, SupplierInvoiceStatus.PARTIALLY_PAID] },
        dueDate: { lt: new Date() },
      },
      data: { status: SupplierInvoiceStatus.OVERDUE },
    });
  }
}

function buildItems(
  items: SupplierInvoiceItemData[],
  taxAmount: number,
): {
  subtotal: number;
  total: number;
  items: {
    productId?: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    goodsReceiptItemId?: string;
    debitAccountId?: string;
  }[];
} {
  let subtotal = 0;
  const built = items.map((item) => {
    const lineTotal = roundCurrency(item.quantity * item.unitPrice);
    subtotal = roundCurrency(subtotal + lineTotal);
    return {
      productId: item.productId,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal,
      goodsReceiptItemId: item.goodsReceiptItemId,
      debitAccountId: item.debitAccountId,
    };
  });
  return { subtotal, total: roundCurrency(subtotal + taxAmount), items: built };
}

/** Rounds to 2 decimal places (currency) — same convention as every other file's own
 *  local `roundCurrency` helper in this codebase. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
