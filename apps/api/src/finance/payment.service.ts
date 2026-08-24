import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreatePaymentInput } from '@zentuva/validation';

import { InvoiceRepository, PAYABLE_INVOICE_STATUSES } from './invoice.repository';
import {
  CreatePaymentResult,
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
   *  each authoritatively. */
  async create(
    organisationId: string,
    input: CreatePaymentInput,
    actorUserId: string,
  ): Promise<CreatePaymentResult> {
    const invoice = await this.getInvoiceOrThrow(organisationId, input.invoiceId);
    if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status)) {
      throw new BadRequestException('This invoice is not eligible to receive a payment');
    }

    const outstanding = roundCurrency(invoice.total - invoice.amountPaid - invoice.amountCredited);
    if (roundCurrency(input.amount) > outstanding) {
      throw new BadRequestException(
        `Cannot record a payment of ${input.amount} — only ${outstanding} remains outstanding`,
      );
    }

    try {
      return await this.paymentRepository.create({
        organisationId,
        customerId: invoice.customerId,
        invoiceId: input.invoiceId,
        amount: input.amount,
        method: input.method,
        paymentDate: input.paymentDate,
        reference: input.reference,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey,
        createdById: actorUserId,
      });
    } catch (error) {
      if (error instanceof OverPaymentError || error instanceof PaymentInvoiceConflictError) {
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
  ): Promise<{ payment: PaymentWithRelations; invoiceId: string }> {
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
