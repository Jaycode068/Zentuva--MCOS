import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { DashboardService } from './dashboard.service';

/**
 * Management Dashboard HTTP surface (Sprint 13, docs/domains/accounting.md §16.5).
 * Entirely read-only — auth-only, no `RolesGuard`.
 */
@Controller('finance/reports')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('dashboard')
  async getDashboard(
    @CurrentUser() user: TokenPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('compare') compare?: string,
  ) {
    return this.dashboardService.getDashboard(user.organisationId, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : new Date(),
      compare: compare === 'previous_period',
    });
  }
}
