import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { CreateSupplierPaymentInput, createSupplierPaymentSchema } from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { ACCOUNTS_PAYABLE_AUDIT_ACTIONS } from './accounts-payable-audit-actions';
import { SupplierPaymentWithRelations } from './supplier-payment.repository';
import { SupplierPaymentService } from './supplier-payment.service';

/**
 * Supplier Payment HTTP surface (Sprint 12, docs/domains/finance.md "Accounts
 * Payable"). `GET` requires only authentication; every write additionally requires
 * the Owner or Administrator role. Only emits an audit event when
 * `wasCreated === true` — a replayed idempotent request must not double-record
 * history.
 */
@Controller('finance/supplier-payments')
@UseGuards(JwtAuthGuard)
export class SupplierPaymentController {
  constructor(
    private readonly supplierPaymentService: SupplierPaymentService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('supplierId') supplierId?: string,
    @Query('supplierInvoiceId') supplierInvoiceId?: string,
  ) {
    const payments = await this.supplierPaymentService.list(user.organisationId, {
      supplierId,
      supplierInvoiceId,
    });
    return { items: payments.map(toSupplierPaymentResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const payment = await this.supplierPaymentService.getById(user.organisationId, id);
    return toSupplierPaymentResponse(payment);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createSupplierPaymentSchema)) body: CreateSupplierPaymentInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { supplierPayment, supplierInvoice, wasCreated } =
      await this.supplierPaymentService.create(user.organisationId, body, user.sub);

    if (wasCreated) {
      await this.auditService.record({
        action: ACCOUNTS_PAYABLE_AUDIT_ACTIONS.SUPPLIER_PAYMENT_RECORDED,
        entityType: 'SupplierInvoice',
        entityId: supplierInvoice.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          supplierPaymentId: supplierPayment.id,
          amount: supplierPayment.amount,
          newInvoiceStatus: supplierInvoice.status,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toSupplierPaymentResponse(supplierPayment);
  }

  @Post(':id/void')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async void(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const { supplierPayment, supplierInvoiceId } = await this.supplierPaymentService.void(
      user.organisationId,
      id,
      user.sub,
    );

    await this.auditService.record({
      action: ACCOUNTS_PAYABLE_AUDIT_ACTIONS.SUPPLIER_PAYMENT_VOIDED,
      entityType: 'SupplierInvoice',
      entityId: supplierInvoiceId,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { supplierPaymentId: supplierPayment.id, amount: supplierPayment.amount },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toSupplierPaymentResponse(supplierPayment);
  }
}

export function toSupplierPaymentResponse(payment: SupplierPaymentWithRelations) {
  return {
    id: payment.id,
    supplier: payment.supplier,
    paymentDate: payment.paymentDate,
    amount: payment.amount,
    currency: payment.currency,
    method: payment.method,
    reference: payment.reference,
    notes: payment.notes,
    status: payment.status,
    supplierInvoiceId: payment.allocations[0]?.supplierInvoiceId ?? null,
    createdAt: payment.createdAt,
  };
}
