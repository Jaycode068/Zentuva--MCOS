import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AccountingPeriod } from '@prisma/client';
import { CreateAccountingPeriodInput, createAccountingPeriodSchema } from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { ACCOUNTING_AUDIT_ACTIONS } from './accounting-audit-actions';
import { AccountingPeriodService } from './accounting-period.service';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';

/**
 * Accounting Period HTTP surface (Sprint 7, docs/domains/accounting.md). `GET`
 * requires only authentication; every write additionally requires Owner or
 * Administrator.
 */
@Controller('finance/accounting-periods')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AccountingPeriodController {
  constructor(
    private readonly accountingPeriodService: AccountingPeriodService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission('finance.chart_of_accounts.manage')
  async list(@CurrentUser() user: TokenPayload) {
    const periods = await this.accountingPeriodService.list(user.organisationId);
    return { items: periods.map(toAccountingPeriodResponse) };
  }

  @Get(':id')
  @RequirePermission('finance.chart_of_accounts.manage')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const period = await this.accountingPeriodService.getById(user.organisationId, id);
    return toAccountingPeriodResponse(period);
  }

  @Post()
  @RequirePermission('finance.chart_of_accounts.manage')
  async create(
    @Body(new ZodValidationPipe(createAccountingPeriodSchema)) body: CreateAccountingPeriodInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const created = await this.accountingPeriodService.create(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: ACCOUNTING_AUDIT_ACTIONS.ACCOUNTING_PERIOD_CREATED,
      entityType: 'AccountingPeriod',
      entityId: created.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { name: created.name, startDate: created.startDate, endDate: created.endDate },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toAccountingPeriodResponse(created);
  }

  @Post(':id/close')
  @RequirePermission('finance.chart_of_accounts.manage')
  async close(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.accountingPeriodService.close(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: ACCOUNTING_AUDIT_ACTIONS.ACCOUNTING_PERIOD_CLOSED,
      entityType: 'AccountingPeriod',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { name: updated.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toAccountingPeriodResponse(updated);
  }
}

export function toAccountingPeriodResponse(period: AccountingPeriod) {
  return {
    id: period.id,
    name: period.name,
    startDate: period.startDate,
    endDate: period.endDate,
    status: period.status,
    closedAt: period.closedAt,
    createdAt: period.createdAt,
  };
}
