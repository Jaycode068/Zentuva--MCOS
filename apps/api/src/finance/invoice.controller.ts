import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import {
  CreateInvoiceInput,
  VoidInvoiceInput,
  createInvoiceSchema,
  voidInvoiceSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { SalesOrderWithRelations } from '../sales/sales-order.repository';
import { toCreditNoteResponse } from './credit-note.controller';
import { CreditNoteService } from './credit-note.service';
import { FINANCE_AUDIT_ACTIONS } from './finance-audit-actions';
import { InvoiceWithRelations } from './invoice.repository';
import { InvoiceService } from './invoice.service';
import { toPaymentResponse } from './payment.controller';
import { PaymentService } from './payment.service';

/**
 * Invoice HTTP surface (Sprint 6, docs/domains/finance.md). `GET` requires only
 * authentication — Member has read-only access; every write additionally requires the
 * Owner or Administrator role (`RolesGuard`), same convention as every other domain.
 *
 * Tenant isolation: every method resolves the target invoice by `(id, organisationId)`
 * together, same convention as every other domain controller.
 */
@Controller('finance')
@UseGuards(JwtAuthGuard)
export class InvoiceController {
  constructor(
    private readonly invoiceService: InvoiceService,
    private readonly paymentService: PaymentService,
    private readonly creditNoteService: CreditNoteService,
    private readonly auditService: AuditService,
  ) {}

  /** `GET /eligible-sales-orders` — read-only, never gates anything by itself; the
   *  create-invoice flow's own server-side checks are what actually enforce eligibility. */
  @Get('eligible-sales-orders')
  async listEligibleSalesOrders(@CurrentUser() user: TokenPayload) {
    const orders = await this.invoiceService.listEligibleSalesOrders(user.organisationId);
    return { items: orders.map(toEligibleSalesOrderResponse) };
  }

  @Get('invoices')
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: InvoiceStatus,
    @Query('customerId') customerId?: string,
    @Query('salesOrderId') salesOrderId?: string,
    @Query('search') search?: string,
  ) {
    const invoices = await this.invoiceService.list(user.organisationId, {
      status,
      customerId,
      salesOrderId,
      search: search?.trim() || undefined,
    });
    return { items: invoices.map(toInvoiceResponse) };
  }

  @Get('invoices/:id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const invoice = await this.invoiceService.getById(user.organisationId, id);
    return toInvoiceResponse(invoice);
  }

  /** `GET /invoices/:id/payments` — drill-down, auth-only. */
  @Get('invoices/:id/payments')
  async listPayments(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.paymentService.list(user.organisationId, { invoiceId: id });
    return { items: items.map(toPaymentResponse) };
  }

  /** `GET /invoices/:id/credit-notes` — drill-down, auth-only. */
  @Get('invoices/:id/credit-notes')
  async listCreditNotes(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.creditNoteService.list(user.organisationId, { invoiceId: id });
    return { items: items.map(toCreditNoteResponse) };
  }

  @Post('invoices')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createInvoiceSchema)) body: CreateInvoiceInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const created = await this.invoiceService.create(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: FINANCE_AUDIT_ACTIONS.INVOICE_CREATED,
      entityType: 'Invoice',
      entityId: created.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: {
        invoiceCode: created.invoiceCode,
        salesOrderId: created.salesOrderId,
        customerId: created.customerId,
        total: created.total,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toInvoiceResponse(created);
  }

  @Post('invoices/:id/issue')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async issue(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.invoiceService.issue(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: FINANCE_AUDIT_ACTIONS.INVOICE_ISSUED,
      entityType: 'Invoice',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { invoiceCode: updated.invoiceCode, dueDate: updated.dueDate },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toInvoiceResponse(updated);
  }

  @Post('invoices/:id/void')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async void(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(voidInvoiceSchema)) body: VoidInvoiceInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.invoiceService.void(user.organisationId, id, body, user.sub);

    await this.auditService.record({
      action: FINANCE_AUDIT_ACTIONS.INVOICE_VOIDED,
      entityType: 'Invoice',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { invoiceCode: updated.invoiceCode, notes: body.notes },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toInvoiceResponse(updated);
  }
}

function toEligibleSalesOrderResponse(order: SalesOrderWithRelations) {
  return {
    id: order.id,
    orderCode: order.orderCode,
    customer: order.customer,
    outlet: order.outlet,
    total: order.total,
    items: order.items.map((item) => ({
      id: item.id,
      product: item.product,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
    })),
  };
}

/** `amountOutstanding` is computed here, never stored — `total - amountPaid -
 *  amountCredited`. */
export function toInvoiceResponse(invoice: InvoiceWithRelations) {
  const amountOutstanding = roundCurrency(
    invoice.total - invoice.amountPaid - invoice.amountCredited,
  );
  return {
    id: invoice.id,
    invoiceCode: invoice.invoiceCode,
    customer: invoice.customer,
    outlet: invoice.outlet,
    salesOrder: invoice.salesOrder,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    paymentTerms: invoice.paymentTerms,
    status: invoice.status,
    currency: invoice.currency,
    subtotal: invoice.subtotal,
    discount: invoice.discount,
    taxAmount: invoice.taxAmount,
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    amountCredited: invoice.amountCredited,
    amountOutstanding,
    notes: invoice.notes,
    items: invoice.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productCode: item.productCode,
      productName: item.productName,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      taxRate: item.taxRate,
      taxAmount: item.taxAmount,
      lineTotal: item.lineTotal,
    })),
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
