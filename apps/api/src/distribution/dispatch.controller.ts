import {
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
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { DispatchStatus } from '@prisma/client';
import {
  CreateDeliveryInput,
  CreateDispatchInput,
  FailDispatchInput,
  createDeliverySchema,
  createDispatchSchema,
  failDispatchSchema,
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
import { DISTRIBUTION_AUDIT_ACTIONS } from './distribution-audit-actions';
import { DeliveryService } from './delivery.service';
import { DeliveryWithItems } from './delivery.repository';
import { DispatchService } from './dispatch.service';
import { DispatchWithRelations } from './dispatch.repository';

/**
 * Distribution HTTP surface (Sprint 5, docs/domains/distribution.md). `GET` requires
 * only authentication — Member has read-only access; every write additionally requires
 * the Owner or Administrator role (`RolesGuard`), same convention as
 * `SalesOrderController`.
 *
 * Tenant isolation: every method resolves the target dispatch/delivery by
 * `(id, organisationId)` together, same convention as every other domain controller.
 */
@Controller('distribution')
@UseGuards(JwtAuthGuard)
export class DispatchController {
  constructor(
    private readonly dispatchService: DispatchService,
    private readonly deliveryService: DeliveryService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {}

  /** `GET /fulfilments/:salesFulfilmentId/dispatch-availability` — read-only, auth-only.
   *  Never gates `create()`; purely informational. Declared before the `:id` routes so
   *  Nest's router doesn't try to match `fulfilments` as a dispatch id. */
  @Get('fulfilments/:salesFulfilmentId/dispatch-availability')
  async getDispatchAvailability(
    @CurrentUser() user: TokenPayload,
    @Param('salesFulfilmentId') salesFulfilmentId: string,
  ) {
    const items = await this.dispatchService.getDispatchAvailability(
      user.organisationId,
      salesFulfilmentId,
    );
    return { items };
  }

  /** `POST /deliveries/:deliveryId/photo` — proof-of-delivery capture. Declared before
   *  the `:id` routes for the same routing reason as above. */
  @Post('deliveries/:deliveryId/photo')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDeliveryPhoto(
    @Param('deliveryId') deliveryId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded — attach it as multipart field "file"');
    }
    assertValidImageFile(file, this.config, 'Delivery photo');

    const updated = await this.deliveryService.setPhoto(user.organisationId, deliveryId, {
      mimeType: file.mimetype,
      buffer: file.buffer,
    });

    await this.auditService.record({
      action: DISTRIBUTION_AUDIT_ACTIONS.DELIVERY_PHOTO_UPLOADED,
      entityType: 'Delivery',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { mimeType: file.mimetype, sizeBytes: file.size },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toDeliveryResponse(updated);
  }

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: DispatchStatus,
    @Query('customerId') customerId?: string,
    @Query('salesOrderId') salesOrderId?: string,
    @Query('search') search?: string,
  ) {
    const dispatches = await this.dispatchService.list(user.organisationId, {
      status,
      customerId,
      salesOrderId,
      search: search?.trim() || undefined,
    });
    return { items: dispatches.map(toDispatchResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const dispatch = await this.dispatchService.getById(user.organisationId, id);
    return toDispatchResponse(dispatch);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createDispatchSchema)) body: CreateDispatchInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { dispatch, wasCreated } = await this.dispatchService.create(
      user.organisationId,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: DISTRIBUTION_AUDIT_ACTIONS.DISPATCH_CREATED,
        entityType: 'Dispatch',
        entityId: dispatch.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          dispatchCode: dispatch.dispatchCode,
          salesFulfilmentId: dispatch.salesFulfilmentId,
          customerId: dispatch.customerId,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toDispatchResponse(dispatch);
  }

  @Post(':id/dispatch')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async dispatchOut(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.dispatchService.dispatch(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: DISTRIBUTION_AUDIT_ACTIONS.DISPATCH_DISPATCHED,
      entityType: 'Dispatch',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toDispatchResponse(updated);
  }

  @Post(':id/in-transit')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async markInTransit(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.dispatchService.markInTransit(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: DISTRIBUTION_AUDIT_ACTIONS.DISPATCH_IN_TRANSIT,
      entityType: 'Dispatch',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toDispatchResponse(updated);
  }

  @Post(':id/cancel')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async cancel(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.dispatchService.cancel(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: DISTRIBUTION_AUDIT_ACTIONS.DISPATCH_CANCELLED,
      entityType: 'Dispatch',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toDispatchResponse(updated);
  }

  @Post(':id/fail')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async fail(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(failDispatchSchema)) body: FailDispatchInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.dispatchService.fail(user.organisationId, id, body, user.sub);

    await this.auditService.record({
      action: DISTRIBUTION_AUDIT_ACTIONS.DISPATCH_FAILED,
      entityType: 'Dispatch',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { notes: updated.notes },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toDispatchResponse(updated);
  }

  @Get(':id/deliveries')
  async listDeliveries(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.deliveryService.listByDispatch(user.organisationId, id);
    return { items: items.map(toDeliveryResponse) };
  }

  /** `POST /:id/deliveries` — the one write in this domain that confirms receipt, never
   *  a second inventory deduction. Only emits an audit event when `wasCreated === true`
   *  — a replayed idempotent request must not double-record history. */
  @Post(':id/deliveries')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async createDelivery(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createDeliverySchema)) body: CreateDeliveryInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { delivery, dispatch, wasCreated } = await this.deliveryService.create(
      user.organisationId,
      id,
      body,
      user.sub,
    );

    if (wasCreated) {
      await this.auditService.record({
        action: DISTRIBUTION_AUDIT_ACTIONS.DELIVERY_RECORDED,
        entityType: 'Dispatch',
        entityId: dispatch.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          deliveryId: delivery.id,
          newStatus: dispatch.status,
          items: delivery.items.length,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return toDispatchResponse(dispatch);
  }
}

function toDeliveryResponse(delivery: DeliveryWithItems) {
  return {
    id: delivery.id,
    dispatchId: delivery.dispatchId,
    deliveryDate: delivery.deliveryDate,
    receivedByName: delivery.receivedByName,
    notes: delivery.notes,
    photoUrl: delivery.photoUrl,
    items: delivery.items.map((item) => ({
      id: item.id,
      product: item.product,
      quantityDelivered: item.quantityDelivered,
    })),
    createdAt: delivery.createdAt,
  };
}

function toDispatchResponse(dispatch: DispatchWithRelations) {
  return {
    id: dispatch.id,
    dispatchCode: dispatch.dispatchCode,
    salesFulfilmentId: dispatch.salesFulfilmentId,
    salesOrder: dispatch.salesOrder,
    customer: dispatch.customer,
    outlet: dispatch.outlet,
    /** Outlet's territory takes precedence over the customer's — the more specific
     *  destination — falling back to the customer's when no outlet is set. Purely a
     *  response-shaping decision; never a new backend dependency. */
    territoryId: dispatch.outlet?.territoryId ?? dispatch.customer.territoryId,
    sourceLocation: dispatch.sourceLocation,
    dispatchDate: dispatch.dispatchDate,
    status: dispatch.status,
    notes: dispatch.notes,
    items: dispatch.items.map((item) => ({
      id: item.id,
      product: item.product,
      salesFulfilmentItemId: item.salesFulfilmentItemId,
      quantityDispatched: item.quantityDispatched,
      quantityDelivered: item.quantityDelivered,
    })),
    createdAt: dispatch.createdAt,
    updatedAt: dispatch.updatedAt,
  };
}
