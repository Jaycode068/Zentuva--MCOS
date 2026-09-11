import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';

import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import {
  CostCentreNotFoundError,
  MaintenanceAnalyticsService,
} from './maintenance-analytics.service';

function parseDateRange(from?: string, to?: string): { from: Date; to: Date } {
  const to_ = to ? new Date(to) : new Date();
  const from_ = from ? new Date(from) : new Date(to_.getFullYear(), to_.getMonth(), 1);
  if (Number.isNaN(from_.getTime()) || Number.isNaN(to_.getTime())) {
    throw new BadRequestException('Invalid from/to date');
  }
  return { from: from_, to: to_ };
}

/**
 * Maintenance Analytics HTTP surface (Sprint 22, docs/domains/
 * maintenance-integration.md "Analytics"). Read-only reporting composed
 * live over Maintenance's own tables plus two narrow, documented reaches
 * into Budgeting's `CostCentre`/`BudgetLine` — any authenticated member
 * may read, the same "reporting is not gated behind write RBAC"
 * convention `MaintenanceOverviewController` already uses.
 */
@Controller('maintenance/analytics')
@UseGuards(JwtAuthGuard)
export class MaintenanceAnalyticsController {
  constructor(private readonly maintenanceAnalyticsService: MaintenanceAnalyticsService) {}

  @Get('cost-vs-budget')
  async getCostVsBudget(
    @CurrentUser() user: TokenPayload,
    @Query('costCentreId') costCentreId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!costCentreId) {
      throw new BadRequestException('costCentreId is required');
    }
    const { from: from_, to: to_ } = parseDateRange(from, to);
    try {
      return await this.maintenanceAnalyticsService.getCostVsBudget(
        user.organisationId,
        costCentreId,
        from_,
        to_,
      );
    } catch (error) {
      if (error instanceof CostCentreNotFoundError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  @Get('cost-breakdown')
  getCostBreakdown(
    @CurrentUser() user: TokenPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { from: from_, to: to_ } = parseDateRange(from, to);
    return this.maintenanceAnalyticsService.getCostBreakdown(user.organisationId, from_, to_);
  }

  @Get('operational-metrics')
  getOperationalMetrics(
    @CurrentUser() user: TokenPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { from: from_, to: to_ } = parseDateRange(from, to);
    return this.maintenanceAnalyticsService.getOperationalMetrics(user.organisationId, from_, to_);
  }

  @Get('risk-signals')
  async getRiskSignals(@CurrentUser() user: TokenPayload) {
    const items = await this.maintenanceAnalyticsService.getRiskSignals(user.organisationId);
    return { items };
  }
}
