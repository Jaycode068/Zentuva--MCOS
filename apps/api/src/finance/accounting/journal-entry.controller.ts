import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JournalEntryStatus } from '@prisma/client';
import { CreateJournalEntryInput, createJournalEntrySchema } from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { ACCOUNTING_AUDIT_ACTIONS } from './accounting-audit-actions';
import { JournalEntryWithRelations } from './journal-entry.repository';
import { JournalEntryService } from './journal-entry.service';

/**
 * Journal Entry HTTP surface (Sprint 7, docs/domains/accounting.md) — manually-created
 * entries only. `GET` requires only authentication; every write additionally requires
 * Owner or Administrator.
 */
@Controller('finance/journal-entries')
@UseGuards(JwtAuthGuard)
export class JournalEntryController {
  constructor(
    private readonly journalEntryService: JournalEntryService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: JournalEntryStatus,
    @Query('sourceType') sourceType?: string,
    @Query('accountingPeriodId') accountingPeriodId?: string,
  ) {
    const entries = await this.journalEntryService.list(user.organisationId, {
      status,
      sourceType,
      accountingPeriodId,
    });
    return { items: entries.map(toJournalEntryResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const entry = await this.journalEntryService.getById(user.organisationId, id);
    return toJournalEntryResponse(entry);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createJournalEntrySchema)) body: CreateJournalEntryInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const created = await this.journalEntryService.create(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: ACCOUNTING_AUDIT_ACTIONS.JOURNAL_ENTRY_CREATED,
      entityType: 'JournalEntry',
      entityId: created.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { journalNumber: created.journalNumber, description: created.description },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toJournalEntryResponse(created);
  }

  @Post(':id/post')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async post(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.journalEntryService.post(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: ACCOUNTING_AUDIT_ACTIONS.JOURNAL_ENTRY_POSTED,
      entityType: 'JournalEntry',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { journalNumber: updated.journalNumber },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toJournalEntryResponse(updated);
  }

  @Post(':id/void')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async void(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.journalEntryService.void(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: ACCOUNTING_AUDIT_ACTIONS.JOURNAL_ENTRY_VOIDED,
      entityType: 'JournalEntry',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { journalNumber: updated.journalNumber },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toJournalEntryResponse(updated);
  }
}

export function toJournalEntryResponse(entry: JournalEntryWithRelations) {
  return {
    id: entry.id,
    journalNumber: entry.journalNumber,
    date: entry.date,
    accountingPeriod: entry.accountingPeriod,
    description: entry.description,
    reference: entry.reference,
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    status: entry.status,
    postedAt: entry.postedAt,
    lines: entry.lines.map((line) => ({
      id: line.id,
      account: line.account,
      description: line.description,
      debit: line.debit,
      credit: line.credit,
    })),
    createdAt: entry.createdAt,
  };
}
