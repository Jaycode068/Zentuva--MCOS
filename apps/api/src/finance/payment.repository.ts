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
  /** Added Sprint 39 — the D2C Admin Consumer/Order detail's payment history
   *  (docs/domains/d2c.md). No existing caller passed this before. */
  consumerId?: string;
  salesOrderId?: string;
  /** Added Sprint 39 — batch read for the D2C Admin order LIST (one query for a whole
   *  page of orders' payment status, not one per order) — the same batch-read
   *  convention as `CollectionPointFulfillmentRepository.findManyBySalesOrderIds`
   *  (Sprint 38). Mutually exclusive with `salesOrderId` in practice; the repository
   *  applies both independently if a caller somehow passed both. */
  salesOrderIds?: string[];
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

/** One target invoice + the amount of THIS payment applied to it (Phase 1 — Customer
 *  Account Management, docs/customer-account-inventory-audit.md §7.2). */
export interface PaymentAllocationData {
  invoiceId: string;
  amount: number;
}

export interface CreatePaymentData {
  organisationId: string;
  customerId: string;
  /** Always at least one entry. The legacy single-invoice shape is simply a
   *  one-element array — `PaymentService.create()` normalizes the still-accepted
   *  single `invoiceId` request body into this shape before calling the repository,
   *  so this is the ONLY allocation shape the repository itself ever has to handle.
   *  Sum of allocation amounts must equal `amount` exactly (full allocation) — see
   *  `PaymentService.create()`'s own doc comment for why partial/unallocated-advance
   *  payments are a deliberately deferred, separate capability, not supported here. */
  allocations: PaymentAllocationData[];
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

export interface AffectedInvoiceSummary {
  id: string;
  status: InvoiceStatus;
  amountPaid: number;
  amountCredited: number;
  total: number;
}

export interface CreatePaymentResult {
  payment: PaymentWithRelations;
  /** One entry per allocation, same order as `CreatePaymentData.allocations` — always
   *  at least one (Phase 1 — Customer Account Management, multi-invoice allocation). */
  invoices: AffectedInvoiceSummary[];
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
        ...(params.consumerId ? { consumerId: params.consumerId } : {}),
        ...(params.salesOrderId ? { salesOrderId: params.salesOrderId } : {}),
        ...(params.salesOrderIds ? { salesOrderId: { in: params.salesOrderIds } } : {}),
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
          const invoices = await Promise.all(
            existing.allocations.map((allocation) =>
              tx.invoice.findUniqueOrThrow({ where: { id: allocation.invoiceId } }),
            ),
          );
          return {
            payment: existing,
            invoices: invoices.map(toInvoiceSummary),
            wasCreated: false,
          };
        }
      }

      // Re-validate every allocation's target invoice inside the transaction — same
      // "close the race against a concurrent status change" rationale as the original
      // single-invoice check, now applied per invoice (Phase 1 §7.2: "every invoice
      // exists... belongs to the same customer... is eligible... cannot be allocated
      // beyond its remaining receivable balance").
      const eligibleInvoices = await tx.invoice.findMany({
        where: {
          id: { in: data.allocations.map((a) => a.invoiceId) },
          organisationId: data.organisationId,
          customerId: data.customerId,
          status: { in: PAYABLE_INVOICE_STATUSES },
        },
      });
      const eligibleById = new Map(eligibleInvoices.map((invoice) => [invoice.id, invoice]));

      for (const allocation of data.allocations) {
        const invoice = eligibleById.get(allocation.invoiceId);
        if (!invoice) {
          throw new PaymentInvoiceConflictError(
            `Invoice ${allocation.invoiceId} is not eligible to receive a payment`,
          );
        }
        const outstanding = roundCurrency(
          invoice.total - invoice.amountPaid - invoice.amountCredited,
        );
        if (roundCurrency(allocation.amount) > outstanding) {
          throw new OverPaymentError(
            `Cannot allocate ${allocation.amount} to invoice ${invoice.invoiceCode} — only ${outstanding} remains outstanding`,
          );
        }
      }

      const totalAllocated = roundCurrency(data.allocations.reduce((sum, a) => sum + a.amount, 0));
      if (totalAllocated !== roundCurrency(data.amount)) {
        throw new OverPaymentError(
          `Allocations (${totalAllocated}) must total the full payment amount (${data.amount})`,
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

      const firstInvoice = eligibleById.get(data.allocations[0]!.invoiceId)!;
      const payment = await tx.payment.create({
        data: {
          organisationId: data.organisationId,
          customerId: data.customerId,
          paymentDate: data.paymentDate,
          amount: data.amount,
          currency: firstInvoice.currency,
          method: data.method,
          reference: data.reference,
          notes: data.notes,
          cashAccountId: data.cashAccountId,
          idempotencyKey: data.idempotencyKey,
          createdById: data.createdById,
          allocations: {
            create: data.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })),
          },
        },
        include: RELATIONS_INCLUDE,
      });

      const updatedInvoices: AffectedInvoiceSummary[] = [];
      for (const allocation of data.allocations) {
        const invoice = eligibleById.get(allocation.invoiceId)!;
        const newAmountPaid = roundCurrency(invoice.amountPaid + allocation.amount);
        const newStatus = deriveInvoiceStatusAfterApplication(
          newAmountPaid,
          invoice.amountCredited,
          invoice.total,
        );
        const updated = await tx.invoice.update({
          where: { id: allocation.invoiceId },
          data: { amountPaid: newAmountPaid, status: newStatus, updatedById: data.createdById },
        });
        updatedInvoices.push(toInvoiceSummary(updated));
      }

      // DR Cash/Bank for the full amount received, CR Accounts Receivable for the SAME
      // amount (docs/domains/accounting.md) — balanced by construction, since
      // allocations are required to sum to exactly `data.amount` above. Multiple
      // invoices simply means the AR credit is "spread" across several invoice
      // updates rather than one; the journal entry itself is still one balanced
      // two-line posting, same shape as before multi-invoice allocation existed.
      // Atomic with the payment+invoice writes above.
      await postSystemJournalEntry(tx, {
        organisationId: data.organisationId,
        date: data.paymentDate,
        description:
          data.allocations.length === 1
            ? `Payment received against ${firstInvoice.invoiceCode}`
            : `Payment received against ${data.allocations.length} invoices`,
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
        invoices: updatedInvoices,
        wasCreated: true,
      };
    });
  }

  /** Reverses a payment's effect: decrements EVERY allocated invoice's `amountPaid` by
   *  its own share of the voided payment and recomputes each invoice's status back
   *  down. A corrective action, not a delete — the `Payment` row itself is kept, just
   *  flagged `VOIDED`. Widened (Phase 1 — Customer Account Management) from a single
   *  `allocations[0]`-only assumption to loop over every allocation, since a payment
   *  may now span multiple invoices. */
  async void(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<{ payment: PaymentWithRelations; invoiceIds: string[] } | null> {
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

      for (const allocation of existing.allocations) {
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

      return { payment, invoiceIds: existing.allocations.map((a) => a.invoiceId) };
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

/** Narrows a full `Invoice` row down to `AffectedInvoiceSummary`'s shape — the only
 *  fields `PaymentService`/`PaymentController` need after a create/void. */
function toInvoiceSummary(invoice: {
  id: string;
  status: InvoiceStatus;
  amountPaid: number;
  amountCredited: number;
  total: number;
}): AffectedInvoiceSummary {
  return {
    id: invoice.id,
    status: invoice.status,
    amountPaid: invoice.amountPaid,
    amountCredited: invoice.amountCredited,
    total: invoice.total,
  };
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
