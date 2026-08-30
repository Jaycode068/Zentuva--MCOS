import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  CreateBankReconciliationInput,
  MatchReconciliationInput,
  createBankReconciliationSchema,
  matchReconciliationSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CASH_BANK_AUDIT_ACTIONS } from '../cash-bank-audit-actions';
import { BankReconciliationService, ReconciliationDetail } from './bank-reconciliation.service';

/**
 * Bank Reconciliation HTTP surface (Sprint 14, docs/domains/cash-management.md
 * "Reconciliation") — the core feature of this sprint. `GET` requires only
 * authentication; every write additionally requires the Owner or Administrator
 * role. `match`/`complete` are idempotent-by-construction (a replay of an already
 * -applied match/an already-completed session returns the existing state rather
 * than erroring) — see `bank-reconciliation.repository.ts`.
 */
@Controller('finance/cash/reconciliations')
@UseGuards(JwtAuthGuard)
export class BankReconciliationController {
  constructor(
    private readonly bankReconciliationService: BankReconciliationService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload, @Query('cashAccountId') cashAccountId?: string) {
    const items = await this.bankReconciliationService.list(user.organisationId, cashAccountId);
    return { items: items.map(toBankReconciliationResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const detail = await this.bankReconciliationService.getDetail(user.organisationId, id);
    return toReconciliationDetailResponse(detail);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createBankReconciliationSchema))
    body: CreateBankReconciliationInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { bankReconciliation, wasCreated } = await this.bankReconciliationService.create(
      user.organisationId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: CASH_BANK_AUDIT_ACTIONS.BANK_RECONCILIATION_CREATED,
        entityType: 'BankReconciliation',
        entityId: bankReconciliation.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          cashAccountId: bankReconciliation.cashAccountId,
          periodStart: bankReconciliation.periodStart,
          periodEnd: bankReconciliation.periodEnd,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toBankReconciliationResponse(bankReconciliation);
  }

  @Post(':id/auto-match')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async autoMatch(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const result = await this.bankReconciliationService.autoMatch(
      user.organisationId,
      id,
      user.sub,
    );

    if (result.matchedCount > 0) {
      await this.auditService.record({
        action: CASH_BANK_AUDIT_ACTIONS.BANK_RECONCILIATION_AUTO_MATCHED,
        entityType: 'BankReconciliation',
        entityId: id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { matchedCount: result.matchedCount },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return result;
  }

  @Post(':id/match')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async match(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(matchReconciliationSchema)) body: MatchReconciliationInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { match, wasCreated } = await this.bankReconciliationService.match(
      user.organisationId,
      id,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: CASH_BANK_AUDIT_ACTIONS.BANK_RECONCILIATION_MATCHED,
        entityType: 'BankReconciliation',
        entityId: id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { matchId: match.id },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return match;
  }

  @Post(':id/unmatch/:matchId')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async unmatch(
    @Param('id') id: string,
    @Param('matchId') matchId: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    await this.bankReconciliationService.unmatch(user.organisationId, id, matchId);

    await this.auditService.record({
      action: CASH_BANK_AUDIT_ACTIONS.BANK_RECONCILIATION_UNMATCHED,
      entityType: 'BankReconciliation',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { matchId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return { success: true };
  }

  @Post(':id/complete')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async complete(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const before = await this.bankReconciliationService.getDetail(user.organisationId, id);
    const wasAlreadyCompleted = before.reconciliation.status === 'COMPLETED';

    const bankReconciliation = await this.bankReconciliationService.complete(
      user.organisationId,
      id,
      user.sub,
    );

    if (!wasAlreadyCompleted) {
      await this.auditService.record({
        action: CASH_BANK_AUDIT_ACTIONS.BANK_RECONCILIATION_COMPLETED,
        entityType: 'BankReconciliation',
        entityId: bankReconciliation.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          cashAccountId: bankReconciliation.cashAccountId,
          closingBankBalance: bankReconciliation.closingBankBalance,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toBankReconciliationResponse(bankReconciliation);
  }
}

export function toBankReconciliationResponse(reconciliation: {
  id: string;
  cashAccountId: string;
  periodStart: Date;
  periodEnd: Date;
  openingBankBalance: number;
  closingBankBalance: number;
  status: string;
  reconciledById: string | null;
  reconciledAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: reconciliation.id,
    cashAccountId: reconciliation.cashAccountId,
    periodStart: reconciliation.periodStart,
    periodEnd: reconciliation.periodEnd,
    openingBankBalance: reconciliation.openingBankBalance,
    closingBankBalance: reconciliation.closingBankBalance,
    status: reconciliation.status,
    reconciledById: reconciliation.reconciledById,
    reconciledAt: reconciliation.reconciledAt,
    createdAt: reconciliation.createdAt,
  };
}

function toReconciliationDetailResponse(detail: ReconciliationDetail) {
  return {
    ...toBankReconciliationResponse(detail.reconciliation),
    bookBalance: detail.bookBalance,
    difference: detail.difference,
    matches: detail.matches.map((match) => ({
      id: match.id,
      matchType: match.matchType,
      matchedAt: match.matchedAt,
      bankStatementTransaction: {
        id: match.bankStatementTransaction.id,
        transactionDate: match.bankStatementTransaction.transactionDate,
        description: match.bankStatementTransaction.description,
        reference: match.bankStatementTransaction.reference,
        debit: match.bankStatementTransaction.debit,
        credit: match.bankStatementTransaction.credit,
        amount: match.bankStatementTransaction.amount,
      },
      journalEntryLine: {
        id: match.journalEntryLine.id,
        debit: match.journalEntryLine.debit,
        credit: match.journalEntryLine.credit,
        description: match.journalEntryLine.description,
        journalEntryId: match.journalEntryLine.journalEntry.id,
        journalNumber: match.journalEntryLine.journalEntry.journalNumber,
        date: match.journalEntryLine.journalEntry.date,
      },
    })),
    unmatchedBank: detail.unmatchedBank.map((transaction) => ({
      id: transaction.id,
      transactionDate: transaction.transactionDate,
      description: transaction.description,
      reference: transaction.reference,
      debit: transaction.debit,
      credit: transaction.credit,
      amount: transaction.amount,
    })),
    unmatchedBook: detail.unmatchedBook.map((line) => ({
      id: line.id,
      debit: line.debit,
      credit: line.credit,
      description: line.description,
      journalEntryId: line.journalEntryId,
      journalNumber: line.journalNumber,
      date: line.date,
    })),
  };
}
