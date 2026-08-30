import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Body,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CashflowForecastAdjustment, CashflowForecastSourceType } from '@prisma/client';
import {
  UpsertCashflowForecastAdjustmentInput,
  upsertCashflowForecastAdjustmentSchema,
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
import { CashflowAdjustmentService } from './cashflow-adjustment.service';

/**
 * Cashflow Forecast Adjustment HTTP surface (Sprint 15, docs/domains/cashflow.md
 * §8) — lets management override a specific AR/AP-sourced item's expected
 * date/amount in the forecast layer only; the underlying `Invoice`/
 * `SupplierInvoice` row is never touched (see `cashflow-independence.spec.ts`).
 */
@Controller('finance/cashflow/adjustments')
@UseGuards(JwtAuthGuard)
export class CashflowAdjustmentController {
  constructor(
    private readonly cashflowAdjustmentService: CashflowAdjustmentService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload) {
    const items = await this.cashflowAdjustmentService.list(user.organisationId);
    return { items: items.map(toCashflowForecastAdjustmentResponse) };
  }

  @Get(':sourceType/:sourceId')
  async getOne(
    @CurrentUser() user: TokenPayload,
    @Param('sourceType') sourceType: CashflowForecastSourceType,
    @Param('sourceId') sourceId: string,
  ) {
    const adjustment = await this.cashflowAdjustmentService.getBySource(
      user.organisationId,
      sourceType,
      sourceId,
    );
    if (!adjustment) {
      throw new NotFoundException('No adjustment exists for this source item');
    }
    return toCashflowForecastAdjustmentResponse(adjustment);
  }

  @Put()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async upsert(
    @Body(new ZodValidationPipe(upsertCashflowForecastAdjustmentSchema))
    body: UpsertCashflowForecastAdjustmentInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { adjustment, wasCreated } = await this.cashflowAdjustmentService.upsert(
      user.organisationId,
      body,
      user.sub,
    );

    await this.auditService.record({
      action: wasCreated
        ? CASHFLOW_AUDIT_ACTIONS.FORECAST_ADJUSTMENT_CREATED
        : CASHFLOW_AUDIT_ACTIONS.FORECAST_ADJUSTMENT_UPDATED,
      entityType: 'CashflowForecastAdjustment',
      entityId: adjustment.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { sourceType: adjustment.sourceType, sourceId: adjustment.sourceId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCashflowForecastAdjustmentResponse(adjustment);
  }
}

export function toCashflowForecastAdjustmentResponse(adjustment: CashflowForecastAdjustment) {
  return {
    id: adjustment.id,
    sourceType: adjustment.sourceType,
    sourceId: adjustment.sourceId,
    adjustedExpectedDate: adjustment.adjustedExpectedDate,
    adjustedAmount: adjustment.adjustedAmount,
    notes: adjustment.notes,
    createdAt: adjustment.createdAt,
    updatedAt: adjustment.updatedAt,
  };
}
