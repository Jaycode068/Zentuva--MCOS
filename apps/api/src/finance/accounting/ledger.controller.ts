import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JournalEntryStatus } from '@prisma/client';

import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { LedgerService } from './ledger.service';

/**
 * General Ledger / Trial Balance / Account Activity HTTP surface (Sprint 7,
 * docs/domains/accounting.md §15–17). Entirely read-only — auth-only, no `RolesGuard`,
 * Member has full read access, same convention as `AccountsReceivableController`.
 */
@Controller('finance')
@UseGuards(JwtAuthGuard)
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @Get('ledger')
  async getLedger(
    @CurrentUser() user: TokenPayload,
    @Query('accountId') accountId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('accountingPeriodId') accountingPeriodId?: string,
    @Query('sourceType') sourceType?: string,
    @Query('reference') reference?: string,
    @Query('status') status?: JournalEntryStatus,
  ) {
    const items = await this.ledgerService.getLedger(user.organisationId, {
      accountId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      accountingPeriodId,
      sourceType,
      reference,
      status,
    });
    return { items };
  }

  @Get('trial-balance')
  async getTrialBalance(
    @CurrentUser() user: TokenPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('accountingPeriodId') accountingPeriodId?: string,
  ) {
    return this.ledgerService.getTrialBalance(user.organisationId, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      accountingPeriodId,
    });
  }

  @Get('accounts/:id/activity')
  async getAccountActivity(
    @CurrentUser() user: TokenPayload,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.ledgerService.getAccountActivity(user.organisationId, id, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }
}
