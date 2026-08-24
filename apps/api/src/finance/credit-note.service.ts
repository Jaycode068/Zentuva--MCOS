import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreditNoteStatus } from '@prisma/client';
import { CreateCreditNoteInput } from '@zentuva/validation';

import { InvoiceRepository, PAYABLE_INVOICE_STATUSES } from './invoice.repository';
import {
  CreditNoteInvoiceConflictError,
  CreditNoteNotFoundError,
  CreditNoteRepository,
  CreditNoteStateError,
  CreditNoteWithRelations,
  ListCreditNotesParams,
  OverCreditError,
} from './credit-note.repository';

const CREDIT_NOTE_CODE_PREFIX = 'CN';
const CREDIT_NOTE_CODE_SEQUENCE_LENGTH = 6;

/**
 * Domain service for the `CreditNote` aggregate (Sprint 6, docs/domains/finance.md) —
 * the financial consequence of a customer return or commercial adjustment. The physical
 * return itself belongs to Sales/Logistics/Inventory, entirely out of scope here.
 */
@Injectable()
export class CreditNoteService {
  constructor(
    private readonly creditNoteRepository: CreditNoteRepository,
    private readonly invoiceRepository: InvoiceRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<CreditNoteWithRelations> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListCreditNotesParams): Promise<CreditNoteWithRelations[]> {
    return this.creditNoteRepository.findManyByOrganisation(organisationId, params);
  }

  /** `POST /` — creates a DRAFT credit note. No side effects yet; `issue()` is the
   *  separate action that actually applies the credit to its invoice. */
  async create(
    organisationId: string,
    input: CreateCreditNoteInput,
    actorUserId: string,
  ): Promise<CreditNoteWithRelations> {
    const invoice = await this.getInvoiceOrThrow(organisationId, input.invoiceId);
    if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status)) {
      throw new BadRequestException('This invoice is not eligible to receive a credit note');
    }
    const outstanding = roundCurrency(invoice.total - invoice.amountPaid - invoice.amountCredited);
    if (roundCurrency(input.amount) > outstanding) {
      throw new BadRequestException(
        `Cannot credit ${input.amount} — only ${outstanding} remains outstanding`,
      );
    }

    const creditNoteCode = await this.generateUniqueCode();
    return this.creditNoteRepository.create({
      organisation: { connect: { id: organisationId } },
      creditNoteCode,
      customer: { connect: { id: invoice.customerId } },
      invoice: { connect: { id: invoice.id } },
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

  /** `POST /:id/issue` — DRAFT -> ISSUED, atomically applies the credit to its invoice. */
  async issue(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<{ creditNote: CreditNoteWithRelations; invoiceId: string | null }> {
    try {
      return await this.creditNoteRepository.issue(organisationId, id, actorUserId);
    } catch (error) {
      if (error instanceof CreditNoteNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (
        error instanceof CreditNoteStateError ||
        error instanceof CreditNoteInvoiceConflictError ||
        error instanceof OverCreditError
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
  ): Promise<{ creditNote: CreditNoteWithRelations; invoiceId: string | null }> {
    try {
      const result = await this.creditNoteRepository.void(organisationId, id, actorUserId);
      if (!result) {
        throw new NotFoundException('Credit note not found');
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
    const invoice = await this.invoiceRepository.findById(organisationId, id);
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  private async getByIdOrThrow(
    organisationId: string,
    id: string,
  ): Promise<CreditNoteWithRelations> {
    const creditNote = await this.creditNoteRepository.findById(organisationId, id);
    if (!creditNote) {
      throw new NotFoundException('Credit note not found');
    }
    return creditNote;
  }

  /** `CN-000001`, `CN-000002`, ... — globally unique, same collision-avoidance loop as
   *  `InvoiceService.generateUniqueCode`. */
  private async generateUniqueCode(): Promise<string> {
    let sequence = 1;
    let candidate = formatCreditNoteCode(sequence);
    while (await this.creditNoteRepository.existsByCode(candidate)) {
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
