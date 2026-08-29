import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentTermType, SupplierInvoiceStatus } from '@prisma/client';
import { CreateSupplierInvoiceInput, UpdateSupplierInvoiceInput } from '@zentuva/validation';

import { OrganisationService } from '../identity/organisation/organisation.service';
import { PurchaseOrderRepository } from '../procurement/purchase-order/purchase-order.repository';
import { SupplierRepository } from '../suppliers/supplier/supplier.repository';
import {
  MissingSystemAccountError,
  NoOpenPeriodError,
  UnbalancedPostingError,
} from './accounting/journal-posting';
import { InvalidDebitAccountError } from './supplier-invoice-matching';
import {
  CreateSupplierInvoiceResult,
  InvalidGoodsReceiptReferenceError,
  ListSupplierInvoicesParams,
  MissingLineReferenceError,
  PostSupplierInvoiceResult,
  SupplierInvoiceConflictError,
  SupplierInvoiceRepository,
  SupplierInvoiceWithRelations,
} from './supplier-invoice.repository';

const PAYMENT_TERM_DAYS: Record<PaymentTermType, number> = {
  CASH: 0,
  DUE_ON_RECEIPT: 0,
  NET_7: 7,
  NET_14: 14,
  NET_30: 30,
};

/**
 * Domain service for `SupplierInvoice` (Sprint 12, docs/domains/finance.md "Accounts
 * Payable"). Reads `Supplier`/`PurchaseOrder` identity only through their exported
 * repositories (ADR-002) — never writes into either domain's tables, and never
 * imports `InventoryModule` at all (`SupplierInvoiceRepository` reaches directly into
 * `GoodsReceiptItem` inside its own self-owned transaction, the same precedent
 * `SupplierReturnRepository`/`CustomerReturnRepository` already established in
 * Sprint 11 — see `accounts-payable-independence.spec.ts`).
 */
@Injectable()
export class SupplierInvoiceService {
  constructor(
    private readonly supplierInvoiceRepository: SupplierInvoiceRepository,
    private readonly supplierRepository: SupplierRepository,
    private readonly purchaseOrderRepository: PurchaseOrderRepository,
    private readonly organisationService: OrganisationService,
  ) {}

  async getById(organisationId: string, id: string): Promise<SupplierInvoiceWithRelations> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(
    organisationId: string,
    params?: ListSupplierInvoicesParams,
  ): Promise<SupplierInvoiceWithRelations[]> {
    return this.supplierInvoiceRepository.findManyByOrganisation(organisationId, params);
  }

  /** `POST /finance/supplier-invoices` — captures a DRAFT. Free-form by design (brief
   *  §15): a line may be entered with no `goodsReceiptItemId`/`debitAccountId` at all
   *  yet, resolved later before `post()`. */
  async create(
    organisationId: string,
    input: CreateSupplierInvoiceInput,
    actorUserId: string,
  ): Promise<CreateSupplierInvoiceResult> {
    // Idempotency short-circuit — checked first, before the duplicate-invoice-number
    // business-rule pre-check below (Sprint 9→10 lesson): a genuine retry's own
    // prior effect (the invoice number it already claimed) would otherwise cause
    // that same pre-check to reject the very call that should idempotently succeed.
    if (input.idempotencyKey) {
      const existing = await this.supplierInvoiceRepository.findByIdempotencyKey(
        organisationId,
        input.supplierId,
        input.idempotencyKey,
      );
      if (existing) {
        return { supplierInvoice: existing, wasCreated: false };
      }
    }

    const supplier = await this.supplierRepository.findById(organisationId, input.supplierId);
    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }
    if (input.purchaseOrderId) {
      const purchaseOrder = await this.purchaseOrderRepository.findById(
        organisationId,
        input.purchaseOrderId,
      );
      if (!purchaseOrder) {
        throw new NotFoundException('Purchase order not found');
      }
      if (purchaseOrder.supplierId !== input.supplierId) {
        throw new BadRequestException('This purchase order does not belong to that supplier');
      }
    }

    const duplicate = await this.supplierInvoiceRepository.existsByNumber(
      input.supplierId,
      input.invoiceNumber,
    );
    if (duplicate) {
      throw new BadRequestException(
        `Supplier invoice "${input.invoiceNumber}" already exists for this supplier`,
      );
    }

    const currency = await this.getOrganisationCurrency(organisationId);

    return this.supplierInvoiceRepository.create({
      organisationId,
      supplierId: input.supplierId,
      purchaseOrderId: input.purchaseOrderId,
      invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate,
      dueDate: computeDueDate(input.invoiceDate, input.paymentTerms),
      paymentTerms: input.paymentTerms,
      currency,
      taxAmount: input.taxAmount,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
      items: input.items,
    });
  }

  /** `PATCH /:id` — DRAFT only. */
  async update(
    organisationId: string,
    id: string,
    input: UpdateSupplierInvoiceInput,
    actorUserId: string,
  ): Promise<SupplierInvoiceWithRelations> {
    if (input.purchaseOrderId) {
      const purchaseOrder = await this.purchaseOrderRepository.findById(
        organisationId,
        input.purchaseOrderId,
      );
      if (!purchaseOrder) {
        throw new NotFoundException('Purchase order not found');
      }
    }
    try {
      const updated = await this.supplierInvoiceRepository.update(
        organisationId,
        id,
        {
          purchaseOrderId: input.purchaseOrderId,
          invoiceNumber: input.invoiceNumber,
          invoiceDate: input.invoiceDate,
          dueDate: input.invoiceDate
            ? computeDueDate(input.invoiceDate, input.paymentTerms ?? PaymentTermType.NET_30)
            : undefined,
          paymentTerms: input.paymentTerms,
          taxAmount: input.taxAmount,
          notes: input.notes,
          items: input.items,
        },
        actorUserId,
      );
      if (!updated) {
        throw new NotFoundException('Supplier invoice not found');
      }
      return updated;
    } catch (error) {
      if (error instanceof SupplierInvoiceConflictError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /** `POST /:id/post` — the one-way `DRAFT -> POSTED` transition (brief §5/§20). */
  async post(
    organisationId: string,
    id: string,
    actorUserId: string,
    postIdempotencyKey?: string,
  ): Promise<PostSupplierInvoiceResult> {
    try {
      return await this.supplierInvoiceRepository.post(
        organisationId,
        id,
        actorUserId,
        postIdempotencyKey,
      );
    } catch (error) {
      if (
        error instanceof SupplierInvoiceConflictError ||
        error instanceof InvalidGoodsReceiptReferenceError ||
        error instanceof MissingLineReferenceError ||
        error instanceof InvalidDebitAccountError
      ) {
        throw new BadRequestException(error.message);
      }
      // The accounting posting's own guards, propagated from inside the same
      // transaction — the whole posting rolls back with it.
      if (
        error instanceof NoOpenPeriodError ||
        error instanceof MissingSystemAccountError ||
        error instanceof UnbalancedPostingError
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /** `POST /:id/acknowledge-discrepancy` — Owner/Administrator sign-off only. */
  async acknowledgeDiscrepancy(
    organisationId: string,
    id: string,
    actorUserId: string,
    notes?: string,
  ): Promise<SupplierInvoiceWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (existing.matchStatus !== 'DISCREPANCY') {
      throw new BadRequestException('This invoice has no discrepancy to acknowledge');
    }
    const updated = await this.supplierInvoiceRepository.acknowledgeDiscrepancy(
      organisationId,
      id,
      actorUserId,
      notes,
    );
    if (!updated) {
      throw new NotFoundException('Supplier invoice not found');
    }
    return updated;
  }

  /** `POST /:id/void` — `DRAFT` freely; `POSTED`/`OVERDUE` only while nothing has
   *  been paid or credited yet. Mirrors `InvoiceService.void()` exactly. */
  async void(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<SupplierInvoiceWithRelations> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (existing.status === SupplierInvoiceStatus.VOID) {
      throw new BadRequestException('This supplier invoice has already been voided');
    }
    if (existing.status === SupplierInvoiceStatus.PAID) {
      throw new BadRequestException('A fully paid supplier invoice cannot be voided');
    }
    if (
      existing.status !== SupplierInvoiceStatus.DRAFT &&
      (existing.amountPaid > 0 || existing.amountCredited > 0)
    ) {
      throw new BadRequestException(
        'Cannot void a supplier invoice once a payment or credit note has been applied — issue a supplier credit note instead',
      );
    }

    const updated = await this.supplierInvoiceRepository.void(
      organisationId,
      id,
      [SupplierInvoiceStatus.DRAFT, SupplierInvoiceStatus.POSTED, SupplierInvoiceStatus.OVERDUE],
      actorUserId,
    );
    if (!updated) {
      throw new NotFoundException('Supplier invoice not found');
    }
    return updated;
  }

  private async getByIdOrThrow(
    organisationId: string,
    id: string,
  ): Promise<SupplierInvoiceWithRelations> {
    const invoice = await this.supplierInvoiceRepository.findById(organisationId, id);
    if (!invoice) {
      throw new NotFoundException('Supplier invoice not found');
    }
    return invoice;
  }

  /** Snapshotted onto every new financial record at creation time — same rule as
   *  `InvoiceService.getOrganisationCurrency`. */
  private async getOrganisationCurrency(organisationId: string): Promise<string> {
    const organisation = await this.organisationService.getById(organisationId);
    return organisation?.currency ?? 'NGN';
  }
}

function computeDueDate(invoiceDate: Date, paymentTerms: PaymentTermType): Date {
  const due = new Date(invoiceDate);
  due.setDate(due.getDate() + PAYMENT_TERM_DAYS[paymentTerms]);
  return due;
}
