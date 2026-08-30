import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CashAccount, CashAccountStatus, CashAccountType } from '@prisma/client';
import {
  CreateCashAccountInput,
  UpdateCashAccountInput,
  createCashAccountSchema,
  updateCashAccountSchema,
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
import { CashAccountService } from './cash-account.service';

/**
 * Cash Account HTTP surface (Sprint 14, docs/domains/cash-management.md). `GET`
 * requires only authentication; every write additionally requires the Owner or
 * Administrator role. `accountNumber` is never returned by `list()`/`getOne()` — see
 * `toCashAccountResponse`'s masking — only `GET /:id/account-number` (also
 * Owner/Administrator only) reveals the full value, and its own audit event carries
 * no metadata payload (never the number itself).
 */
@Controller('finance/cash/accounts')
@UseGuards(JwtAuthGuard)
export class CashAccountController {
  constructor(
    private readonly cashAccountService: CashAccountService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: CashAccountStatus,
    @Query('accountType') accountType?: CashAccountType,
  ) {
    const accounts = await this.cashAccountService.list(user.organisationId, {
      status,
      accountType,
    });
    return { items: accounts.map(toCashAccountResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const account = await this.cashAccountService.getById(user.organisationId, id);
    return toCashAccountResponse(account);
  }

  @Get(':id/account-number')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async getAccountNumber(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const accountNumber = await this.cashAccountService.getAccountNumber(user.organisationId, id);

    await this.auditService.record({
      action: CASH_BANK_AUDIT_ACTIONS.CASH_ACCOUNT_NUMBER_REVEALED,
      entityType: 'CashAccount',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return { accountNumber };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createCashAccountSchema)) body: CreateCashAccountInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { cashAccount, wasCreated } = await this.cashAccountService.create(
      user.organisationId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: CASH_BANK_AUDIT_ACTIONS.CASH_ACCOUNT_CREATED,
        entityType: 'CashAccount',
        entityId: cashAccount.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          accountCode: cashAccount.accountCode,
          name: cashAccount.name,
          accountType: cashAccount.accountType,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      if (cashAccount.openingBalance > 0) {
        await this.auditService.record({
          action: CASH_BANK_AUDIT_ACTIONS.CASH_OPENING_BALANCE_POSTED,
          entityType: 'CashAccount',
          entityId: cashAccount.id,
          organisationId: user.organisationId,
          actorUserId: user.sub,
          metadata: { openingBalance: cashAccount.openingBalance },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }
    }

    return toCashAccountResponse(cashAccount);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCashAccountSchema)) body: UpdateCashAccountInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.cashAccountService.update(user.organisationId, id, body, user.sub);

    await this.auditService.record({
      action: CASH_BANK_AUDIT_ACTIONS.CASH_ACCOUNT_UPDATED,
      entityType: 'CashAccount',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { accountCode: updated.accountCode },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCashAccountResponse(updated);
  }

  @Post(':id/deactivate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.cashAccountService.deactivate(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: CASH_BANK_AUDIT_ACTIONS.CASH_ACCOUNT_DEACTIVATED,
      entityType: 'CashAccount',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { accountCode: updated.accountCode },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCashAccountResponse(updated);
  }

  @Post(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.cashAccountService.activate(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: CASH_BANK_AUDIT_ACTIONS.CASH_ACCOUNT_ACTIVATED,
      entityType: 'CashAccount',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { accountCode: updated.accountCode },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCashAccountResponse(updated);
  }
}

/** Last 4 digits only, e.g. `"••••3456"` — `null` when no account number is on
 *  file. See docs/domains/cash-management.md "Bank Account Security". */
function maskAccountNumber(accountNumber: string | null): string | null {
  if (!accountNumber) {
    return null;
  }
  const last4 = accountNumber.slice(-4);
  return `••••${last4}`;
}

export function toCashAccountResponse(account: CashAccount) {
  return {
    id: account.id,
    accountCode: account.accountCode,
    name: account.name,
    accountType: account.accountType,
    currency: account.currency,
    bankName: account.bankName,
    accountNumberMasked: maskAccountNumber(account.accountNumber),
    accountName: account.accountName,
    description: account.description,
    status: account.status,
    linkedChartOfAccountId: account.linkedChartOfAccountId,
    openingBalance: account.openingBalance,
    openingBalanceDate: account.openingBalanceDate,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
