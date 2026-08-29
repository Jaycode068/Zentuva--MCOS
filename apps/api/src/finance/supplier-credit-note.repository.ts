import { Injectable } from '@nestjs/common';
import { CreditNoteStatus, Prisma, SupplierCreditNote } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_ACCOUNT_KEYS } from './accounting/chart-of-account-keys';
import { postSystemJournalEntry } from './accounting/journal-posting';
import { PAYABLE_SUPPLIER_INVOICE_STATUSES } from './supplier-invoice.repository';
import {
  deriveSupplierInvoiceStatusAfterApplication,
  deriveSupplierInvoiceStatusAfterReversal,
} from './supplier-payment.repository';

export interface ListSupplierCreditNotesParams {
  supplierId?: string;
  supplierInvoiceId?: string;
}

const SUPPLIER_SELECT = { id: true, supplierCode: true, supplierName: true };

export type SupplierCreditNoteWithRelations = SupplierCreditNote & {
  supplier: { id: string; supplierCode: string; supplierName: string };
  supplierInvoice: { id: string; invoiceNumber: string } | null;
};

const RELATIONS_INCLUDE = {
  supplier: { select: SUPPLIER_SELECT },
  supplierInvoice: { select: { id: true, invoiceNumber: true } },
};

/** Thrown when the credit amount would exceed the invoice's current outstanding
 *  balance (computed against `recognizedAmount`, never `total`). */
export class OverCreditError extends Error {}

/** Thrown when the target invoice isn't in a creditable status, doesn't belong to
 *  this organisation, or doesn't belong to the credit note's own supplier. */
export class CreditNoteInvoiceConflictError extends Error {}

/** Thrown when attempting to issue/void a credit note that isn't in the expected
 *  status for that transition. */
export class CreditNoteStateError extends Error {}

/** Thrown when the target credit note doesn't exist / doesn't belong to this
 *  organisation. */
export class CreditNoteNotFoundError extends Error {}

/**
 * Thin Prisma access for the `SupplierCreditNote` aggregate (Sprint 12,
 * docs/domains/finance.md "Accounts Payable") — direct structural mirror of
 * `CreditNoteRepository`, posting `DR Accounts Payable / CR Inventory` on `issue()`
 * (the mirror image of Sprint 8's own Goods Receipt posting) instead of the
 * customer side's `DR Sales Returns / CR AR`.
 */
@Injectable()
export class SupplierCreditNoteRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.SupplierCreditNoteCreateInput): Promise<SupplierCreditNoteWithRelations> {
    return this.prisma.supplierCreditNote.create({ data, include: RELATIONS_INCLUDE });
  }

  findById(organisationId: string, id: string): Promise<SupplierCreditNoteWithRelations | null> {
    return this.prisma.supplierCreditNote.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListSupplierCreditNotesParams = {},
  ): Promise<SupplierCreditNoteWithRelations[]> {
    return this.prisma.supplierCreditNote.findMany({
      where: {
        organisationId,
        ...(params.supplierId ? { supplierId: params.supplierId } : {}),
        ...(params.supplierInvoiceId ? { supplierInvoiceId: params.supplierInvoiceId } : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async existsByCode(creditNoteCode: string): Promise<boolean> {
    const count = await this.prisma.supplierCreditNote.count({ where: { creditNoteCode } });
    return count > 0;
  }

  async issue(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<{ creditNote: SupplierCreditNoteWithRelations; supplierInvoiceId: string | null }> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.supplierCreditNote.findFirst({ where: { id, organisationId } });
      if (!existing) {
        throw new CreditNoteNotFoundError('Supplier credit note not found');
      }
      if (existing.status !== CreditNoteStatus.DRAFT) {
        throw new CreditNoteStateError('Only a draft credit note can be issued');
      }

      if (existing.supplierInvoiceId) {
        const eligibleInvoice = await tx.supplierInvoice.findFirst({
          where: {
            id: existing.supplierInvoiceId,
            organisationId,
            supplierId: existing.supplierId,
            status: { in: PAYABLE_SUPPLIER_INVOICE_STATUSES },
          },
        });
        if (!eligibleInvoice) {
          throw new CreditNoteInvoiceConflictError(
            'Supplier invoice is not eligible to receive a credit note',
          );
        }

        const outstanding = roundCurrency(
          eligibleInvoice.recognizedAmount -
            eligibleInvoice.amountPaid -
            eligibleInvoice.amountCredited,
        );
        if (roundCurrency(existing.amount) > outstanding) {
          throw new OverCreditError(
            `Cannot credit ${existing.amount} — only ${outstanding} remains outstanding`,
          );
        }

        const newAmountCredited = roundCurrency(eligibleInvoice.amountCredited + existing.amount);
        const newStatus = deriveSupplierInvoiceStatusAfterApplication(
          eligibleInvoice.amountPaid,
          newAmountCredited,
          eligibleInvoice.recognizedAmount,
        );
        await tx.supplierInvoice.update({
          where: { id: existing.supplierInvoiceId },
          data: { amountCredited: newAmountCredited, status: newStatus, updatedById: actorUserId },
        });

        // DR Accounts Payable, CR Inventory (docs/domains/accounting.md) — the
        // mirror image of Sprint 8's Goods Receipt posting — atomic with the credit
        // note+invoice writes above.
        await postSystemJournalEntry(tx, {
          organisationId,
          date: existing.creditNoteDate,
          description: `Supplier credit note ${existing.creditNoteCode} issued against ${eligibleInvoice.invoiceNumber}`,
          reference: existing.creditNoteCode,
          sourceType: 'SUPPLIER_CREDIT_NOTE',
          sourceId: existing.id,
          actorUserId,
          lines: [
            { systemKey: SYSTEM_ACCOUNT_KEYS.AP, debit: existing.amount },
            { systemKey: SYSTEM_ACCOUNT_KEYS.INVENTORY, credit: existing.amount },
          ],
        });
      }

      const creditNote = await tx.supplierCreditNote.update({
        where: { id },
        data: { status: CreditNoteStatus.ISSUED, updatedById: actorUserId },
        include: RELATIONS_INCLUDE,
      });

      return { creditNote, supplierInvoiceId: existing.supplierInvoiceId };
    });
  }

  /** Reverses an issued credit note's effect on its invoice, then marks it `VOID`. A
   *  corrective action, not a delete. */
  async void(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<{
    creditNote: SupplierCreditNoteWithRelations;
    supplierInvoiceId: string | null;
  } | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.supplierCreditNote.findFirst({ where: { id, organisationId } });
      if (!existing) {
        return null;
      }
      if (existing.status === CreditNoteStatus.VOID) {
        throw new CreditNoteStateError('This credit note has already been voided');
      }

      if (existing.status === CreditNoteStatus.ISSUED && existing.supplierInvoiceId) {
        const invoice = await tx.supplierInvoice.findUniqueOrThrow({
          where: { id: existing.supplierInvoiceId },
        });
        const newAmountCredited = roundCurrency(
          Math.max(0, invoice.amountCredited - existing.amount),
        );
        const newStatus = deriveSupplierInvoiceStatusAfterReversal(
          invoice.amountPaid,
          newAmountCredited,
          invoice.recognizedAmount,
        );
        await tx.supplierInvoice.update({
          where: { id: existing.supplierInvoiceId },
          data: { amountCredited: newAmountCredited, status: newStatus, updatedById: actorUserId },
        });
      }

      const creditNote = await tx.supplierCreditNote.update({
        where: { id },
        data: { status: CreditNoteStatus.VOID, updatedById: actorUserId },
        include: RELATIONS_INCLUDE,
      });

      return { creditNote, supplierInvoiceId: existing.supplierInvoiceId };
    });
  }
}

/** Rounds to 2 decimal places for currency figures — same convention used throughout
 *  this domain. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
