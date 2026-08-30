import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateSupplierPaymentInput } from '@zentuva/validation';

import {
  MissingSystemAccountError,
  NoOpenPeriodError,
  UnbalancedPostingError,
} from './accounting/journal-posting';
import {
  PAYABLE_SUPPLIER_INVOICE_STATUSES,
  SupplierInvoiceRepository,
} from './supplier-invoice.repository';
import {
  CreateSupplierPaymentResult,
  InvalidCashAccountError,
  ListSupplierPaymentsParams,
  OverPaymentError,
  PaymentAlreadyVoidedError,
  PaymentInvoiceConflictError,
  SupplierPaymentRepository,
  SupplierPaymentWithRelations,
} from './supplier-payment.repository';

/**
 * Domain service for the `SupplierPayment` aggregate (Sprint 12, docs/domains/
 * finance.md "Accounts Payable") — direct structural mirror of `PaymentService`.
 */
@Injectable()
export class SupplierPaymentService {
  constructor(
    private readonly supplierPaymentRepository: SupplierPaymentRepository,
    private readonly supplierInvoiceRepository: SupplierInvoiceRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<SupplierPaymentWithRelations> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(
    organisationId: string,
    params?: ListSupplierPaymentsParams,
  ): Promise<SupplierPaymentWithRelations[]> {
    return this.supplierPaymentRepository.findManyByOrganisation(organisationId, params);
  }

  /** `POST /` — mirrors `PaymentService.create()`'s exact three-part pre-check shape
   *  (invoice eligibility -> over-payment against `recognizedAmount`), then delegates
   *  to the atomic write. */
  async create(
    organisationId: string,
    input: CreateSupplierPaymentInput,
    actorUserId: string,
  ): Promise<CreateSupplierPaymentResult> {
    const invoice = await this.getInvoiceOrThrow(organisationId, input.supplierInvoiceId);
    if (!PAYABLE_SUPPLIER_INVOICE_STATUSES.includes(invoice.status)) {
      throw new BadRequestException('This supplier invoice is not eligible to receive a payment');
    }

    const outstanding = roundCurrency(
      invoice.recognizedAmount - invoice.amountPaid - invoice.amountCredited,
    );
    if (roundCurrency(input.amount) > outstanding) {
      throw new BadRequestException(
        `Cannot record a payment of ${input.amount} — only ${outstanding} remains outstanding`,
      );
    }

    try {
      return await this.supplierPaymentRepository.create({
        organisationId,
        supplierId: invoice.supplierId,
        supplierInvoiceId: input.supplierInvoiceId,
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
  ): Promise<{ supplierPayment: SupplierPaymentWithRelations; supplierInvoiceId: string }> {
    try {
      const result = await this.supplierPaymentRepository.void(organisationId, id, actorUserId);
      if (!result) {
        throw new NotFoundException('Supplier payment not found');
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
    const invoice = await this.supplierInvoiceRepository.findById(organisationId, id);
    if (!invoice) {
      throw new NotFoundException('Supplier invoice not found');
    }
    return invoice;
  }

  private async getByIdOrThrow(
    organisationId: string,
    id: string,
  ): Promise<SupplierPaymentWithRelations> {
    const payment = await this.supplierPaymentRepository.findById(organisationId, id);
    if (!payment) {
      throw new NotFoundException('Supplier payment not found');
    }
    return payment;
  }
}

/** Rounds to 2 decimal places for currency figures — same convention used throughout
 *  this domain. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
