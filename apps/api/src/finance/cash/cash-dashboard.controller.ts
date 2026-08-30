import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CashDashboardService } from './cash-dashboard.service';

/** Cash Position Dashboard HTTP surface (Sprint 14, docs/domains/
 *  cash-management.md "Cash Position Dashboard"). Any-authenticated read only —
 *  no writes here at all. */
@Controller('finance/cash/overview')
@UseGuards(JwtAuthGuard)
export class CashDashboardController {
  constructor(private readonly cashDashboardService: CashDashboardService) {}

  @Get()
  getOverview(@CurrentUser() user: TokenPayload) {
    return this.cashDashboardService.getOverview(user.organisationId);
  }
}
