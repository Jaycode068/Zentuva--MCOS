import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  LoyaltyAdjustmentInput,
  loyaltyAdjustmentSchema,
  paginationSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { LOYALTY_AUDIT_ACTIONS } from './loyalty-audit-actions';
import { LoyaltyService } from './loyalty.service';

/**
 * Sprint 40 — Loyalty admin HTTP surface (docs/domains/d2c.md). `promotions.loyalty.view`
 * gates every read; `.loyalty.adjust` additionally gates the one mutation. No public or
 * consumer-facing route here — the future Conversation Layer/WhatsApp adapter is expected
 * to call `LoyaltyService` directly, the exact same "internal/admin only this sprint"
 * shape `ConsumerController` already established (Sprint 32).
 */
@Controller('promotions/loyalty')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LoyaltyController {
  constructor(
    private readonly loyaltyService: LoyaltyService,
    private readonly auditService: AuditService,
  ) {}

  @Get('accounts')
  @RequirePermission('promotions.loyalty.view')
  async listAccounts(
    @CurrentUser() user: TokenPayload,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('search') search?: string,
  ) {
    const { page, pageSize } = paginationSchema.parse({ page: pageRaw, pageSize: pageSizeRaw });
    const { items, total } = await this.loyaltyService.listAccounts(user.organisationId, {
      search: search?.trim() || undefined,
      page,
      pageSize,
    });
    return { items, total, page, pageSize };
  }

  @Get('accounts/:consumerId')
  @RequirePermission('promotions.loyalty.view')
  async getAccount(@Param('consumerId') consumerId: string, @CurrentUser() user: TokenPayload) {
    const account = await this.loyaltyService.getAccount(user.organisationId, consumerId);
    return { account };
  }

  @Get('accounts/:consumerId/ledger')
  @RequirePermission('promotions.loyalty.view')
  async getLedger(
    @Param('consumerId') consumerId: string,
    @CurrentUser() user: TokenPayload,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
  ) {
    const { page, pageSize } = paginationSchema.parse({ page: pageRaw, pageSize: pageSizeRaw });
    const { items, total } = await this.loyaltyService.listLedger(user.organisationId, consumerId, {
      page,
      pageSize,
    });
    return { items, total, page, pageSize };
  }

  @Post('accounts/:consumerId/adjustments')
  @RequirePermission('promotions.loyalty.adjust')
  async adjust(
    @Param('consumerId') consumerId: string,
    @Body(new ZodValidationPipe(loyaltyAdjustmentSchema)) body: LoyaltyAdjustmentInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const entry = await this.loyaltyService.adjust(user.organisationId, consumerId, body, user.sub);
    await this.auditService.record({
      action: LOYALTY_AUDIT_ACTIONS.BALANCE_ADJUSTED,
      entityType: 'LoyaltyLedgerEntry',
      entityId: entry.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { consumerId, amount: body.amount, reason: body.reason },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return entry;
  }
}
