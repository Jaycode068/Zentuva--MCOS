import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { FinancialStatementService } from './financial-statement.service';

/**
 * Profit & Loss / Balance Sheet HTTP surface (Sprint 13, docs/domains/accounting.md
 * §16). Entirely read-only — auth-only, no `RolesGuard`, Member has full read access,
 * same convention as every other Finance reporting endpoint (`LedgerController`,
 * `AccountsReceivableController`).
 */
@Controller('finance/reports')
@UseGuards(JwtAuthGuard)
export class FinancialStatementController {
  constructor(private readonly financialStatementService: FinancialStatementService) {}

  @Get('profit-loss')
  async getProfitAndLoss(
    @CurrentUser() user: TokenPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('accountingPeriodId') accountingPeriodId?: string,
    @Query('compare') compare?: string,
  ) {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : undefined;

    if (compare === 'previous_period' && fromDate) {
      return this.financialStatementService.getProfitAndLossComparison(user.organisationId, {
        from: fromDate,
        to: toDate,
      });
    }

    const current = await this.financialStatementService.getProfitAndLoss(user.organisationId, {
      from: fromDate,
      to: toDate,
      accountingPeriodId,
    });
    return { current, previous: null };
  }

  @Get('balance-sheet')
  async getBalanceSheet(@CurrentUser() user: TokenPayload, @Query('asOf') asOf?: string) {
    return this.financialStatementService.getBalanceSheet(user.organisationId, {
      asOf: asOf ? new Date(asOf) : new Date(),
    });
  }
}
