import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AccountType, ChartOfAccount } from '@prisma/client';
import {
  CreateChartOfAccountInput,
  UpdateChartOfAccountInput,
  createChartOfAccountSchema,
  updateChartOfAccountSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { ACCOUNTING_AUDIT_ACTIONS } from './accounting-audit-actions';
import { ChartOfAccountService } from './chart-of-account.service';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';

/**
 * Chart of Accounts HTTP surface (Sprint 7, docs/domains/accounting.md). `GET`
 * requires only authentication — Member has read-only access; every write additionally
 * requires the Owner or Administrator role, same convention as every other domain.
 */
@Controller('finance/accounts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ChartOfAccountController {
  constructor(
    private readonly chartOfAccountService: ChartOfAccountService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission('finance.chart_of_accounts.manage')
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('type') type?: AccountType,
    @Query('isActive') isActive?: string,
    @Query('search') search?: string,
  ) {
    const accounts = await this.chartOfAccountService.list(user.organisationId, {
      type,
      isActive: isActive === undefined ? undefined : isActive === 'true',
      search: search?.trim() || undefined,
    });
    return { items: accounts.map(toChartOfAccountResponse) };
  }

  @Get(':id')
  @RequirePermission('finance.chart_of_accounts.manage')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const account = await this.chartOfAccountService.getById(user.organisationId, id);
    return toChartOfAccountResponse(account);
  }

  @Post()
  @RequirePermission('finance.chart_of_accounts.manage')
  async create(
    @Body(new ZodValidationPipe(createChartOfAccountSchema)) body: CreateChartOfAccountInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const created = await this.chartOfAccountService.create(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: ACCOUNTING_AUDIT_ACTIONS.ACCOUNT_CREATED,
      entityType: 'ChartOfAccount',
      entityId: created.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { code: created.code, name: created.name, type: created.type },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toChartOfAccountResponse(created);
  }

  @Patch(':id')
  @RequirePermission('finance.chart_of_accounts.manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateChartOfAccountSchema)) body: UpdateChartOfAccountInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.chartOfAccountService.update(
      user.organisationId,
      id,
      body,
      user.sub,
    );

    await this.auditService.record({
      action: ACCOUNTING_AUDIT_ACTIONS.ACCOUNT_UPDATED,
      entityType: 'ChartOfAccount',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { code: updated.code },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toChartOfAccountResponse(updated);
  }

  @Post(':id/activate')
  @RequirePermission('finance.chart_of_accounts.manage')
  async activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.chartOfAccountService.activate(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: ACCOUNTING_AUDIT_ACTIONS.ACCOUNT_ACTIVATED,
      entityType: 'ChartOfAccount',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { code: updated.code },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toChartOfAccountResponse(updated);
  }

  @Post(':id/deactivate')
  @RequirePermission('finance.chart_of_accounts.manage')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.chartOfAccountService.deactivate(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: ACCOUNTING_AUDIT_ACTIONS.ACCOUNT_DEACTIVATED,
      entityType: 'ChartOfAccount',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { code: updated.code },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toChartOfAccountResponse(updated);
  }
}

export function toChartOfAccountResponse(account: ChartOfAccount) {
  return {
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    parentId: account.parentId,
    description: account.description,
    isActive: account.isActive,
    isSystemAccount: account.isSystemAccount,
    systemKey: account.systemKey,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
