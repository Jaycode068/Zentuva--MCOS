import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AccountingPeriod } from '@prisma/client';
import { CreateAccountingPeriodInput, createAccountingPeriodSchema } from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { ACCOUNTING_AUDIT_ACTIONS } from './accounting-audit-actions';
import { AccountingPeriodService } from './accounting-period.service';

/**
 * Accounting Period HTTP surface (Sprint 7, docs/domains/accounting.md). `GET`
 * requires only authentication; every write additionally requires Owner or
 * Administrator.
 */
@Controller('finance/accounting-periods')
@UseGuards(JwtAuthGuard)
export class AccountingPeriodController {
  constructor(
    private readonly accountingPeriodService: AccountingPeriodService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload) {
    const periods = await this.accountingPeriodService.list(user.organisationId);
    return { items: periods.map(toAccountingPeriodResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const period = await this.accountingPeriodService.getById(user.organisationId, id);
    return toAccountingPeriodResponse(period);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
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
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
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
