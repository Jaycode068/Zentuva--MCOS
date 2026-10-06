import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { paginationSchema } from '@zentuva/validation';

import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { RewardGrantService } from './reward-grant.service';

/**
 * Sprint 40 — Reward Grant read HTTP surface (docs/domains/d2c.md). `promotions.loyalty
 * .view` gates every route here (reusing the Loyalty read permission — a grant IS
 * reward/loyalty history, not a separate trust boundary from the Loyalty account/ledger
 * it feeds). No mutation route exists here at all — a grant is only ever created by
 * `PromotionEvaluationService` from a genuine qualifying event, never by a direct admin
 * API call (docs/domains/d2c.md "Reward Grant architecture").
 */
@Controller('promotions/grants')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RewardController {
  constructor(private readonly rewardGrantService: RewardGrantService) {}

  @Get()
  @RequirePermission('promotions.loyalty.view')
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('promotionId') promotionId?: string,
  ) {
    const { page, pageSize } = paginationSchema.parse({ page: pageRaw, pageSize: pageSizeRaw });
    const { items, total } = await this.rewardGrantService.list(user.organisationId, {
      promotionId,
      page,
      pageSize,
    });
    return { items, total, page, pageSize };
  }

  @Get('consumer/:consumerId')
  @RequirePermission('promotions.loyalty.view')
  async listForConsumer(
    @Param('consumerId') consumerId: string,
    @CurrentUser() user: TokenPayload,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ) {
    const { page, pageSize } = paginationSchema.parse({ page: pageRaw, pageSize: pageSizeRaw });
    const { items, total } = await this.rewardGrantService.listForConsumer(
      user.organisationId,
      consumerId,
      { page, pageSize },
    );
    return { items, total, page, pageSize };
  }
}
