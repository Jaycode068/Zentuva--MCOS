import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { CreatePaymentInput } from '@zentuva/validation';

import {
  MissingSystemAccountError,
  NoOpenPeriodError,
  UnbalancedPostingError,
} from './accounting/journal-posting';
import { InvoiceRepository, PAYABLE_INVOICE_STATUSES } from './invoice.repository';
import {
  CreatePaymentResult,
  CreatePendingConsumerPaymentData,
  InvalidCashAccountError,
  ListPaymentsParams,
  OverPaymentError,
  PaymentAlreadyVoidedError,
  PaymentInvoiceConflictError,
  PaymentRepository,
  PaymentWithRelations,
} from './payment.repository';

/**
 * Domain service for the `Payment` aggregate (Sprint 6, docs/domains/finance.md).
 *
 * CRITICAL, non-negotiable: this file never injects `InventoryStockRepository`/
 * `DispatchRepository`/`DeliveryRepository`, and never writes to `SalesOrder` — it only
 * reads `Invoice` data, which Finance itself owns. See `finance-independence.spec.ts`.
 */
@Injectable()
export class PaymentService {
  constructor(
    private readonly paymentRepository: PaymentRepository,
    private readonly invoiceRepository: InvoiceRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<PaymentWithRelations> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListPaymentsParams): Promise<PaymentWithRelations[]> {
    return this.paymentRepository.findManyByOrganisation(organisationId, params);
  }

  /** `POST /` — mirrors `DeliveryService.create()`'s exact three-part pre-check shape
   *  (invoice eligibility -> over-payment), then delegates to the atomic write. Both
   *  checks are UX-only fast-fail 400s; the repository's own transaction re-validates
   *  each authoritatively.
   *
   *  Widened Phase 1 — Customer Account Management (docs/customer-account-inventory-
   *  audit.md §7.2): `input.invoiceId` (legacy, single-invoice) and `input.allocations`
   *  (new, multi-invoice) are mutually exclusive per `createPaymentSchema`'s own
   *  `.refine()` — normalized here into one `allocations` array so the repository only
   *  ever has to handle one shape. Every allocation's target invoice must belong to the
   *  SAME customer; allocations must sum to exactly `input.amount` (full allocation —
   *  see `CreatePaymentData`'s own doc comment for why a partially-unallocated
   *  "customer advance" is a deliberately deferred, separate capability). */
  async create(
    organisationId: string,
    input: CreatePaymentInput,
    actorUserId: string,
  ): Promise<CreatePaymentResult> {
    const allocationInputs = input.allocations ?? [
      { invoiceId: input.invoiceId!, amount: input.amount },
    ];

    const invoices = await Promise.all(
      allocationInputs.map((allocation) =>
        this.getInvoiceOrThrow(organisationId, allocation.invoiceId),
      ),
    );

    const customerId = invoices[0]!.customerId;
    if (invoices.some((invoice) => invoice.customerId !== customerId)) {
      throw new BadRequestException(
        'Every invoice in a single payment must belong to the same customer',
      );
    }

    for (let i = 0; i < invoices.length; i += 1) {
      const invoice = invoices[i]!;
      const allocation = allocationInputs[i]!;
      if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status)) {
        throw new BadRequestException(
          `Invoice ${invoice.invoiceCode} is not eligible to receive a payment`,
        );
      }
      const outstanding = roundCurrency(
        invoice.total - invoice.amountPaid - invoice.amountCredited,
      );
      if (roundCurrency(allocation.amount) > outstanding) {
        throw new BadRequestException(
          `Cannot allocate ${allocation.amount} to invoice ${invoice.invoiceCode} — only ${outstanding} remains outstanding`,
        );
      }
    }

    const totalAllocated = roundCurrency(
      allocationInputs.reduce((sum, allocation) => sum + allocation.amount, 0),
    );
    if (totalAllocated !== roundCurrency(input.amount)) {
      throw new BadRequestException(
        `Allocations (${totalAllocated}) must total the full payment amount (${input.amount})`,
      );
    }

    try {
      return await this.paymentRepository.create({
        organisationId,
        customerId,
        allocations: allocationInputs,
        amount: input.amount,
        method: input.method,
        paymentDate: input.paymentDate,
        reference: input.reference,
        notes: input.notes,
        cashAccountId: input.cashAccountId,
        idempotencyKey: input.idempotencyKey,
        createdById: actorUserId,
      });
    } catch (error) {
      if (
        error instanceof OverPaymentError ||
        error instanceof PaymentInvoiceConflictError ||
        error instanceof InvalidCashAccountError ||
        error instanceof MissingSystemAccountError ||
        error instanceof NoOpenPeriodError ||
        error instanceof UnbalancedPostingError
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /** `POST /:id/void` — a corrective reversal, not a delete. */
  async void(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<{ payment: PaymentWithRelations; invoiceIds: string[] }> {
    try {
      const result = await this.paymentRepository.void(organisationId, id, actorUserId);
      if (!result) {
        throw new NotFoundException('Payment not found');
      }
      return result;
    } catch (error) {
      if (error instanceof PaymentAlreadyVoidedError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------
  // Sprint 35 — D2C OPay Payment Integration. Thin pass-throughs to
  // `PaymentRepository`'s new D2C-specific methods, the exact
  // `SalesOrderService.createForConsumer`-alongside-`create()` shape
  // (Sprint 34): the pre-existing `create()`/`void()` above are completely
  // unchanged, and `D2CPaymentService` (never anything under `d2c/`
  // directly) is the only caller of these three.
  // ---------------------------------------------------------------------

  createPendingForConsumer(
    data: CreatePendingConsumerPaymentData,
  ): Promise<{ payment: PaymentWithRelations; wasCreated: boolean }> {
    return this.paymentRepository.createPendingForConsumer(data);
  }

  findByMerchantReference(merchantReference: string): Promise<PaymentWithRelations | null> {
    return this.paymentRepository.findByMerchantReference(merchantReference);
  }

  attachProviderDetails(
    organisationId: string,
    id: string,
    details: { providerReference?: string; checkoutUrl?: string },
  ): Promise<PaymentWithRelations | null> {
    return this.paymentRepository.attachProviderDetails(organisationId, id, details);
  }

  applyProviderCallback(
    organisationId: string,
    id: string,
    toStatus: PaymentStatus,
    providerReference: string,
  ): Promise<{ payment: PaymentWithRelations; wasApplied: boolean } | null> {
    return this.paymentRepository.applyProviderCallback(
      organisationId,
      id,
      toStatus,
      providerReference,
    );
  }

  private async getInvoiceOrThrow(organisationId: string, id: string) {
    const invoice = await this.invoiceRepository.findById(organisationId, id);
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<PaymentWithRelations> {
    const payment = await this.paymentRepository.findById(organisationId, id);
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    return payment;
  }
}

/** Rounds to 2 decimal places for currency figures — same convention used throughout
 *  this domain. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
