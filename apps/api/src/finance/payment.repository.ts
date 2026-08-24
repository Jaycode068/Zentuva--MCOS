import { Injectable } from '@nestjs/common';
import { InvoiceStatus, Payment, PaymentMethod, PaymentStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { PAYABLE_INVOICE_STATUSES } from './invoice.repository';

export interface ListPaymentsParams {
  customerId?: string;
  invoiceId?: string;
}

const CUSTOMER_SELECT = { id: true, customerCode: true, customerName: true };

export type PaymentWithRelations = Payment & {
  customer: { id: string; customerCode: string; customerName: string };
  allocations: { id: string; invoiceId: string; amount: number }[];
};

const RELATIONS_INCLUDE = {
  customer: { select: CUSTOMER_SELECT },
  allocations: true,
};

export interface CreatePaymentData {
  organisationId: string;
  customerId: string;
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  paymentDate: Date;
  reference?: string;
  notes?: string;
  idempotencyKey?: string;
  createdById: string;
}

export interface CreatePaymentResult {
  payment: PaymentWithRelations;
  invoice: {
    id: string;
    status: InvoiceStatus;
    amountPaid: number;
    amountCredited: number;
    total: number;
  };
  /** `true` only when THIS call created a new row; `false` when an existing
   *  `idempotencyKey` match was returned instead — lets the controller skip re-emitting
   *  the audit event on a replay. */
  wasCreated: boolean;
}

/** Thrown when the recorded amount would exceed the invoice's current outstanding
 *  balance. Its own `Error` subclass (not `BadRequestException`) because this file has
 *  no Nest HTTP context — same convention as `OverDispatchError`/`OverDeliveryError`. */
export class OverPaymentError extends Error {}

/** Thrown when the target invoice isn't in a payable status, doesn't belong to this
 *  organisation, or doesn't belong to the payment's own customer — re-checked here to
 *  close the race against a concurrent status change between `PaymentService`'s
 *  pre-check and this transaction. */
export class PaymentInvoiceConflictError extends Error {}

/** Thrown when attempting to void a payment that has already been voided. */
export class PaymentAlreadyVoidedError extends Error {}

/**
 * Thin Prisma access for the `Payment` aggregate (Sprint 6, docs/domains/finance.md).
 * Never touches `SalesOrder`/`Dispatch`/`Delivery`/`InventoryStock` tables — only
 * `Invoice`/`Payment`/`PaymentAllocation`, its own domain's tables.
 *
 * `create()` mirrors `DeliveryRepository.create()`'s exact shape one level further down
 * a different chain: idempotency check-then-return, an eligibility guard re-reading the
 * target `Invoice`'s status inside the transaction, an over-payment guard, the
 * `Payment`+`PaymentAllocation` create, the `Invoice.amountPaid` increment, and the
 * invoice's own status recomputation — all rolled back together on any failure.
 */
@Injectable()
export class PaymentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<PaymentWithRelations | null> {
    return this.prisma.payment.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListPaymentsParams = {},
  ): Promise<PaymentWithRelations[]> {
    return this.prisma.payment.findMany({
      where: {
        organisationId,
        ...(params.customerId ? { customerId: params.customerId } : {}),
        ...(params.invoiceId ? { allocations: { some: { invoiceId: params.invoiceId } } } : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Everything recorded within `[from, to)`, for the "Payments Received" overview card
   *  — excludes voided payments. */
  async sumRecordedBetween(organisationId: string, from: Date, to: Date): Promise<number> {
    const result = await this.prisma.payment.aggregate({
      where: {
        organisationId,
        status: PaymentStatus.RECORDED,
        paymentDate: { gte: from, lt: to },
      },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  async create(data: CreatePaymentData): Promise<CreatePaymentResult> {
    return this.prisma.$transaction(async (tx) => {
      if (data.idempotencyKey) {
        const existing = await tx.payment.findUnique({
          where: {
            customerId_idempotencyKey: {
              customerId: data.customerId,
              idempotencyKey: data.idempotencyKey,
            },
          },
          include: RELATIONS_INCLUDE,
        });
        if (existing) {
          const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: data.invoiceId } });
          return {
            payment: existing,
            invoice: {
              id: invoice.id,
              status: invoice.status,
              amountPaid: invoice.amountPaid,
              amountCredited: invoice.amountCredited,
              total: invoice.total,
            },
            wasCreated: false,
          };
        }
      }

      const eligibleInvoice = await tx.invoice.findFirst({
        where: {
          id: data.invoiceId,
          organisationId: data.organisationId,
          customerId: data.customerId,
          status: { in: PAYABLE_INVOICE_STATUSES },
        },
      });
      if (!eligibleInvoice) {
        throw new PaymentInvoiceConflictError('Invoice is not eligible to receive a payment');
      }

      const outstanding = roundCurrency(
        eligibleInvoice.total - eligibleInvoice.amountPaid - eligibleInvoice.amountCredited,
      );
      if (roundCurrency(data.amount) > outstanding) {
        throw new OverPaymentError(
          `Cannot record a payment of ${data.amount} — only ${outstanding} remains outstanding`,
        );
      }

      const payment = await tx.payment.create({
        data: {
          organisationId: data.organisationId,
          customerId: data.customerId,
          paymentDate: data.paymentDate,
          amount: data.amount,
          currency: eligibleInvoice.currency,
          method: data.method,
          reference: data.reference,
          notes: data.notes,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
          allocations: {
            create: [{ invoiceId: data.invoiceId, amount: data.amount }],
          },
        },
        include: RELATIONS_INCLUDE,
      });

      const newAmountPaid = roundCurrency(eligibleInvoice.amountPaid + data.amount);
      const newStatus = deriveInvoiceStatusAfterApplication(
        newAmountPaid,
        eligibleInvoice.amountCredited,
        eligibleInvoice.total,
      );
      const invoice = await tx.invoice.update({
        where: { id: data.invoiceId },
        data: { amountPaid: newAmountPaid, status: newStatus, updatedById: data.createdById },
      });

      return {
        payment,
        invoice: {
          id: invoice.id,
          status: invoice.status,
          amountPaid: invoice.amountPaid,
          amountCredited: invoice.amountCredited,
          total: invoice.total,
        },
        wasCreated: true,
      };
    });
  }

  /** Reverses a payment's effect: decrements the target invoice's `amountPaid` by the
   *  voided payment's allocated amount and recomputes its status back down. A corrective
   *  action, not a delete — the `Payment` row itself is kept, just flagged `VOIDED`. */
  async void(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<{ payment: PaymentWithRelations; invoiceId: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.payment.findFirst({
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
        const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: allocation.invoiceId } });
        const newAmountPaid = roundCurrency(Math.max(0, invoice.amountPaid - allocation.amount));
        const newStatus = deriveInvoiceStatusAfterReversal(
          newAmountPaid,
          invoice.amountCredited,
          invoice.total,
        );
        await tx.invoice.update({
          where: { id: allocation.invoiceId },
          data: { amountPaid: newAmountPaid, status: newStatus, updatedById: actorUserId },
        });
      }

      const payment = await tx.payment.update({
        where: { id },
        data: { status: PaymentStatus.VOIDED },
        include: RELATIONS_INCLUDE,
      });

      return { payment, invoiceId: allocation?.invoiceId ?? '' };
    });
  }
}

/** `(amountPaid+amountCredited) >= total ? PAID : (...) > 0 ? PARTIALLY_PAID : unchanged`
 *  — shared by `PaymentRepository`/`CreditNoteRepository` after their respective
 *  increments. Never demotes a status the increment didn't cause — an increment can only
 *  ever move a payable invoice forward toward `PAID`. */
export function deriveInvoiceStatusAfterApplication(
  amountPaid: number,
  amountCredited: number,
  total: number,
): InvoiceStatus {
  const applied = roundCurrency(amountPaid + amountCredited);
  if (applied >= total) {
    return InvoiceStatus.PAID;
  }
  if (applied > 0) {
    return InvoiceStatus.PARTIALLY_PAID;
  }
  return InvoiceStatus.ISSUED;
}

/** Same formula, used after a void/reversal — the invoice's status may need to move
 *  backward (e.g. `PAID` -> `PARTIALLY_PAID`). If genuinely still overdue, the next read
 *  through `InvoiceRepository`'s lazy sweep will re-flag it — this function never needs
 *  to know about `dueDate` itself. */
export function deriveInvoiceStatusAfterReversal(
  amountPaid: number,
  amountCredited: number,
  total: number,
): InvoiceStatus {
  return deriveInvoiceStatusAfterApplication(amountPaid, amountCredited, total);
}

/** Rounds to 2 decimal places for currency figures — same convention as
 *  `InvoiceService`'s own `roundCurrency`. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
