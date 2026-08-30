import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CreateCashTransactionInput, createCashTransactionSchema } from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CASH_BANK_AUDIT_ACTIONS } from '../cash-bank-audit-actions';
import { CashTransactionWithRelations } from './cash-transaction.repository';
import { CashTransactionService } from './cash-transaction.service';

/**
 * Cash Transaction HTTP surface (Sprint 14, docs/domains/cash-management.md). `GET`
 * requires only authentication; every write additionally requires the Owner or
 * Administrator role. Only emits an audit event when `wasCreated === true` — a
 * replayed idempotent request must not double-record history.
 */
@Controller('finance/cash/transactions')
@UseGuards(JwtAuthGuard)
export class CashTransactionController {
  constructor(
    private readonly cashTransactionService: CashTransactionService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload, @Query('cashAccountId') cashAccountId?: string) {
    const transactions = await this.cashTransactionService.list(user.organisationId, {
      cashAccountId,
    });
    return { items: transactions.map(toCashTransactionResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const transaction = await this.cashTransactionService.getById(user.organisationId, id);
    return toCashTransactionResponse(transaction);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createCashTransactionSchema)) body: CreateCashTransactionInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { cashTransaction, wasCreated } = await this.cashTransactionService.create(
      user.organisationId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: CASH_BANK_AUDIT_ACTIONS.CASH_TRANSACTION_CREATED,
        entityType: 'CashTransaction',
        entityId: cashTransaction.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          cashAccountId: cashTransaction.cashAccountId,
          transactionType: cashTransaction.transactionType,
          amount: cashTransaction.amount,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toCashTransactionResponse(cashTransaction);
  }

  @Post(':id/void')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async void(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const cashTransaction = await this.cashTransactionService.void(user.organisationId, id);

    await this.auditService.record({
      action: CASH_BANK_AUDIT_ACTIONS.CASH_TRANSACTION_VOIDED,
      entityType: 'CashTransaction',
      entityId: cashTransaction.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { amount: cashTransaction.amount },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCashTransactionResponse(cashTransaction);
  }
}

export function toCashTransactionResponse(transaction: CashTransactionWithRelations) {
  return {
    id: transaction.id,
    cashAccountId: transaction.cashAccountId,
    cashAccount: transaction.cashAccount,
    transactionType: transaction.transactionType,
    transactionDate: transaction.transactionDate,
    amount: transaction.amount,
    description: transaction.description,
    reference: transaction.reference,
    contraAccountId: transaction.contraAccountId,
    contraAccount: transaction.contraAccount,
    status: transaction.status,
    createdAt: transaction.createdAt,
  };
}
