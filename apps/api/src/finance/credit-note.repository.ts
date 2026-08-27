import { Injectable } from '@nestjs/common';
import { CreditNote, CreditNoteStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_ACCOUNT_KEYS } from './accounting/chart-of-account-keys';
import { postSystemJournalEntry } from './accounting/journal-posting';
import { PAYABLE_INVOICE_STATUSES } from './invoice.repository';
import {
  deriveInvoiceStatusAfterApplication,
  deriveInvoiceStatusAfterReversal,
} from './payment.repository';

export interface ListCreditNotesParams {
  customerId?: string;
  invoiceId?: string;
}

const CUSTOMER_SELECT = { id: true, customerCode: true, customerName: true };

export type CreditNoteWithRelations = CreditNote & {
  customer: { id: string; customerCode: string; customerName: string };
  invoice: { id: string; invoiceCode: string } | null;
};

const RELATIONS_INCLUDE = {
  customer: { select: CUSTOMER_SELECT },
  invoice: { select: { id: true, invoiceCode: true } },
};

/** Thrown when the credit amount would exceed the invoice's current outstanding
 *  balance. */
export class OverCreditError extends Error {}

/** Thrown when the target invoice isn't in a creditable status, doesn't belong to this
 *  organisation, or doesn't belong to the credit note's own customer. */
export class CreditNoteInvoiceConflictError extends Error {}

/** Thrown when attempting to issue/void a credit note that isn't in the expected
 *  status for that transition. */
export class CreditNoteStateError extends Error {}

/** Thrown when the target credit note doesn't exist / doesn't belong to this
 *  organisation — re-checked inside the transaction, same convention as every other
 *  domain's "closes the race" repository error subclasses. */
export class CreditNoteNotFoundError extends Error {}

/**
 * Thin Prisma access for the `CreditNote` aggregate (Sprint 6, docs/domains/finance.md).
 * Never touches `SalesOrder`/`Dispatch`/`Delivery`/`InventoryStock` — the physical return
 * itself belongs to those domains; this file only records the financial consequence.
 *
 * `create()` is a plain create (no `$transaction` needed — a DRAFT credit note has no
 * side effects yet, mirrors `InvoiceRepository.create()`). `issue()` is where the atomic
 * transaction happens: eligibility guard -> over-credit guard -> increment
 * `Invoice.amountCredited` -> recompute `Invoice.status` -> write `CreditNote.status =
 * ISSUED` — mirrors `PaymentRepository.create()`'s exact shape.
 */
@Injectable()
export class CreditNoteRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.CreditNoteCreateInput): Promise<CreditNoteWithRelations> {
    return this.prisma.creditNote.create({ data, include: RELATIONS_INCLUDE });
  }

  findById(organisationId: string, id: string): Promise<CreditNoteWithRelations | null> {
    return this.prisma.creditNote.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListCreditNotesParams = {},
  ): Promise<CreditNoteWithRelations[]> {
    return this.prisma.creditNote.findMany({
      where: {
        organisationId,
        ...(params.customerId ? { customerId: params.customerId } : {}),
        ...(params.invoiceId ? { invoiceId: params.invoiceId } : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Globally unique (see `CreditNote.creditNoteCode` schema comment) — checked without
   *  an `organisationId` filter, same convention as every other auto-numbered code. */
  async existsByCode(creditNoteCode: string): Promise<boolean> {
    const count = await this.prisma.creditNote.count({ where: { creditNoteCode } });
    return count > 0;
  }

  async issue(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<{ creditNote: CreditNoteWithRelations; invoiceId: string | null }> {
    return this.prisma.$transaction((tx) =>
      issueCreditNoteWithinTransaction(tx, organisationId, id, actorUserId),
    );
  }

  /** Reverses an issued credit note's effect on its invoice, then marks it `VOID`. A
   *  corrective action, not a delete. */
  async void(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<{ creditNote: CreditNoteWithRelations; invoiceId: string | null } | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.creditNote.findFirst({ where: { id, organisationId } });
      if (!existing) {
        return null;
      }
      if (existing.status === CreditNoteStatus.VOID) {
        throw new CreditNoteStateError('This credit note has already been voided');
      }

      if (existing.status === CreditNoteStatus.ISSUED && existing.invoiceId) {
        const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: existing.invoiceId } });
        const newAmountCredited = roundCurrency(
          Math.max(0, invoice.amountCredited - existing.amount),
        );
        const newStatus = deriveInvoiceStatusAfterReversal(
          invoice.amountPaid,
          newAmountCredited,
          invoice.total,
        );
        await tx.invoice.update({
          where: { id: existing.invoiceId },
          data: { amountCredited: newAmountCredited, status: newStatus, updatedById: actorUserId },
        });
      }

      const creditNote = await tx.creditNote.update({
        where: { id },
        data: { status: CreditNoteStatus.VOID, updatedById: actorUserId },
        include: RELATIONS_INCLUDE,
      });

      return { creditNote, invoiceId: existing.invoiceId };
    });
  }
}

/** Rounds to 2 decimal places for currency figures — same convention used throughout
 *  this domain. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The atomic body of `CreditNoteRepository.issue()`, extracted (Sprint 11) into a
 * plain, DI-free function taking an already-open `Prisma.TransactionClient` — the same
 * shape as `journal-posting.ts`'s `postSystemJournalEntry`. `CreditNoteRepository.issue()`
 * is now a one-line wrapper opening its own `$transaction` around this; a caller that
 * already owns an outer transaction (e.g. `CustomerReturnRepository.receive()`) can
 * call this directly instead, so a Return's inventory movement, COGS reversal, and
 * Credit Note issuance stay one atomic unit — no second, competing credit-note engine.
 * Behaviour is byte-for-byte identical to the pre-Sprint-11 `issue()` body.
 */
export async function issueCreditNoteWithinTransaction(
  tx: Prisma.TransactionClient,
  organisationId: string,
  id: string,
  actorUserId: string,
): Promise<{ creditNote: CreditNoteWithRelations; invoiceId: string | null }> {
  const existing = await tx.creditNote.findFirst({ where: { id, organisationId } });
  if (!existing) {
    throw new CreditNoteNotFoundError('Credit note not found');
  }
  if (existing.status !== CreditNoteStatus.DRAFT) {
    throw new CreditNoteStateError('Only a draft credit note can be issued');
  }

  if (existing.invoiceId) {
    const eligibleInvoice = await tx.invoice.findFirst({
      where: {
        id: existing.invoiceId,
        organisationId,
        customerId: existing.customerId,
        status: { in: PAYABLE_INVOICE_STATUSES },
      },
    });
    if (!eligibleInvoice) {
      throw new CreditNoteInvoiceConflictError('Invoice is not eligible to receive a credit note');
    }

    const outstanding = roundCurrency(
      eligibleInvoice.total - eligibleInvoice.amountPaid - eligibleInvoice.amountCredited,
    );
    if (roundCurrency(existing.amount) > outstanding) {
      throw new OverCreditError(
        `Cannot credit ${existing.amount} — only ${outstanding} remains outstanding`,
      );
    }

    const newAmountCredited = roundCurrency(eligibleInvoice.amountCredited + existing.amount);
    const newStatus = deriveInvoiceStatusAfterApplication(
      eligibleInvoice.amountPaid,
      newAmountCredited,
      eligibleInvoice.total,
    );
    await tx.invoice.update({
      where: { id: existing.invoiceId },
      data: { amountCredited: newAmountCredited, status: newStatus, updatedById: actorUserId },
    });

    // DR Sales Returns/Adjustment, CR Accounts Receivable (docs/domains/
    // accounting.md) — atomic with the credit-note+invoice writes above.
    await postSystemJournalEntry(tx, {
      organisationId,
      date: existing.creditNoteDate,
      description: `Credit note ${existing.creditNoteCode} issued against ${eligibleInvoice.invoiceCode}`,
      reference: existing.creditNoteCode,
      sourceType: 'CREDIT_NOTE',
      sourceId: existing.id,
      actorUserId,
      lines: [
        { systemKey: SYSTEM_ACCOUNT_KEYS.SALES_RETURNS, debit: existing.amount },
        { systemKey: SYSTEM_ACCOUNT_KEYS.AR, credit: existing.amount },
      ],
    });
  }

  const creditNote = await tx.creditNote.update({
    where: { id },
    data: { status: CreditNoteStatus.ISSUED, updatedById: actorUserId },
    include: RELATIONS_INCLUDE,
  });

  return { creditNote, invoiceId: existing.invoiceId };
}
