import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CreateCreditNoteInput, createCreditNoteSchema } from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { CreditNoteWithRelations } from './credit-note.repository';
import { CreditNoteService } from './credit-note.service';
import { FINANCE_AUDIT_ACTIONS } from './finance-audit-actions';
import { RequirePermission } from '../identity/auth/decorators/require-permission.decorator';
import { PermissionsGuard } from '../identity/auth/guards/permissions.guard';

/**
 * Credit Note HTTP surface (Sprint 6, docs/domains/finance.md). `GET` requires only
 * authentication — Member has read-only access; every write additionally requires the
 * Owner or Administrator role.
 */
@Controller('finance/credit-notes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CreditNoteController {
  constructor(
    private readonly creditNoteService: CreditNoteService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission('finance.credit_note.view')
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('customerId') customerId?: string,
    @Query('invoiceId') invoiceId?: string,
  ) {
    const creditNotes = await this.creditNoteService.list(user.organisationId, {
      customerId,
      invoiceId,
    });
    return { items: creditNotes.map(toCreditNoteResponse) };
  }

  @Get(':id')
  @RequirePermission('finance.credit_note.view')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const creditNote = await this.creditNoteService.getById(user.organisationId, id);
    return toCreditNoteResponse(creditNote);
  }

  @Post()
  @RequirePermission('finance.credit_note.manage')
  async create(
    @Body(new ZodValidationPipe(createCreditNoteSchema)) body: CreateCreditNoteInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const created = await this.creditNoteService.create(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: FINANCE_AUDIT_ACTIONS.CREDIT_NOTE_CREATED,
      entityType: 'CreditNote',
      entityId: created.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: {
        creditNoteCode: created.creditNoteCode,
        invoiceId: created.invoiceId,
        amount: created.amount,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCreditNoteResponse(created);
  }

  @Post(':id/issue')
  @RequirePermission('finance.credit_note.manage')
  async issue(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const { creditNote, invoiceId } = await this.creditNoteService.issue(
      user.organisationId,
      id,
      user.sub,
    );

    await this.auditService.record({
      action: FINANCE_AUDIT_ACTIONS.CREDIT_NOTE_ISSUED,
      entityType: 'CreditNote',
      entityId: creditNote.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { creditNoteCode: creditNote.creditNoteCode, invoiceId, amount: creditNote.amount },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCreditNoteResponse(creditNote);
  }

  @Post(':id/void')
  @RequirePermission('finance.credit_note.manage')
  async void(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const { creditNote, invoiceId } = await this.creditNoteService.void(
      user.organisationId,
      id,
      user.sub,
    );

    await this.auditService.record({
      action: FINANCE_AUDIT_ACTIONS.CREDIT_NOTE_VOIDED,
      entityType: 'CreditNote',
      entityId: creditNote.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { creditNoteCode: creditNote.creditNoteCode, invoiceId, amount: creditNote.amount },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCreditNoteResponse(creditNote);
  }
}

export function toCreditNoteResponse(creditNote: CreditNoteWithRelations) {
  return {
    id: creditNote.id,
    creditNoteCode: creditNote.creditNoteCode,
    customer: creditNote.customer,
    invoice: creditNote.invoice,
    invoiceId: creditNote.invoiceId,
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
