import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreditNoteStatus } from '@prisma/client';
import { CreateSupplierCreditNoteInput } from '@zentuva/validation';

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
  CreditNoteInvoiceConflictError,
  CreditNoteNotFoundError,
  CreditNoteStateError,
  ListSupplierCreditNotesParams,
  OverCreditError,
  SupplierCreditNoteRepository,
  SupplierCreditNoteWithRelations,
} from './supplier-credit-note.repository';

const CREDIT_NOTE_CODE_PREFIX = 'SCN';
const CREDIT_NOTE_CODE_SEQUENCE_LENGTH = 6;

/**
 * Domain service for the `SupplierCreditNote` aggregate (Sprint 12, docs/domains/
 * finance.md "Accounts Payable") — a supplier-side commercial adjustment that
 * reduces what the organisation owes. Direct structural mirror of `CreditNoteService`.
 */
@Injectable()
export class SupplierCreditNoteService {
  constructor(
    private readonly supplierCreditNoteRepository: SupplierCreditNoteRepository,
    private readonly supplierInvoiceRepository: SupplierInvoiceRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<SupplierCreditNoteWithRelations> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(
    organisationId: string,
    params?: ListSupplierCreditNotesParams,
  ): Promise<SupplierCreditNoteWithRelations[]> {
    return this.supplierCreditNoteRepository.findManyByOrganisation(organisationId, params);
  }

  /** `POST /` — creates a DRAFT credit note. No side effects yet; `issue()` is the
   *  separate action that actually applies the credit. */
  async create(
    organisationId: string,
    input: CreateSupplierCreditNoteInput,
    actorUserId: string,
  ): Promise<SupplierCreditNoteWithRelations> {
    const invoice = await this.getInvoiceOrThrow(organisationId, input.supplierInvoiceId);
    if (!PAYABLE_SUPPLIER_INVOICE_STATUSES.includes(invoice.status)) {
      throw new BadRequestException(
        'This supplier invoice is not eligible to receive a credit note',
      );
    }
    const outstanding = roundCurrency(
      invoice.recognizedAmount - invoice.amountPaid - invoice.amountCredited,
    );
    if (roundCurrency(input.amount) > outstanding) {
      throw new BadRequestException(
        `Cannot credit ${input.amount} — only ${outstanding} remains outstanding`,
      );
    }

    const creditNoteCode = await this.generateUniqueCode();
    return this.supplierCreditNoteRepository.create({
      organisation: { connect: { id: organisationId } },
      creditNoteCode,
      supplier: { connect: { id: invoice.supplierId } },
      supplierInvoice: { connect: { id: invoice.id } },
      reason: input.reason,
      amount: input.amount,
      currency: invoice.currency,
      status: CreditNoteStatus.DRAFT,
      creditNoteDate: input.creditNoteDate,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
      updatedById: actorUserId,
    });
  }

  /** `POST /:id/issue` — DRAFT -> ISSUED, atomically applies the credit to its
   *  invoice and posts `DR AP / CR Inventory`. */
  async issue(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<{ creditNote: SupplierCreditNoteWithRelations; supplierInvoiceId: string | null }> {
    try {
      return await this.supplierCreditNoteRepository.issue(organisationId, id, actorUserId);
    } catch (error) {
      if (error instanceof CreditNoteNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (
        error instanceof CreditNoteStateError ||
        error instanceof CreditNoteInvoiceConflictError ||
        error instanceof OverCreditError ||
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
  ): Promise<{ creditNote: SupplierCreditNoteWithRelations; supplierInvoiceId: string | null }> {
    try {
      const result = await this.supplierCreditNoteRepository.void(organisationId, id, actorUserId);
      if (!result) {
        throw new NotFoundException('Supplier credit note not found');
      }
      return result;
    } catch (error) {
      if (error instanceof CreditNoteStateError) {
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
  ): Promise<SupplierCreditNoteWithRelations> {
    const creditNote = await this.supplierCreditNoteRepository.findById(organisationId, id);
    if (!creditNote) {
      throw new NotFoundException('Supplier credit note not found');
    }
    return creditNote;
  }

  /** `SCN-000001`, `SCN-000002`, ... — globally unique, same collision-avoidance
   *  loop as `CreditNoteService.generateUniqueCode`. */
  private async generateUniqueCode(): Promise<string> {
    let sequence = 1;
    let candidate = formatCreditNoteCode(sequence);
    while (await this.supplierCreditNoteRepository.existsByCode(candidate)) {
      sequence += 1;
      candidate = formatCreditNoteCode(sequence);
    }
    return candidate;
  }
}

/** Rounds to 2 decimal places for currency figures — same convention used throughout
 *  this domain. */
function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatCreditNoteCode(sequence: number): string {
  return `${CREDIT_NOTE_CODE_PREFIX}-${String(sequence).padStart(CREDIT_NOTE_CODE_SEQUENCE_LENGTH, '0')}`;
}
