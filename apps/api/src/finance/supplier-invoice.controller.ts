import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SupplierInvoiceStatus } from '@prisma/client';
import {
  AcknowledgeSupplierInvoiceDiscrepancyInput,
  CreateSupplierInvoiceInput,
  PostSupplierInvoiceInput,
  UpdateSupplierInvoiceInput,
  acknowledgeSupplierInvoiceDiscrepancySchema,
  createSupplierInvoiceSchema,
  postSupplierInvoiceSchema,
  updateSupplierInvoiceSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { ACCOUNTS_PAYABLE_AUDIT_ACTIONS } from './accounts-payable-audit-actions';
import { SupplierInvoiceWithRelations } from './supplier-invoice.repository';
import { SupplierInvoiceService } from './supplier-invoice.service';

/**
 * Supplier Invoice HTTP surface (Sprint 12, docs/domains/finance.md "Accounts
 * Payable"). `GET` requires only authentication — Member has read-only access; every
 * write additionally requires the Owner or Administrator role (`RolesGuard`), same
 * convention as `InvoiceController`.
 *
 * Tenant isolation: every method resolves the target invoice by `(id, organisationId)`
 * together.
 */
@Controller('finance/supplier-invoices')
@UseGuards(JwtAuthGuard)
export class SupplierInvoiceController {
  constructor(
    private readonly supplierInvoiceService: SupplierInvoiceService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: SupplierInvoiceStatus,
    @Query('supplierId') supplierId?: string,
    @Query('purchaseOrderId') purchaseOrderId?: string,
    @Query('search') search?: string,
  ) {
    const items = await this.supplierInvoiceService.list(user.organisationId, {
      status,
      supplierId,
      purchaseOrderId,
      search: search?.trim() || undefined,
    });
    return { items: items.map(toSupplierInvoiceResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const invoice = await this.supplierInvoiceService.getById(user.organisationId, id);
    return toSupplierInvoiceResponse(invoice);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createSupplierInvoiceSchema)) body: CreateSupplierInvoiceInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { supplierInvoice, wasCreated } = await this.supplierInvoiceService.create(
      user.organisationId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: ACCOUNTS_PAYABLE_AUDIT_ACTIONS.SUPPLIER_INVOICE_CREATED,
        entityType: 'SupplierInvoice',
        entityId: supplierInvoice.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          invoiceNumber: supplierInvoice.invoiceNumber,
          supplierId: supplierInvoice.supplierId,
          total: supplierInvoice.total,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toSupplierInvoiceResponse(supplierInvoice);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSupplierInvoiceSchema)) body: UpdateSupplierInvoiceInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.supplierInvoiceService.update(
      user.organisationId,
      id,
      body,
      user.sub,
    );

    await this.auditService.record({
      action: ACCOUNTS_PAYABLE_AUDIT_ACTIONS.SUPPLIER_INVOICE_UPDATED,
      entityType: 'SupplierInvoice',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { invoiceNumber: updated.invoiceNumber },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toSupplierInvoiceResponse(updated);
  }

  /** `POST /:id/post` — the one-way `DRAFT -> POSTED` transition. Only emits audit
   *  events when `wasCreated === true` — a replayed idempotent request must not
   *  double-record history. */
  @Post(':id/post')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async post(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(postSupplierInvoiceSchema)) body: PostSupplierInvoiceInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { supplierInvoice, journalEntry, wasCreated } = await this.supplierInvoiceService.post(
      user.organisationId,
      id,
      user.sub,
      body.idempotencyKey,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: ACCOUNTS_PAYABLE_AUDIT_ACTIONS.SUPPLIER_INVOICE_POSTED,
        entityType: 'SupplierInvoice',
        entityId: supplierInvoice.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          invoiceNumber: supplierInvoice.invoiceNumber,
          matchStatus: supplierInvoice.matchStatus,
          recognizedAmount: supplierInvoice.recognizedAmount,
          varianceAmount: supplierInvoice.varianceAmount,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      if (journalEntry) {
        await this.auditService.record({
          action: ACCOUNTS_PAYABLE_AUDIT_ACTIONS.SUPPLIER_INVOICE_JOURNAL_POSTED,
          entityType: 'SupplierInvoice',
          entityId: supplierInvoice.id,
          organisationId: user.organisationId,
          actorUserId: user.sub,
          metadata: {
            journalEntryId: journalEntry.id,
            journalNumber: journalEntry.journalNumber,
            totalAmount: journalEntry.totalAmount,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }

      if (supplierInvoice.matchStatus === 'DISCREPANCY') {
        await this.auditService.record({
          action: ACCOUNTS_PAYABLE_AUDIT_ACTIONS.PAYABLE_DISCREPANCY_CREATED,
          entityType: 'SupplierInvoice',
          entityId: supplierInvoice.id,
          organisationId: user.organisationId,
          actorUserId: user.sub,
          metadata: { varianceAmount: supplierInvoice.varianceAmount },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }
    }

    return { ...toSupplierInvoiceResponse(supplierInvoice), journalEntry };
  }

  @Post(':id/acknowledge-discrepancy')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async acknowledgeDiscrepancy(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(acknowledgeSupplierInvoiceDiscrepancySchema))
    body: AcknowledgeSupplierInvoiceDiscrepancyInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.supplierInvoiceService.acknowledgeDiscrepancy(
      user.organisationId,
      id,
      user.sub,
      body.notes,
    );

    await this.auditService.record({
      action: ACCOUNTS_PAYABLE_AUDIT_ACTIONS.PAYABLE_DISCREPANCY_RESOLVED,
      entityType: 'SupplierInvoice',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { notes: body.notes },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toSupplierInvoiceResponse(updated);
  }

  @Post(':id/void')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async void(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.supplierInvoiceService.void(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: ACCOUNTS_PAYABLE_AUDIT_ACTIONS.SUPPLIER_INVOICE_VOIDED,
      entityType: 'SupplierInvoice',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { invoiceNumber: updated.invoiceNumber },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toSupplierInvoiceResponse(updated);
  }
}

export function toSupplierInvoiceResponse(invoice: SupplierInvoiceWithRelations) {
  const amountOutstanding = roundCurrency(
    invoice.recognizedAmount - invoice.amountPaid - invoice.amountCredited,
  );
  return {
    id: invoice.id,
    supplier: invoice.supplier,
    purchaseOrder: invoice.purchaseOrder,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate,
    dueDate: invoice.dueDate,
    paymentTerms: invoice.paymentTerms,
    status: invoice.status,
    currency: invoice.currency,
    subtotal: invoice.subtotal,
    taxAmount: invoice.taxAmount,
    total: invoice.total,
    matchStatus: invoice.matchStatus,
    recognizedAmount: invoice.recognizedAmount,
    varianceAmount: invoice.varianceAmount,
    amountPaid: invoice.amountPaid,
    amountCredited: invoice.amountCredited,
    amountOutstanding,
    notes: invoice.notes,
    discrepancyResolvedAt: invoice.discrepancyResolvedAt,
    discrepancyResolutionNotes: invoice.discrepancyResolutionNotes,
    items: invoice.items.map((item) => ({
      id: item.id,
      product: item.product,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      goodsReceiptItemId: item.goodsReceiptItemId,
      debitAccount: item.debitAccount,
      recognizedAmount: item.recognizedAmount,
      varianceAmount: item.varianceAmount,
    })),
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
  };
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
