import { Injectable } from '@nestjs/common';
import {
  PaymentMethod,
  PaymentStatus,
  SupplierInvoiceStatus,
  SupplierPayment,
} from '@prisma/client';

import { SYSTEM_ACCOUNT_KEYS } from './accounting/chart-of-account-keys';
import { postSystemJournalEntry } from './accounting/journal-posting';
import { PAYABLE_SUPPLIER_INVOICE_STATUSES } from './supplier-invoice.repository';
import { PrismaService } from '../prisma/prisma.service';

export interface ListSupplierPaymentsParams {
  supplierId?: string;
  supplierInvoiceId?: string;
}

const SUPPLIER_SELECT = { id: true, supplierCode: true, supplierName: true };

export type SupplierPaymentWithRelations = SupplierPayment & {
  supplier: { id: string; supplierCode: string; supplierName: string };
  allocations: { id: string; supplierInvoiceId: string; amount: number }[];
};

const RELATIONS_INCLUDE = {
  supplier: { select: SUPPLIER_SELECT },
  allocations: true,
};

export interface CreateSupplierPaymentData {
  organisationId: string;
  supplierId: string;
  supplierInvoiceId: string;
  amount: number;
  method: PaymentMethod;
  paymentDate: Date;
  reference?: string;
  notes?: string;
  /** Added Sprint 14 (docs/domains/cash-management.md) — which specific
   *  `CashAccount` money was paid from. Optional: when omitted, posting falls back
   *  to the pre-Sprint-14 `method`-based generic `CASH`/`BANK` system account. */
  cashAccountId?: string;
  idempotencyKey?: string;
  createdById: string;
}

/** Thrown when `cashAccountId` doesn't resolve to a `CashAccount` belonging to this
 *  organisation. */
export class InvalidCashAccountError extends Error {}

export interface CreateSupplierPaymentResult {
  supplierPayment: SupplierPaymentWithRelations;
  supplierInvoice: {
    id: string;
    status: SupplierInvoiceStatus;
    amountPaid: number;
    amountCredited: number;
    recognizedAmount: number;
  };
  /** `true` only when THIS call created a new row; `false` when an existing
   *  `idempotencyKey` match was returned instead. */
  wasCreated: boolean;
}

/** Thrown when the recorded amount would exceed the invoice's current outstanding
 *  balance — computed against `recognizedAmount`, never `total` (Sprint 12's central
 *  safety guarantee: an over-invoiced/discrepancy amount can never be paid). */
export class OverPaymentError extends Error {}

/** Thrown when the target invoice isn't in a payable status, doesn't belong to this
 *  organisation, or doesn't belong to the payment's own supplier — re-checked here to
 *  close the race against a concurrent status change. */
export class PaymentInvoiceConflictError extends Error {}

/** Thrown when attempting to void a payment that has already been voided. */
export class PaymentAlreadyVoidedError extends Error {}

/**
 * Thin Prisma access for the `SupplierPayment` aggregate (Sprint 12,
 * docs/domains/finance.md "Accounts Payable") — direct structural mirror of
 * `PaymentRepository`. `create()`: idempotency check-then-return, an eligibility
 * guard re-reading the target `SupplierInvoice`'s status inside the transaction, an
 * over-payment guard against `recognizedAmount` (never `total`), the
 * `SupplierPayment`+`SupplierPaymentAllocation` create, the invoice's
 * `amountPaid` increment and status recomputation, and the `DR AP / CR Cash-or-Bank`
 * posting — all rolled back together on any failure.
 */
@Injectable()
export class SupplierPaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<SupplierPaymentWithRelations | null> {
    return this.prisma.supplierPayment.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListSupplierPaymentsParams = {},
  ): Promise<SupplierPaymentWithRelations[]> {
    return this.prisma.supplierPayment.findMany({
      where: {
        organisationId,
        ...(params.supplierId ? { supplierId: params.supplierId } : {}),
        ...(params.supplierInvoiceId
          ? { allocations: { some: { supplierInvoiceId: params.supplierInvoiceId } } }
          : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Cheap count for a supplier's recent-activity summary — no full row fetch. */
  async countBySupplier(organisationId: string, supplierId: string): Promise<number> {
    return this.prisma.supplierPayment.count({ where: { organisationId, supplierId } });
  }

  /** Everything recorded within `[from, to)`, for the "Payments Made This Period"
   *  card — excludes voided payments. */
  async sumRecordedBetween(organisationId: string, from: Date, to: Date): Promise<number> {
    const result = await this.prisma.supplierPayment.aggregate({
      where: {
        organisationId,
        status: PaymentStatus.RECORDED,
        paymentDate: { gte: from, lt: to },
      },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  async create(data: CreateSupplierPaymentData): Promise<CreateSupplierPaymentResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.supplierPayment.findUnique({
          where: {
            supplierId_idempotencyKey: {
              supplierId: data.supplierId,
              idempotencyKey: data.idempotencyKey,
            },
          },
          include: RELATIONS_INCLUDE,
        });
        if (existing) {
          const invoice = await tx.supplierInvoice.findUniqueOrThrow({
            where: { id: data.supplierInvoiceId },
          });
          return {
            supplierPayment: existing,
            supplierInvoice: {
              id: invoice.id,
              status: invoice.status,
              amountPaid: invoice.amountPaid,
              amountCredited: invoice.amountCredited,
              recognizedAmount: invoice.recognizedAmount,
            },
            wasCreated: false,
          };
        }
      }

      const eligibleInvoice = await tx.supplierInvoice.findFirst({
        where: {
          id: data.supplierInvoiceId,
          organisationId: data.organisationId,
          supplierId: data.supplierId,
          status: { in: PAYABLE_SUPPLIER_INVOICE_STATUSES },
        },
      });
      if (!eligibleInvoice) {
        throw new PaymentInvoiceConflictError(
          'Supplier invoice is not eligible to receive a payment',
        );
      }

      const outstanding = roundCurrency(
        eligibleInvoice.recognizedAmount -
          eligibleInvoice.amountPaid -
          eligibleInvoice.amountCredited,
      );
      if (roundCurrency(data.amount) > outstanding) {
        throw new OverPaymentError(
          `Cannot record a payment of ${data.amount} — only ${outstanding} remains outstanding`,
        );
      }

      let cashAccountLinkedAccountId: string | undefined;
      if (data.cashAccountId) {
        const cashAccount = await tx.cashAccount.findFirst({
          where: { id: data.cashAccountId, organisationId: data.organisationId },
          select: { linkedChartOfAccountId: true },
        });
        if (!cashAccount) {
          throw new InvalidCashAccountError('Cash account not found for this organisation');
        }
        cashAccountLinkedAccountId = cashAccount.linkedChartOfAccountId;
      }

      const supplierPayment = await tx.supplierPayment.create({
        data: {
          organisationId: data.organisationId,
          supplierId: data.supplierId,
          paymentDate: data.paymentDate,
          amount: data.amount,
          currency: eligibleInvoice.currency,
          method: data.method,
          reference: data.reference,
          notes: data.notes,
          cashAccountId: data.cashAccountId,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
          allocations: {
            create: [{ supplierInvoiceId: data.supplierInvoiceId, amount: data.amount }],
          },
        },
        include: RELATIONS_INCLUDE,
      });

      const newAmountPaid = roundCurrency(eligibleInvoice.amountPaid + data.amount);
      const newStatus = deriveSupplierInvoiceStatusAfterApplication(
        newAmountPaid,
        eligibleInvoice.amountCredited,
        eligibleInvoice.recognizedAmount,
      );
      const invoice = await tx.supplierInvoice.update({
        where: { id: data.supplierInvoiceId },
        data: { amountPaid: newAmountPaid, status: newStatus, updatedById: data.createdById },
      });

      // DR Accounts Payable, CR Cash/Bank (docs/domains/accounting.md) — atomic with
      // the payment+invoice writes above.
      await postSystemJournalEntry(tx, {
        organisationId: data.organisationId,
        date: data.paymentDate,
        description: `Payment made against ${eligibleInvoice.invoiceNumber}`,
        reference: data.reference,
        sourceType: 'SUPPLIER_PAYMENT',
        sourceId: supplierPayment.id,
        actorUserId: data.createdById,
        lines: [
          { systemKey: SYSTEM_ACCOUNT_KEYS.AP, debit: data.amount },
          cashAccountLinkedAccountId
            ? { accountId: cashAccountLinkedAccountId, credit: data.amount }
            : {
                systemKey:
                  data.method === PaymentMethod.CASH
                    ? SYSTEM_ACCOUNT_KEYS.CASH
                    : SYSTEM_ACCOUNT_KEYS.BANK,
                credit: data.amount,
              },
        ],
      });

      return {
        supplierPayment,
        supplierInvoice: {
          id: invoice.id,
          status: invoice.status,
          amountPaid: invoice.amountPaid,
          amountCredited: invoice.amountCredited,
          recognizedAmount: invoice.recognizedAmount,
        },
        wasCreated: true,
      };
    });
  }

  /** Reverses a payment's effect: decrements the target invoice's `amountPaid` by the
   *  voided payment's allocated amount and recomputes its status back down. A
   *  corrective action, not a delete. */
  async void(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<{ supplierPayment: SupplierPaymentWithRelations; supplierInvoiceId: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.supplierPayment.findFirst({
        where: { id, organisationId },
        include: RELATIONS_INCLUDE,
      });
      if (!existing) {
        return null;
      }
      if (existing.status === PaymentStatus.VOIDED) {
        throw new PaymentAlreadyVoidedError('This payment has already been voided');
      }

      const allocation = existing.allocations[0];
      if (allocation) {
        const invoice = await tx.supplierInvoice.findUniqueOrThrow({
          where: { id: allocation.supplierInvoiceId },
        });
        const newAmountPaid = roundCurrency(Math.max(0, invoice.amountPaid - allocation.amount));
        const newStatus = deriveSupplierInvoiceStatusAfterReversal(
          newAmountPaid,
          invoice.amountCredited,
          invoice.recognizedAmount,
        );
        await tx.supplierInvoice.update({
          where: { id: allocation.supplierInvoiceId },
          data: { amountPaid: newAmountPaid, status: newStatus, updatedById: actorUserId },
        });
      }

      const supplierPayment = await tx.supplierPayment.update({
        where: { id },
        data: { status: PaymentStatus.VOIDED },
        include: RELATIONS_INCLUDE,
      });

      return { supplierPayment, supplierInvoiceId: allocation?.supplierInvoiceId ?? '' };
    });
  }
}

/** `(amountPaid+amountCredited) >= recognizedAmount ? PAID : (...) > 0 ?
 *  PARTIALLY_PAID : unchanged` — shared by `SupplierPaymentRepository`/
 *  `SupplierCreditNoteRepository` after their respective increments. Byte-identical
 *  formula to `deriveInvoiceStatusAfterApplication` (`payment.repository.ts`), but a
 *  distinct function since `SupplierInvoiceStatus` is a nominally different TS enum
 *  from `InvoiceStatus`. Never demotes a status the increment didn't cause. */
export function deriveSupplierInvoiceStatusAfterApplication(
  amountPaid: number,
  amountCredited: number,
  recognizedAmount: number,
): SupplierInvoiceStatus {
  const applied = roundCurrency(amountPaid + amountCredited);
  if (applied >= recognizedAmount && recognizedAmount > 0) {
    return SupplierInvoiceStatus.PAID;
  }
  if (applied > 0) {
    return SupplierInvoiceStatus.PARTIALLY_PAID;
  }
  return SupplierInvoiceStatus.POSTED;
}

/** Same formula, used after a void/reversal — the invoice's status may need to move
 *  backward (e.g. `PAID` -> `PARTIALLY_PAID`). */
export function deriveSupplierInvoiceStatusAfterReversal(
  amountPaid: number,
  amountCredited: number,
  recognizedAmount: number,
): SupplierInvoiceStatus {
  return deriveSupplierInvoiceStatusAfterApplication(amountPaid, amountCredited, recognizedAmount);
}

/** Rounds to 2 decimal places for currency figures — same convention as
 *  `InvoiceService`'s own `roundCurrency`. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
