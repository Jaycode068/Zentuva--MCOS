import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CashflowForecastItem, CashflowItemStatus } from '@prisma/client';
import {
  CreateCashflowForecastItemInput,
  UpdateCashflowForecastItemInput,
  createCashflowForecastItemSchema,
  updateCashflowForecastItemSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CASHFLOW_AUDIT_ACTIONS } from '../cashflow-audit-actions';
import { CashflowItemService } from './cashflow-item.service';

/**
 * Cashflow Forecast Item HTTP surface (Sprint 15, docs/domains/cashflow.md
 * §5/§6). `GET` requires only authentication; every write additionally requires
 * the Owner or Administrator role. Only emits an audit event when
 * `wasCreated === true` — a replayed idempotent request must not double-record
 * history.
 */
@Controller('finance/cashflow/items')
@UseGuards(JwtAuthGuard)
export class CashflowItemController {
  constructor(
    private readonly cashflowItemService: CashflowItemService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: CashflowItemStatus,
    @Query('cashAccountId') cashAccountId?: string,
  ) {
    const items = await this.cashflowItemService.list(user.organisationId, {
      status,
      cashAccountId,
    });
    return { items: items.map(toCashflowForecastItemResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const item = await this.cashflowItemService.getById(user.organisationId, id);
    return toCashflowForecastItemResponse(item);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createCashflowForecastItemSchema))
    body: CreateCashflowForecastItemInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { cashflowForecastItem, wasCreated } = await this.cashflowItemService.create(
      user.organisationId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: CASHFLOW_AUDIT_ACTIONS.FORECAST_ITEM_CREATED,
        entityType: 'CashflowForecastItem',
        entityId: cashflowForecastItem.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          direction: cashflowForecastItem.direction,
          amount: cashflowForecastItem.amount,
          recurrence: cashflowForecastItem.recurrence,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toCashflowForecastItemResponse(cashflowForecastItem);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCashflowForecastItemSchema))
    body: UpdateCashflowForecastItemInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.cashflowItemService.update(user.organisationId, id, body, user.sub);

    await this.auditService.record({
      action: CASHFLOW_AUDIT_ACTIONS.FORECAST_ITEM_UPDATED,
      entityType: 'CashflowForecastItem',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { amount: updated.amount },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCashflowForecastItemResponse(updated);
  }

  @Post(':id/deactivate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.cashflowItemService.deactivate(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: CASHFLOW_AUDIT_ACTIONS.FORECAST_ITEM_DEACTIVATED,
      entityType: 'CashflowForecastItem',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCashflowForecastItemResponse(updated);
  }

  @Post(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.cashflowItemService.activate(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: CASHFLOW_AUDIT_ACTIONS.FORECAST_ITEM_ACTIVATED,
      entityType: 'CashflowForecastItem',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCashflowForecastItemResponse(updated);
  }
}

export function toCashflowForecastItemResponse(item: CashflowForecastItem) {
  return {
    id: item.id,
    cashAccountId: item.cashAccountId,
    direction: item.direction,
    sourceType: item.sourceType,
    description: item.description,
    amount: item.amount,
    currency: item.currency,
    expectedDate: item.expectedDate,
    recurrence: item.recurrence,
    recurrenceEndDate: item.recurrenceEndDate,
    status: item.status,
    notes: item.notes,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
