import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CreateSupplierCreditNoteInput, createSupplierCreditNoteSchema } from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { ACCOUNTS_PAYABLE_AUDIT_ACTIONS } from './accounts-payable-audit-actions';
import { SupplierCreditNoteWithRelations } from './supplier-credit-note.repository';
import { SupplierCreditNoteService } from './supplier-credit-note.service';

/**
 * Supplier Credit Note HTTP surface (Sprint 12, docs/domains/finance.md "Accounts
 * Payable"). `GET` requires only authentication; every write additionally requires
 * the Owner or Administrator role.
 */
@Controller('finance/supplier-credit-notes')
@UseGuards(JwtAuthGuard)
export class SupplierCreditNoteController {
  constructor(
    private readonly supplierCreditNoteService: SupplierCreditNoteService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('supplierId') supplierId?: string,
    @Query('supplierInvoiceId') supplierInvoiceId?: string,
  ) {
    const creditNotes = await this.supplierCreditNoteService.list(user.organisationId, {
      supplierId,
      supplierInvoiceId,
    });
    return { items: creditNotes.map(toSupplierCreditNoteResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const creditNote = await this.supplierCreditNoteService.getById(user.organisationId, id);
    return toSupplierCreditNoteResponse(creditNote);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createSupplierCreditNoteSchema))
    body: CreateSupplierCreditNoteInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const created = await this.supplierCreditNoteService.create(
      user.organisationId,
      body,
      user.sub,
    );

    await this.auditService.record({
      action: ACCOUNTS_PAYABLE_AUDIT_ACTIONS.SUPPLIER_CREDIT_NOTE_CREATED,
      entityType: 'SupplierCreditNote',
      entityId: created.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: {
        creditNoteCode: created.creditNoteCode,
        supplierInvoiceId: created.supplierInvoiceId,
        amount: created.amount,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toSupplierCreditNoteResponse(created);
  }

  @Post(':id/issue')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async issue(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const { creditNote, supplierInvoiceId } = await this.supplierCreditNoteService.issue(
      user.organisationId,
      id,
      user.sub,
    );

    await this.auditService.record({
      action: ACCOUNTS_PAYABLE_AUDIT_ACTIONS.SUPPLIER_CREDIT_NOTE_ISSUED,
      entityType: 'SupplierCreditNote',
      entityId: creditNote.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: {
        creditNoteCode: creditNote.creditNoteCode,
        supplierInvoiceId,
        amount: creditNote.amount,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toSupplierCreditNoteResponse(creditNote);
  }

  @Post(':id/void')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async void(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const { creditNote, supplierInvoiceId } = await this.supplierCreditNoteService.void(
      user.organisationId,
      id,
      user.sub,
    );

    await this.auditService.record({
      action: ACCOUNTS_PAYABLE_AUDIT_ACTIONS.SUPPLIER_CREDIT_NOTE_VOIDED,
      entityType: 'SupplierCreditNote',
      entityId: creditNote.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: {
        creditNoteCode: creditNote.creditNoteCode,
        supplierInvoiceId,
        amount: creditNote.amount,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toSupplierCreditNoteResponse(creditNote);
  }
}

export function toSupplierCreditNoteResponse(creditNote: SupplierCreditNoteWithRelations) {
  return {
    id: creditNote.id,
    creditNoteCode: creditNote.creditNoteCode,
    supplier: creditNote.supplier,
    supplierInvoice: creditNote.supplierInvoice,
    supplierInvoiceId: creditNote.supplierInvoiceId,
    reason: creditNote.reason,
    amount: creditNote.amount,
    currency: creditNote.currency,
    status: creditNote.status,
    creditNoteDate: creditNote.creditNoteDate,
    notes: creditNote.notes,
    createdAt: creditNote.createdAt,
    updatedAt: creditNote.updatedAt,
  };
}
