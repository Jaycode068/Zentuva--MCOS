import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CreatePaymentInput, createPaymentSchema } from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { FINANCE_AUDIT_ACTIONS } from './finance-audit-actions';
import { PaymentWithRelations } from './payment.repository';
import { PaymentService } from './payment.service';

/**
 * Payment HTTP surface (Sprint 6, docs/domains/finance.md). `GET` requires only
 * authentication — Member has read-only access; every write additionally requires the
 * Owner or Administrator role. Only emits an audit event when `wasCreated === true` — a
 * replayed idempotent request must not double-record history.
 */
@Controller('finance/payments')
@UseGuards(JwtAuthGuard)
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('customerId') customerId?: string,
    @Query('invoiceId') invoiceId?: string,
  ) {
    const payments = await this.paymentService.list(user.organisationId, { customerId, invoiceId });
    return { items: payments.map(toPaymentResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const payment = await this.paymentService.getById(user.organisationId, id);
    return toPaymentResponse(payment);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createPaymentSchema)) body: CreatePaymentInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { payment, invoice, wasCreated } = await this.paymentService.create(
      user.organisationId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: FINANCE_AUDIT_ACTIONS.PAYMENT_RECORDED,
        entityType: 'Invoice',
        entityId: invoice.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          paymentId: payment.id,
          amount: payment.amount,
          newInvoiceStatus: invoice.status,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toPaymentResponse(payment);
  }

  @Post(':id/void')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async void(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const { payment, invoiceId } = await this.paymentService.void(
      user.organisationId,
      id,
      user.sub,
    );

    await this.auditService.record({
      action: FINANCE_AUDIT_ACTIONS.PAYMENT_VOIDED,
      entityType: 'Invoice',
      entityId: invoiceId,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { paymentId: payment.id, amount: payment.amount },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toPaymentResponse(payment);
  }
}

export function toPaymentResponse(payment: PaymentWithRelations) {
  return {
    id: payment.id,
    customer: payment.customer,
    paymentDate: payment.paymentDate,
    amount: payment.amount,
    currency: payment.currency,
    method: payment.method,
    reference: payment.reference,
    notes: payment.notes,
    status: payment.status,
    invoiceId: payment.allocations[0]?.invoiceId ?? null,
    cashAccountId: payment.cashAccountId,
    createdAt: payment.createdAt,
  };
}
