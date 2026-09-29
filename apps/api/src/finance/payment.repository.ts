import { Injectable } from '@nestjs/common';
import {
  InvoiceStatus,
  Payment,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { SYSTEM_ACCOUNT_KEYS } from './accounting/chart-of-account-keys';
import { postSystemJournalEntry } from './accounting/journal-posting';
import { PAYABLE_INVOICE_STATUSES } from './invoice.repository';

export interface ListPaymentsParams {
  customerId?: string;
  invoiceId?: string;
}

const CUSTOMER_SELECT = { id: true, customerCode: true, customerName: true };

/** Added Sprint 35 — `null` for a B2B payment. */
const CONSUMER_SELECT = { id: true, consumerCode: true, fullName: true };

export type PaymentWithRelations = Payment & {
  /** `null` for a D2C payment (Sprint 35) — see `consumer` below. */
  customer: { id: string; customerCode: string; customerName: string } | null;
  /** Added Sprint 35 — `null` for a B2B payment. */
  consumer: { id: string; consumerCode: string; fullName: string } | null;
  allocations: { id: string; invoiceId: string; amount: number }[];
};

const RELATIONS_INCLUDE = {
  customer: { select: CUSTOMER_SELECT },
  consumer: { select: CONSUMER_SELECT },
  allocations: true,
};

/** Sprint 35 — D2C OPay Payment Integration. `createPendingForConsumer`'s
 *  input: deliberately has no `unitPrice`/`amount`-from-client field beyond
 *  what the caller (`D2CPaymentService`) has ALREADY derived from the
 *  authoritative `SalesOrder.total` — this repository trusts its caller
 *  exactly as much as `SalesOrderService.createForConsumer` trusts
 *  `D2COrderingService` (an internal, same-request, already-validated
 *  boundary — see Sprint 34's identical reasoning). */
export interface CreatePendingConsumerPaymentData {
  organisationId: string;
  consumerId: string;
  salesOrderId: string;
  amount: number;
  currency: string;
  merchantReference: string;
}

export interface CreatePaymentData {
  organisationId: string;
  customerId: string;
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  paymentDate: Date;
  reference?: string;
  notes?: string;
  /** Added Sprint 14 (docs/domains/cash-management.md) — which specific
   *  `CashAccount` received the money. Optional: when omitted, posting falls back
   *  to the pre-Sprint-14 `method`-based generic `CASH`/`BANK` system account. */
  cashAccountId?: string;
  idempotencyKey?: string;
  createdById: string;
}

/** Thrown when `cashAccountId` doesn't resolve to an active `CashAccount` belonging
 *  to this organisation. */
export class InvalidCashAccountError extends Error {}

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
          cashAccountId: data.cashAccountId,
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

      // DR Cash/Bank, CR Accounts Receivable (docs/domains/accounting.md) — atomic
      // with the payment+invoice writes above; a failed posting (no open period, no
      // configured system account) rolls the whole payment back, never leaving a
      // recorded payment with no accounting behind it.
      await postSystemJournalEntry(tx, {
        organisationId: data.organisationId,
        date: data.paymentDate,
        description: `Payment received against ${eligibleInvoice.invoiceCode}`,
        reference: data.reference,
        sourceType: 'PAYMENT',
        sourceId: payment.id,
        actorUserId: data.createdById,
        lines: [
          cashAccountLinkedAccountId
            ? { accountId: cashAccountLinkedAccountId, debit: data.amount }
            : {
                systemKey:
                  data.method === PaymentMethod.CASH
                    ? SYSTEM_ACCOUNT_KEYS.CASH
                    : SYSTEM_ACCOUNT_KEYS.BANK,
                debit: data.amount,
              },
          { systemKey: SYSTEM_ACCOUNT_KEYS.AR, credit: data.amount },
        ],
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

  // ---------------------------------------------------------------------
  // Sprint 35 — D2C OPay Payment Integration. A structurally different
  // creation path from `create()` above: no `Invoice`/`PaymentAllocation`
  // (a D2C `SalesOrder` is never invoiced — Sprint 34's own boundary), no
  // journal posting (there is no existing Finance/AR mechanism this
  // genuinely triggers yet — see docs/domains/d2c.md "Finance Boundary"),
  // and starts life `PENDING` rather than `RECORDED` (money has not been
  // received yet; the whole point of this path is a payment ATTEMPT
  // awaiting provider confirmation — the opposite of `create()`'s
  // already-completed-cash-receipt assumption). Never touches
  // `SalesOrder`/`SalesOrderItem`/`InventoryStock` — see
  // `d2c-payment-independence.spec.ts`.
  // ---------------------------------------------------------------------

  /** Looks up a payment by its globally-unique `merchantReference` —
   *  THE lookup a provider callback (which carries only a reference, no
   *  tenant hint) uses to resolve both the payment AND its organisation at
   *  once, closing the cross-tenant-ambiguity risk by construction. */
  findByMerchantReference(merchantReference: string): Promise<PaymentWithRelations | null> {
    return this.prisma.payment.findUnique({
      where: { merchantReference },
      include: RELATIONS_INCLUDE,
    });
  }

  /** `POST /d2c/conversations/messages`'s "Pay Now" path, via
   *  `D2CPaymentService`. Idempotent by `merchantReference` exactly like
   *  `ConsumerRepository`/`ConversationRepository`/
   *  `SalesOrderService.createForConsumer` (Sprints 30/32/33/34): check,
   *  then create, and on a `P2002` race (two concurrent "Pay Now" clicks),
   *  re-fetch and return the winner. */
  async createPendingForConsumer(
    data: CreatePendingConsumerPaymentData,
  ): Promise<{ payment: PaymentWithRelations; wasCreated: boolean }> {
    const existing = await this.findByMerchantReference(data.merchantReference);
    if (existing) {
      return { payment: existing, wasCreated: false };
    }

    try {
      const payment = await this.prisma.payment.create({
        data: {
          organisationId: data.organisationId,
          consumerId: data.consumerId,
          salesOrderId: data.salesOrderId,
          paymentDate: new Date(),
          amount: data.amount,
          currency: data.currency,
          method: PaymentMethod.ONLINE,
          status: PaymentStatus.PENDING,
          provider: PaymentProvider.OPAY,
          merchantReference: data.merchantReference,
        },
        include: RELATIONS_INCLUDE,
      });
      return { payment, wasCreated: true };
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        const winner = await this.findByMerchantReference(data.merchantReference);
        if (winner) {
          return { payment: winner, wasCreated: false };
        }
      }
      throw error;
    }
  }

  /** Persists the gateway's own identifier and/or the returned cashier URL
   *  onto an already-`PENDING` payment — never widens the WHERE beyond this
   *  organisation+payment, and never touches `status` (that transition is
   *  `applyProviderCallback`'s job, driven only by a verified callback). */
  async attachProviderDetails(
    organisationId: string,
    id: string,
    details: { providerReference?: string; checkoutUrl?: string },
  ): Promise<PaymentWithRelations | null> {
    const result = await this.prisma.payment.updateMany({
      where: { id, organisationId },
      data: details,
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(organisationId, id);
  }

  /**
   * The webhook's own write path. Tenant-safe by construction (the caller
   * already resolved `organisationId` FROM this exact payment via
   * `findByMerchantReference`, never from the callback itself). Idempotent
   * AND concurrency-safe via a conditional `updateMany` scoped to
   * `status: PENDING` — the exact "conditional update as concurrency
   * primitive" convention used throughout this codebase
   * (`SalesOrderRepository.updateStatus`, etc.): a callback arriving after
   * the payment has ALREADY resolved (a duplicate SUCCESS callback, or a
   * late FAIL arriving after an earlier SUCCESS already applied) matches
   * zero rows and is treated as an idempotent no-op, never a second
   * transition or a corruption of an already-final status.
   */
  async applyProviderCallback(
    organisationId: string,
    id: string,
    toStatus: PaymentStatus,
    providerReference: string,
  ): Promise<{ payment: PaymentWithRelations; wasApplied: boolean } | null> {
    const result = await this.prisma.payment.updateMany({
      where: { id, organisationId, status: PaymentStatus.PENDING },
      data: { status: toStatus, providerReference },
    });
    const payment = await this.findById(organisationId, id);
    if (!payment) {
      return null;
    }
    return { payment, wasApplied: result.count > 0 };
  }
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** Same `P2002` check as `ConsumerRepository`/`ConversationRepository`/
 *  `SalesOrderService`'s own race-recovery, applied here to `Payment`'s
 *  `merchantReference` unique constraint (Sprint 35). */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_CONSTRAINT_VIOLATION
  );
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
