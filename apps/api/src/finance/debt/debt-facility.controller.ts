import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { DebtFacility, DebtFacilityStatus, DebtRepaymentSchedule } from '@prisma/client';
import {
  CreateDebtDrawdownInput,
  CreateDebtFacilityInput,
  CreateDebtRepaymentInput,
  UpdateDebtFacilityInput,
  createDebtDrawdownSchema,
  createDebtFacilitySchema,
  createDebtRepaymentSchema,
  updateDebtFacilitySchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { DEBT_AUDIT_ACTIONS } from '../debt-audit-actions';
import { DebtAnalysisService } from './debt-analysis.service';
import { DebtDrawdownService } from './debt-drawdown.service';
import { DebtFacilityService } from './debt-facility.service';
import { DebtRepaymentService } from './debt-repayment.service';

/**
 * Debt Facility HTTP surface (Sprint 17, docs/domains/debt-management.md
 * §6/§10/§13/§15). `GET` requires only authentication; every write
 * additionally requires the Owner or Administrator role. Drawdown/Repayment
 * routes are nested here (`.../:id/drawdowns`, `.../:id/repayments`),
 * matching the `BudgetController`'s own nested-lines convention.
 */
@Controller('finance/debt/facilities')
@UseGuards(JwtAuthGuard)
export class DebtFacilityController {
  constructor(
    private readonly debtFacilityService: DebtFacilityService,
    private readonly debtDrawdownService: DebtDrawdownService,
    private readonly debtRepaymentService: DebtRepaymentService,
    private readonly debtAnalysisService: DebtAnalysisService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload, @Query('status') status?: DebtFacilityStatus) {
    const items = await this.debtFacilityService.list(user.organisationId, { status });
    return { items: items.map(toDebtFacilityResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const facility = await this.debtFacilityService.getById(user.organisationId, id);
    const balance = await this.debtFacilityService.getBalance(user.organisationId, id);
    return { ...toDebtFacilityResponse(facility), balance };
  }

  @Get(':id/schedule')
  async schedule(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const schedule = await this.debtFacilityService.getSchedule(user.organisationId, id);
    return { items: schedule.map(toScheduleResponse) };
  }

  @Get(':id/preview-impact')
  async previewImpact(
    @CurrentUser() user: TokenPayload,
    @Param('id') id: string,
    @Query('cashflowScenarioId') cashflowScenarioId?: string,
  ) {
    return this.debtAnalysisService.previewFacilityImpact(user.organisationId, id, {
      cashflowScenarioId,
    });
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createDebtFacilitySchema)) body: CreateDebtFacilityInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { debtFacility, wasCreated } = await this.debtFacilityService.create(
      user.organisationId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: DEBT_AUDIT_ACTIONS.DEBT_FACILITY_CREATED,
        entityType: 'DebtFacility',
        entityId: debtFacility.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          facilityCode: debtFacility.facilityCode,
          principalAmount: debtFacility.principalAmount,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toDebtFacilityResponse(debtFacility);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDebtFacilitySchema)) body: UpdateDebtFacilityInput,
    @CurrentUser() user: TokenPayload,
  ) {
    const updated = await this.debtFacilityService.update(user.organisationId, id, body);
    return toDebtFacilityResponse(updated);
  }

  @Post(':id/approve')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async approve(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.debtFacilityService.approve(user.organisationId, id, user.sub);
    await this.auditService.record({
      action: DEBT_AUDIT_ACTIONS.DEBT_FACILITY_APPROVED,
      entityType: 'DebtFacility',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toDebtFacilityResponse(updated);
  }

  @Post(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async cancel(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.debtFacilityService.cancel(user.organisationId, id);
    await this.auditService.record({
      action: DEBT_AUDIT_ACTIONS.DEBT_FACILITY_CANCELLED,
      entityType: 'DebtFacility',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toDebtFacilityResponse(updated);
  }

  @Post(':id/mark-defaulted')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async markDefaulted(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.debtFacilityService.markDefaulted(user.organisationId, id);
    await this.auditService.record({
      action: DEBT_AUDIT_ACTIONS.DEBT_FACILITY_DEFAULTED,
      entityType: 'DebtFacility',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toDebtFacilityResponse(updated);
  }

  @Post(':id/drawdowns')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async createDrawdown(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createDebtDrawdownSchema)) body: CreateDebtDrawdownInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { debtDrawdown, wasCreated, facilityActivated } = await this.debtDrawdownService.create(
      user.organisationId,
      id,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: DEBT_AUDIT_ACTIONS.DEBT_FACILITY_DRAWN,
        entityType: 'DebtDrawdown',
        entityId: debtDrawdown.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { debtFacilityId: id, amount: debtDrawdown.amount },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      if (facilityActivated) {
        await this.auditService.record({
          action: DEBT_AUDIT_ACTIONS.DEBT_FACILITY_ACTIVATED,
          entityType: 'DebtFacility',
          entityId: id,
          organisationId: user.organisationId,
          actorUserId: user.sub,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }
    }

    return {
      id: debtDrawdown.id,
      debtFacilityId: debtDrawdown.debtFacilityId,
      cashAccountId: debtDrawdown.cashAccountId,
      amount: debtDrawdown.amount,
      drawdownDate: debtDrawdown.drawdownDate,
      reference: debtDrawdown.reference,
      notes: debtDrawdown.notes,
      createdAt: debtDrawdown.createdAt,
    };
  }

  @Post(':id/repayments')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async createRepayment(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createDebtRepaymentSchema)) body: CreateDebtRepaymentInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { debtRepayment, wasCreated, facilityStatus } = await this.debtRepaymentService.create(
      user.organisationId,
      id,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: DEBT_AUDIT_ACTIONS.DEBT_FACILITY_REPAID,
        entityType: 'DebtRepayment',
        entityId: debtRepayment.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          debtFacilityId: id,
          principalAmount: debtRepayment.principalAmount,
          interestAmount: debtRepayment.interestAmount,
          feeAmount: debtRepayment.feeAmount,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      if (facilityStatus === DebtFacilityStatus.PAID_OFF) {
        await this.auditService.record({
          action: DEBT_AUDIT_ACTIONS.DEBT_FACILITY_PAID_OFF,
          entityType: 'DebtFacility',
          entityId: id,
          organisationId: user.organisationId,
          actorUserId: user.sub,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }
    }

    return {
      id: debtRepayment.id,
      debtFacilityId: debtRepayment.debtFacilityId,
      cashAccountId: debtRepayment.cashAccountId,
      paymentDate: debtRepayment.paymentDate,
      principalAmount: debtRepayment.principalAmount,
      interestAmount: debtRepayment.interestAmount,
      feeAmount: debtRepayment.feeAmount,
      totalAmount: debtRepayment.totalAmount,
      reference: debtRepayment.reference,
      notes: debtRepayment.notes,
      createdAt: debtRepayment.createdAt,
      facilityStatus,
    };
  }
}

export function toDebtFacilityResponse(facility: DebtFacility) {
  return {
    id: facility.id,
    facilityCode: facility.facilityCode,
    lenderId: facility.lenderId,
    name: facility.name,
    debtType: facility.debtType,
    principalAmount: facility.principalAmount,
    currency: facility.currency,
    interestRatePercent: facility.interestRatePercent,
    interestType: facility.interestType,
    repaymentMethod: facility.repaymentMethod,
    repaymentFrequency: facility.repaymentFrequency,
    startDate: facility.startDate,
    tenorMonths: facility.tenorMonths,
    graceMonths: facility.graceMonths,
    maturityDate: facility.maturityDate,
    status: facility.status,
    liabilityAccountId: facility.liabilityAccountId,
    interestExpenseAccountId: facility.interestExpenseAccountId,
    capitalRequirementId: facility.capitalRequirementId,
    notes: facility.notes,
    approvedAt: facility.approvedAt,
    activatedAt: facility.activatedAt,
    closedAt: facility.closedAt,
    cancelledAt: facility.cancelledAt,
    defaultedAt: facility.defaultedAt,
    createdAt: facility.createdAt,
    updatedAt: facility.updatedAt,
  };
}

export function toScheduleResponse(installment: DebtRepaymentSchedule) {
  return {
    id: installment.id,
    installmentNumber: installment.installmentNumber,
    dueDate: installment.dueDate,
    openingPrincipal: installment.openingPrincipal,
    principalDue: installment.principalDue,
    interestDue: installment.interestDue,
    totalDue: installment.totalDue,
    closingPrincipal: installment.closingPrincipal,
    amountPaid: installment.amountPaid,
    status: installment.status,
  };
}
