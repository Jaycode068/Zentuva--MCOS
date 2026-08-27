import { Injectable } from '@nestjs/common';
import {
  CreditNoteStatus,
  CustomerReturn,
  CustomerReturnItem,
  CustomerReturnReason,
  CustomerReturnStatus,
  InventoryTransactionType,
  JournalEntryStatus,
  Prisma,
} from '@prisma/client';

import { SYSTEM_ACCOUNT_KEYS } from '../finance/accounting/chart-of-account-keys';
import { postSystemJournalEntry } from '../finance/accounting/journal-posting';
import { issueCreditNoteWithinTransaction } from '../finance/credit-note.repository';
import { PAYABLE_INVOICE_STATUSES } from '../finance/invoice.repository';
import { PrismaService } from '../prisma/prisma.service';

const PRODUCT_SELECT = { id: true, code: true, name: true, unit: true };

export type CustomerReturnWithRelations = CustomerReturn & {
  customer: { id: string; customerCode: string; customerName: string };
  outlet: { id: string; outletCode: string; name: string } | null;
  salesOrder: { id: string; orderCode: string };
  location: { id: string; name: string };
  items: (CustomerReturnItem & {
    product: { id: string; code: string; name: string; unit: string };
  })[];
};

const RELATIONS_INCLUDE = {
  customer: { select: { id: true, customerCode: true, customerName: true } },
  outlet: { select: { id: true, outletCode: true, name: true } },
  salesOrder: { select: { id: true, orderCode: true } },
  location: { select: { id: true, name: true } },
  items: {
    include: { product: { select: PRODUCT_SELECT } },
    orderBy: { createdAt: 'asc' as const },
  },
};

/** Minimal Journal Entry summary — same shape as every other domain's own
 *  `JournalEntrySummary` (e.g. `SalesFulfilmentRepository`). */
export interface JournalEntrySummary {
  id: string;
  journalNumber: string;
  status: JournalEntryStatus;
  totalAmount: number;
}

/** Minimal Credit Note summary surfaced on the return response so Finance traceability
 *  (brief §34) doesn't need a second round trip. */
export interface CreditNoteSummary {
  id: string;
  creditNoteCode: string;
  amount: number;
  status: CreditNoteStatus;
}

export interface ListCustomerReturnsParams {
  status?: CustomerReturnStatus;
  customerId?: string;
  salesOrderId?: string;
  search?: string;
}

export interface CreateCustomerReturnItemData {
  salesFulfilmentItemId: string;
  quantityReturned: number;
}

export interface CreateCustomerReturnData {
  organisationId: string;
  returnCode: string;
  customerId: string;
  outletId?: string;
  salesOrderId: string;
  locationId: string;
  returnDate: Date;
  reason: CustomerReturnReason;
  reasonNotes?: string;
  notes?: string;
  createdById: string;
  idempotencyKey?: string;
  items: CreateCustomerReturnItemData[];
}

export interface CreateCustomerReturnResult {
  customerReturn: CustomerReturnWithRelations;
  wasCreated: boolean;
}

export interface ReceiveCustomerReturnItemData {
  customerReturnItemId: string;
  quantityResalable: number;
  quantityDamaged: number;
  quantityQuarantine: number;
  quantityScrap: number;
  /** `undefined` defaults to that item's own `quantityReturned` — see
   *  `CustomerReturnItem.quantityCredited` schema comment (brief §36). */
  quantityCredited?: number;
}

export interface ReceiveCustomerReturnData {
  organisationId: string;
  customerReturnId: string;
  receivedById: string;
  idempotencyKey?: string;
  items: ReceiveCustomerReturnItemData[];
}

export interface ReceiveCustomerReturnResult {
  customerReturn: CustomerReturnWithRelations;
  journalEntry: JournalEntrySummary | null;
  creditNote: CreditNoteSummary | null;
  wasCreated: boolean;
}

/** Thrown when a return's items claim more than what remains un-returned on the
 *  referenced `SalesFulfilmentItem` (`quantityFulfilled - quantityReturned`) — either a
 *  single over-large request or several concurrent requests together exceeding it.
 *  Re-checked authoritatively inside the transaction, never trusted from a service-level
 *  pre-check alone (same convention as `InsufficientStockError`). */
export class OverReturnError extends Error {}

/** Thrown when the referenced `SalesFulfilmentItem` doesn't belong to the given Sales
 *  Order/organisation. */
export class InvalidFulfilmentReferenceError extends Error {}

/** Thrown when `receive()` is attempted on a return that isn't `REQUESTED` (already
 *  received, or cancelled) — re-checked inside the transaction to close the race
 *  against a concurrent receive/cancel, same role as `SalesFulfilmentConflictError`. */
export class CustomerReturnConflictError extends Error {}

/** Thrown when a `receive()` item's four disposition quantities don't sum to that
 *  item's own `quantityReturned` (brief §7/§8 — every returned unit must be accounted
 *  for by exactly one disposition). */
export class DispositionMismatchError extends Error {}

/** Thrown when `receive()` needs to issue a Credit Note (a non-zero credited amount)
 *  but no eligible `Invoice` exists for the return's Sales Order — the whole
 *  transaction aborts rather than silently skipping the commercial settlement (brief
 *  §10/§27: never inventory-without-accounting or accounting-without-inventory). */
export class NoEligibleInvoiceError extends Error {}

/**
 * Thin Prisma access for the `CustomerReturn` aggregate (Sprint 11,
 * docs/domains/sales.md "Customer Returns"). Two atomic writes:
 *
 * `create()` is the *request* step — no inventory/accounting effect (brief §32).
 * Still runs inside its own `$transaction` because it authoritatively re-reads each
 * referenced `SalesFulfilmentItem` (never trusts a service-level pre-check) and
 * increments its `quantityReturned` counter, closing the race between two concurrent
 * return requests that would otherwise together over-claim the same fulfilled
 * quantity.
 *
 * `receive()` is the one atomic physical+financial event (brief §27): disposition
 * validation, weighted-average restock of the resalable portion only (brief §8),
 * `InventoryTransaction` (`RETURN`), a conditional COGS-reversal Journal Entry (`DR
 * Finished Goods Inventory / CR Cost of Goods Sold`, zero-skipped like Sprint 10's own
 * fulfilment posting), and a conditional Credit Note (via
 * `issueCreditNoteWithinTransaction`, the same engine `CreditNoteRepository.issue()`
 * uses standalone — see docs/domains/finance.md) — all sharing this one transaction,
 * so everything rolls back together on any failure (closed period, missing system
 * account, no eligible invoice, ...).
 *
 * Writing directly into `SalesFulfilmentItem`/`InventoryStock`/`InventoryTransaction`/
 * `CreditNote`/`Invoice` here is the same deliberate, narrow exception to ADR-002's
 * domain-ownership convention that `SalesFulfilmentRepository`/`GoodsReceiptRepository`
 * already establish, made for atomicity.
 */
@Injectable()
export class CustomerReturnRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<CustomerReturnWithRelations | null> {
    return this.prisma.customerReturn.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListCustomerReturnsParams = {},
  ): Promise<CustomerReturnWithRelations[]> {
    return this.prisma.customerReturn.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.customerId ? { customerId: params.customerId } : {}),
        ...(params.salesOrderId ? { salesOrderId: params.salesOrderId } : {}),
        ...(params.search
          ? {
              OR: [
                { returnCode: { contains: params.search, mode: 'insensitive' } },
                { customer: { customerName: { contains: params.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Globally unique (see `CustomerReturn.returnCode` schema comment) — same
   *  convention as `SalesOrder.orderCode`. */
  async existsByCode(returnCode: string): Promise<boolean> {
    const count = await this.prisma.customerReturn.count({ where: { returnCode } });
    return count > 0;
  }

  /** Mirrors `DeliveryRepository.setPhoto`'s exact shape. */
  async setPhoto(
    organisationId: string,
    id: string,
    photoUrl: string,
    photoKey: string,
  ): Promise<CustomerReturnWithRelations | null> {
    const result = await this.prisma.customerReturn.updateMany({
      where: { id, organisationId },
      data: { photoUrl, photoKey },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.customerReturn.findUniqueOrThrow({
      where: { id },
      include: RELATIONS_INCLUDE,
    });
  }

  private async findJournalEntry(
    tx: Prisma.TransactionClient,
    organisationId: string,
    customerReturnId: string,
  ): Promise<JournalEntrySummary | null> {
    const journalEntry = await tx.journalEntry.findUnique({
      where: {
        organisationId_sourceType_sourceId: {
          organisationId,
          sourceType: 'CUSTOMER_RETURN',
          sourceId: customerReturnId,
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

  private async findCreditNote(
    tx: Prisma.TransactionClient,
    organisationId: string,
    customerReturnId: string,
  ): Promise<CreditNoteSummary | null> {
    const creditNote = await tx.creditNote.findFirst({
      where: { organisationId, sourceType: 'CUSTOMER_RETURN', sourceId: customerReturnId },
    });
    if (!creditNote) {
      return null;
    }
    return {
      id: creditNote.id,
      creditNoteCode: creditNote.creditNoteCode,
      amount: creditNote.amount,
      status: creditNote.status,
    };
  }

  /** Added Sprint 11 — pre-transaction idempotency lookup, same role as
   *  `SalesFulfilmentRepository.findByIdempotencyKey`: `CustomerReturnService.request()`
   *  checks this *before* any business-rule pre-check (Sprint 9→10 lesson). */
  async findByIdempotencyKey(
    organisationId: string,
    salesOrderId: string,
    idempotencyKey: string,
  ): Promise<CustomerReturnWithRelations | null> {
    const existing = await this.prisma.customerReturn.findUnique({
      where: { salesOrderId_idempotencyKey: { salesOrderId, idempotencyKey } },
      include: RELATIONS_INCLUDE,
    });
    if (!existing || existing.organisationId !== organisationId) {
      return null;
    }
    return existing;
  }

  async create(data: CreateCustomerReturnData): Promise<CreateCustomerReturnResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.customerReturn.findUnique({
          where: {
            salesOrderId_idempotencyKey: {
              salesOrderId: data.salesOrderId,
              idempotencyKey: data.idempotencyKey,
            },
          },
          include: RELATIONS_INCLUDE,
        });
        if (existing) {
          return { customerReturn: existing, wasCreated: false };
        }
      }

      const fulfilmentItemIds = data.items.map((item) => item.salesFulfilmentItemId);
      const fulfilmentItems = await tx.salesFulfilmentItem.findMany({
        where: {
          id: { in: fulfilmentItemIds },
          salesFulfilment: { organisationId: data.organisationId, salesOrderId: data.salesOrderId },
        },
        include: { salesOrderItem: { select: { unitPrice: true } } },
      });
      const fulfilmentItemById = new Map(fulfilmentItems.map((row) => [row.id, row]));

      for (const item of data.items) {
        const fulfilmentItem = fulfilmentItemById.get(item.salesFulfilmentItemId);
        if (!fulfilmentItem) {
          throw new InvalidFulfilmentReferenceError(
            'One or more items do not belong to this sales order',
          );
        }
        const remaining = roundQuantity(
          fulfilmentItem.quantityFulfilled - fulfilmentItem.quantityReturned,
        );
        if (roundQuantity(item.quantityReturned) > remaining) {
          throw new OverReturnError(
            `Cannot return ${item.quantityReturned} — only ${remaining} of this fulfilment line remains eligible for return`,
          );
        }
      }

      const customerReturn = await tx.customerReturn.create({
        data: {
          organisationId: data.organisationId,
          returnCode: data.returnCode,
          customerId: data.customerId,
          outletId: data.outletId,
          salesOrderId: data.salesOrderId,
          locationId: data.locationId,
          returnDate: data.returnDate,
          reason: data.reason,
          reasonNotes: data.reasonNotes,
          notes: data.notes,
          createdById: data.createdById,
          idempotencyKey: data.idempotencyKey,
          items: {
            create: data.items.map((item) => {
              const fulfilmentItem = fulfilmentItemById.get(item.salesFulfilmentItemId)!;
              return {
                productId: fulfilmentItem.productId,
                salesFulfilmentItemId: item.salesFulfilmentItemId,
                quantityReturned: item.quantityReturned,
                unitCost: fulfilmentItem.unitCost,
                unitPrice: fulfilmentItem.salesOrderItem.unitPrice,
              };
            }),
          },
        },
        include: RELATIONS_INCLUDE,
      });

      for (const item of data.items) {
        await tx.salesFulfilmentItem.update({
          where: { id: item.salesFulfilmentItemId },
          data: { quantityReturned: { increment: item.quantityReturned } },
        });
      }

      return { customerReturn, wasCreated: true };
    });
  }

  /** `POST /:id/cancel` (`REQUESTED` only) — releases the reserved
   *  `SalesFulfilmentItem.quantityReturned` so the returned quantity becomes eligible
   *  for a fresh return request again. Returns `null` if the return doesn't exist or
   *  isn't `REQUESTED` at the moment the transaction runs (re-checked to close the
   *  race against a concurrent receive). */
  async cancel(organisationId: string, id: string): Promise<CustomerReturnWithRelations | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.customerReturn.findFirst({
        where: { id, organisationId },
        include: { items: true },
      });
      if (!existing) {
        return null;
      }
      if (existing.status !== CustomerReturnStatus.REQUESTED) {
        throw new CustomerReturnConflictError('Only a requested return can be cancelled');
      }

      for (const item of existing.items) {
        await tx.salesFulfilmentItem.update({
          where: { id: item.salesFulfilmentItemId },
          data: { quantityReturned: { decrement: item.quantityReturned } },
        });
      }

      return tx.customerReturn.update({
        where: { id },
        data: { status: CustomerReturnStatus.CANCELLED },
        include: RELATIONS_INCLUDE,
      });
    });
  }

  async receive(data: ReceiveCustomerReturnData): Promise<ReceiveCustomerReturnResult> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.customerReturn.findFirst({
        where: { id: data.customerReturnId, organisationId: data.organisationId },
        include: RELATIONS_INCLUDE,
      });
      if (!existing) {
        throw new CustomerReturnConflictError('Customer return not found');
      }

      if (data.idempotencyKey && existing.receivedIdempotencyKey === data.idempotencyKey) {
        const journalEntry = await this.findJournalEntry(tx, data.organisationId, existing.id);
        const creditNote = await this.findCreditNote(tx, data.organisationId, existing.id);
        return { customerReturn: existing, journalEntry, creditNote, wasCreated: false };
      }

      if (existing.status !== CustomerReturnStatus.REQUESTED) {
        throw new CustomerReturnConflictError('This return is not eligible to be received');
      }

      const itemsById = new Map(existing.items.map((item) => [item.id, item]));
      let totalCogsReversal = 0;
      let totalCreditAmount = 0;
      const resolvedItems: {
        item: CustomerReturnWithRelations['items'][number];
        input: ReceiveCustomerReturnItemData;
        quantityCredited: number;
      }[] = [];

      for (const input of data.items) {
        const item = itemsById.get(input.customerReturnItemId);
        if (!item) {
          throw new DispositionMismatchError('One or more items do not belong to this return');
        }
        const dispositionSum = roundQuantity(
          input.quantityResalable +
            input.quantityDamaged +
            input.quantityQuarantine +
            input.quantityScrap,
        );
        if (dispositionSum !== roundQuantity(item.quantityReturned)) {
          throw new DispositionMismatchError(
            `Disposition quantities (${dispositionSum}) must sum to the returned quantity (${item.quantityReturned}) for "${item.productId}"`,
          );
        }
        const quantityCredited = roundQuantity(input.quantityCredited ?? item.quantityReturned);
        if (quantityCredited > roundQuantity(item.quantityReturned)) {
          throw new DispositionMismatchError(
            `Credited quantity (${quantityCredited}) cannot exceed the returned quantity (${item.quantityReturned})`,
          );
        }
        resolvedItems.push({ item, input, quantityCredited });
        totalCogsReversal = roundCurrency(
          totalCogsReversal + roundCurrency(input.quantityResalable * item.unitCost),
        );
        totalCreditAmount = roundCurrency(
          totalCreditAmount + roundCurrency(quantityCredited * item.unitPrice),
        );
      }

      for (const { item, input, quantityCredited } of resolvedItems) {
        await tx.customerReturnItem.update({
          where: { id: item.id },
          data: {
            quantityResalable: input.quantityResalable,
            quantityDamaged: input.quantityDamaged,
            quantityQuarantine: input.quantityQuarantine,
            quantityScrap: input.quantityScrap,
            quantityCredited,
          },
        });

        // Only the resalable portion ever becomes usable stock (brief §8) — restocked
        // at the *specific* original fulfilment cost (brief §7), a weighted-average
        // upsert identical in shape to `GoodsReceiptRepository.receive()`'s own.
        if (input.quantityResalable > 0) {
          const existingStock = await tx.inventoryStock.findUnique({
            where: {
              organisationId_productId_locationId: {
                organisationId: data.organisationId,
                productId: item.productId,
                locationId: existing.locationId,
              },
            },
          });
          const priorQuantity = existingStock?.quantityOnHand ?? 0;
          const priorCost = existingStock?.averageUnitCost ?? 0;
          const newQuantity = priorQuantity + input.quantityResalable;
          const newAverageCost =
            newQuantity > 0
              ? roundCurrency(
                  (priorQuantity * priorCost + input.quantityResalable * item.unitCost) /
                    newQuantity,
                )
              : 0;
          await tx.inventoryStock.upsert({
            where: {
              organisationId_productId_locationId: {
                organisationId: data.organisationId,
                productId: item.productId,
                locationId: existing.locationId,
              },
            },
            create: {
              organisationId: data.organisationId,
              productId: item.productId,
              locationId: existing.locationId,
              quantityOnHand: input.quantityResalable,
              averageUnitCost: newAverageCost,
            },
            update: { quantityOnHand: newQuantity, averageUnitCost: newAverageCost },
          });
          await tx.inventoryTransaction.create({
            data: {
              organisationId: data.organisationId,
              productId: item.productId,
              locationId: existing.locationId,
              transactionType: InventoryTransactionType.RETURN,
              quantity: input.quantityResalable,
              referenceType: 'CustomerReturn',
              referenceId: existing.id,
            },
          });
        }
      }

      const updated = await tx.customerReturn.update({
        where: { id: existing.id },
        data: {
          status: CustomerReturnStatus.RECEIVED,
          receivedAt: new Date(),
          receivedById: data.receivedById,
          receivedIdempotencyKey: data.idempotencyKey,
        },
        include: RELATIONS_INCLUDE,
      });

      // COGS reversal (brief §9) — the mirror of Sprint 10's own Sales Fulfilment
      // posting: `DR Finished Goods Inventory / CR Cost of Goods Sold`. Zero-skipped
      // (no journal at all, not a zero-amount one) when nothing resalable was
      // returned — same convention as every other domain's own zero-cost policy.
      let journalEntry: JournalEntrySummary | null = null;
      if (totalCogsReversal > 0) {
        const posted = await postSystemJournalEntry(tx, {
          organisationId: data.organisationId,
          date: new Date(),
          description: `Customer return ${existing.returnCode} — Sales Order ${existing.salesOrder.orderCode}`,
          reference: existing.returnCode,
          sourceType: 'CUSTOMER_RETURN',
          sourceId: existing.id,
          actorUserId: data.receivedById,
          lines: [
            { systemKey: SYSTEM_ACCOUNT_KEYS.FINISHED_GOODS_INVENTORY, debit: totalCogsReversal },
            { systemKey: SYSTEM_ACCOUNT_KEYS.COGS, credit: totalCogsReversal },
          ],
        });
        journalEntry = {
          id: posted.journalEntry.id,
          journalNumber: posted.journalEntry.journalNumber,
          status: posted.journalEntry.status,
          totalAmount: totalCogsReversal,
        };
      }

      // Commercial settlement (brief §10/§36) — reuses the existing Credit Note engine
      // (Sprint 6/7) rather than a second, competing one. Deliberately separate from
      // the COGS reversal above: the credited amount is never assumed equal to the
      // resalable value (brief §36).
      let creditNote: CreditNoteSummary | null = null;
      if (totalCreditAmount > 0) {
        const eligibleInvoice = await tx.invoice.findFirst({
          where: {
            organisationId: data.organisationId,
            salesOrderId: existing.salesOrderId,
            status: { in: PAYABLE_INVOICE_STATUSES },
          },
          orderBy: { createdAt: 'asc' },
        });
        if (!eligibleInvoice) {
          throw new NoEligibleInvoiceError(
            'Cannot settle this return — no eligible invoice was found for its sales order',
          );
        }

        const draft = await tx.creditNote.create({
          data: {
            organisationId: data.organisationId,
            creditNoteCode: await this.generateUniqueCreditNoteCode(tx),
            customerId: existing.customerId,
            invoiceId: eligibleInvoice.id,
            reason: `Customer return ${existing.returnCode}`,
            amount: totalCreditAmount,
            currency: eligibleInvoice.currency,
            creditNoteDate: new Date(),
            sourceType: 'CUSTOMER_RETURN',
            sourceId: existing.id,
            createdById: data.receivedById,
          },
        });
        const issued = await issueCreditNoteWithinTransaction(
          tx,
          data.organisationId,
          draft.id,
          data.receivedById,
        );
        creditNote = {
          id: issued.creditNote.id,
          creditNoteCode: issued.creditNote.creditNoteCode,
          amount: issued.creditNote.amount,
          status: issued.creditNote.status,
        };
      }

      return { customerReturn: updated, journalEntry, creditNote, wasCreated: true };
    });
  }

  /** `CN-000001`, `CN-000002`, ... — same collision-avoidance loop as
   *  `CreditNoteService`'s own generator, duplicated here (not imported) because it
   *  must run *inside* this transaction, not as a separate service call before it. */
  private async generateUniqueCreditNoteCode(tx: Prisma.TransactionClient): Promise<string> {
    let sequence = 1;
    let candidate = `CN-${String(sequence).padStart(6, '0')}`;
    while (await tx.creditNote.count({ where: { creditNoteCode: candidate } })) {
      sequence += 1;
      candidate = `CN-${String(sequence).padStart(6, '0')}`;
    }
    return candidate;
  }
}

/** Rounds to 6 decimal places purely to clear floating-point noise — same convention
 *  used throughout Inventory/Production/Sales. */
function roundQuantity(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Rounds to 2 decimal places (currency) — same convention as every other file's own
 *  local `roundCurrency` helper in this codebase. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
