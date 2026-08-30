import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { UpdateCashflowSettingsInput, updateCashflowSettingsSchema } from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CASHFLOW_AUDIT_ACTIONS } from '../cashflow-audit-actions';
import { CashflowSettingsService } from './cashflow-settings.service';

/** Cashflow Settings HTTP surface (Sprint 15, docs/domains/cashflow.md §10). `GET`
 *  requires only authentication; `PUT` requires Owner/Administrator. */
@Controller('finance/cashflow/settings')
@UseGuards(JwtAuthGuard)
export class CashflowSettingsController {
  constructor(
    private readonly cashflowSettingsService: CashflowSettingsService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  getSettings(@CurrentUser() user: TokenPayload) {
    return this.cashflowSettingsService.getEffective(user.organisationId);
  }

  @Put()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Body(new ZodValidationPipe(updateCashflowSettingsSchema)) body: UpdateCashflowSettingsInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.cashflowSettingsService.update(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: CASHFLOW_AUDIT_ACTIONS.SETTINGS_UPDATED,
      entityType: 'CashflowSettings',
      entityId: user.organisationId,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: updated as unknown as Record<string, unknown>,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return updated;
  }
}
