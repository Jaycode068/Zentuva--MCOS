import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { DebtAnalysisService } from './debt-analysis.service';

/** Debt Overview dashboard HTTP surface (Sprint 17, docs/domains/
 *  debt-management.md §25/§26) — any authenticated read, mirrors
 *  `CashDashboardController`'s own composition-only shape. */
@Controller('finance/debt/overview')
@UseGuards(JwtAuthGuard)
export class DebtDashboardController {
  constructor(private readonly debtAnalysisService: DebtAnalysisService) {}

  @Get()
  getMetrics(@CurrentUser() user: TokenPayload) {
    return this.debtAnalysisService.getDebtMetrics(user.organisationId);
  }
}
