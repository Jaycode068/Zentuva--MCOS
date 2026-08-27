import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { CustomerReturnStatus } from '@prisma/client';
import {
  CreateCustomerReturnInput,
  ReceiveCustomerReturnInput,
  createCustomerReturnSchema,
  receiveCustomerReturnSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { assertValidImageFile } from '../identity/common/image-upload-validation';
import { SALES_AUDIT_ACTIONS } from './sales-audit-actions';
import { CustomerReturnWithRelations } from './customer-return.repository';
import { CustomerReturnService } from './customer-return.service';

/**
 * Customer Return HTTP surface (Sprint 11, docs/domains/sales.md "Customer Returns").
 * `GET` requires only authentication — Member has read-only access; every write
 * additionally requires the Owner or Administrator role, same convention as
 * `SalesOrderController`/`DispatchController`. Tenant isolation: every method resolves
 * the target return by `(id, organisationId)` together.
 */
@Controller('sales/customer-returns')
@UseGuards(JwtAuthGuard)
export class CustomerReturnController {
  constructor(
    private readonly customerReturnService: CustomerReturnService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: CustomerReturnStatus,
    @Query('customerId') customerId?: string,
    @Query('salesOrderId') salesOrderId?: string,
    @Query('search') search?: string,
  ) {
    const items = await this.customerReturnService.list(user.organisationId, {
      status,
      customerId,
      salesOrderId,
      search: search?.trim() || undefined,
    });
    return { items: items.map(toCustomerReturnResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const customerReturn = await this.customerReturnService.getById(user.organisationId, id);
    return toCustomerReturnResponse(customerReturn);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async request(
    @Body(new ZodValidationPipe(createCustomerReturnSchema)) body: CreateCustomerReturnInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { customerReturn, wasCreated } = await this.customerReturnService.request(
      user.organisationId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: SALES_AUDIT_ACTIONS.RETURN_REQUESTED,
        entityType: 'CustomerReturn',
        entityId: customerReturn.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          returnCode: customerReturn.returnCode,
          salesOrderId: customerReturn.salesOrderId,
          items: customerReturn.items.length,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toCustomerReturnResponse(customerReturn);
  }

  /** `POST /:id/receive` — the one atomic physical+financial event (brief §31/§32).
   *  Only emits audit events when `wasCreated === true` — a replayed idempotent
   *  request must not double-record history. */
  @Post(':id/receive')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async receive(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(receiveCustomerReturnSchema)) body: ReceiveCustomerReturnInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { customerReturn, journalEntry, creditNote, wasCreated } =
      await this.customerReturnService.receive(user.organisationId, id, body, user.sub);

    if (wasCreated) {
      await this.auditService.record({
        action: SALES_AUDIT_ACTIONS.RETURN_RECEIVED,
        entityType: 'CustomerReturn',
        entityId: customerReturn.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { returnCode: customerReturn.returnCode },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      if (journalEntry) {
        await this.auditService.record({
          action: SALES_AUDIT_ACTIONS.RETURN_COGS_REVERSED,
          entityType: 'CustomerReturn',
          entityId: customerReturn.id,
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

      if (creditNote) {
        await this.auditService.record({
          action: SALES_AUDIT_ACTIONS.RETURN_CREDIT_NOTE_ISSUED,
          entityType: 'CustomerReturn',
          entityId: customerReturn.id,
          organisationId: user.organisationId,
          actorUserId: user.sub,
          metadata: {
            creditNoteId: creditNote.id,
            creditNoteCode: creditNote.creditNoteCode,
            amount: creditNote.amount,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        });
      }
    }

    return { ...toCustomerReturnResponse(customerReturn), journalEntry, creditNote };
  }

  @Post(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async cancel(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const customerReturn = await this.customerReturnService.cancel(user.organisationId, id);

    await this.auditService.record({
      action: SALES_AUDIT_ACTIONS.RETURN_CANCELLED,
      entityType: 'CustomerReturn',
      entityId: customerReturn.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { returnCode: customerReturn.returnCode },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCustomerReturnResponse(customerReturn);
  }

  @Post(':id/photo')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  @UseInterceptors(FileInterceptor('file'))
  async uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded — attach it as multipart field "file"');
    }
    assertValidImageFile(file, this.config, 'Customer return photo');

    const updated = await this.customerReturnService.setPhoto(user.organisationId, id, {
      mimeType: file.mimetype,
      buffer: file.buffer,
    });

    await this.auditService.record({
      action: SALES_AUDIT_ACTIONS.RETURN_PHOTO_UPLOADED,
      entityType: 'CustomerReturn',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { mimeType: file.mimetype, sizeBytes: file.size },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toCustomerReturnResponse(updated);
  }
}

function toCustomerReturnResponse(customerReturn: CustomerReturnWithRelations) {
  return {
    id: customerReturn.id,
    returnCode: customerReturn.returnCode,
    customer: customerReturn.customer,
    outlet: customerReturn.outlet,
    salesOrder: customerReturn.salesOrder,
    location: customerReturn.location,
    status: customerReturn.status,
    returnDate: customerReturn.returnDate,
    reason: customerReturn.reason,
    reasonNotes: customerReturn.reasonNotes,
    notes: customerReturn.notes,
    photoUrl: customerReturn.photoUrl,
    receivedAt: customerReturn.receivedAt,
    items: customerReturn.items.map((item) => ({
      id: item.id,
      product: item.product,
      salesFulfilmentItemId: item.salesFulfilmentItemId,
      quantityReturned: item.quantityReturned,
      unitCost: item.unitCost,
      unitPrice: item.unitPrice,
      quantityResalable: item.quantityResalable,
      quantityDamaged: item.quantityDamaged,
      quantityQuarantine: item.quantityQuarantine,
      quantityScrap: item.quantityScrap,
      quantityCredited: item.quantityCredited,
    })),
    createdAt: customerReturn.createdAt,
    updatedAt: customerReturn.updatedAt,
  };
}
