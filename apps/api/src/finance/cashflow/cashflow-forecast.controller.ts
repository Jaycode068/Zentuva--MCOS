import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { cashflowForecastQuerySchema } from '@zentuva/validation';

import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CashflowForecastService } from './cashflow-forecast.service';

/**
 * Cashflow Forecast HTTP surface (Sprint 15, docs/domains/cashflow.md) — a pure
 * read, any-authenticated. Never audited (a forecast view changes nothing) — see
 * `cashflow-audit-actions.ts`'s own doc comment.
 */
@Controller('finance/cashflow')
@UseGuards(JwtAuthGuard)
export class CashflowForecastController {
  constructor(private readonly cashflowForecastService: CashflowForecastService) {}

  @Get('forecast')
  getForecast(
    @CurrentUser() user: TokenPayload,
    @Query('horizonDays') horizonDays?: string,
    @Query('bucketBy') bucketBy?: string,
    @Query('scenarioId') scenarioId?: string,
    @Query('cashAccountId') cashAccountId?: string,
  ) {
    const parsed = cashflowForecastQuerySchema.parse({
      horizonDays,
      bucketBy,
      scenarioId,
      cashAccountId,
    });
    return this.cashflowForecastService.getForecast(user.organisationId, parsed);
  }

  @Get('accounts/breakdown')
  getCashAccountBreakdown(
    @CurrentUser() user: TokenPayload,
    @Query('horizonDays') horizonDays?: string,
  ) {
    return this.cashflowForecastService.getCashAccountBreakdown(
      user.organisationId,
      horizonDays ? Number(horizonDays) : 90,
    );
  }
}
