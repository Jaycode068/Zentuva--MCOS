import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { RevenueCogsService } from './revenue-cogs.service';

/**
 * Revenue / COGS reporting HTTP surface (Sprint 13, docs/domains/accounting.md
 * §16.4). Entirely read-only — auth-only, no `RolesGuard`.
 */
@Controller('finance/reports')
@UseGuards(JwtAuthGuard)
export class RevenueCogsController {
  constructor(private readonly revenueCogsService: RevenueCogsService) {}

  @Get('revenue')
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
