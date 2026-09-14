import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { RevenueCogsService } from './revenue-cogs.service';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';

/**
 * Revenue / COGS reporting HTTP surface (Sprint 13, docs/domains/accounting.md
 * §16.4). Entirely read-only — auth-only, no `RolesGuard`.
 */
@Controller('finance/reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RevenueCogsController {
  constructor(private readonly revenueCogsService: RevenueCogsService) {}

  @Get('revenue')
  @RequirePermission('finance.reports.view')
  async getRevenue(
    @CurrentUser() user: TokenPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.revenueCogsService.getRevenueReport(user.organisationId, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : new Date(),
    });
  }

  @Get('cogs')
  @RequirePermission('finance.reports.view')
  async getCogs(
    @CurrentUser() user: TokenPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.revenueCogsService.getCogsReport(user.organisationId, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : new Date(),
    });
  }
}
