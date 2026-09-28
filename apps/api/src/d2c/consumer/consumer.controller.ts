import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Consumer, ConsumerLocationRequest, ConsumerStatus } from '@prisma/client';
import {
  CreateConsumerLocationRequestInput,
  RegisterConsumerInput,
  ResolveConsumerLocationRequestInput,
  UpdateConsumerLocationInput,
  UpdateConsumerProfileInput,
  createConsumerLocationRequestSchema,
  registerConsumerSchema,
  resolveConsumerLocationRequestSchema,
  updateConsumerLocationSchema,
  updateConsumerProfileSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { CONSUMER_AUDIT_ACTIONS } from './consumer-audit-actions';
import { ConsumerService } from './consumer.service';

/**
 * Consumer HTTP surface (Sprint 32, docs/domains/d2c.md). INTERNAL/ADMIN
 * ONLY — every route requires authentication and the `d2c.consumer.*`
 * permission, exactly like `CustomerController`. There is deliberately no
 * public, unauthenticated, or "my own" consumer-facing route in this sprint
 * (unlike the public careers page): no consumer-facing channel exists yet.
 * The future WhatsApp/simulator adapters are expected to call
 * `ConsumerService` directly, never through this permission-gated surface
 * (docs/domains/d2c.md §2).
 *
 * Tenant isolation: every method resolves the target consumer by
 * `(id, organisationId)` together, same convention as every other domain
 * controller.
 */
@Controller('d2c/consumers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConsumerController {
  constructor(
    private readonly consumerService: ConsumerService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission('d2c.consumer.view')
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: ConsumerStatus,
    @Query('territoryId') territoryId?: string,
    @Query('search') search?: string,
  ) {
    const consumers = await this.consumerService.list(user.organisationId, {
      status,
      territoryId,
      search: search?.trim() || undefined,
    });
    return { items: consumers.map(toConsumerResponse) };
  }

  @Get('location-requests')
  @RequirePermission('d2c.consumer.view')
  async listLocationRequests(
    @CurrentUser() user: TokenPayload,
    @Query('openOnly') openOnly?: string,
  ) {
    const requests = await this.consumerService.listLocationRequests(
      user.organisationId,
      openOnly === undefined ? undefined : openOnly !== 'false',
    );
    return { items: requests.map(toLocationRequestResponse) };
  }

  @Post('location-requests/:id/resolve')
  @RequirePermission('d2c.consumer.manage')
  async resolveLocationRequest(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resolveConsumerLocationRequestSchema))
    body: ResolveConsumerLocationRequestInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { resolved } = await this.consumerService.resolveLocationRequest(
      user.organisationId,
      id,
      user.sub,
      body.resolutionNotes,
    );
    if (!resolved) {
      throw new NotFoundException('Location request not found or already resolved');
    }
    await this.auditService.record({
      action: CONSUMER_AUDIT_ACTIONS.LOCATION_REQUEST_RESOLVED,
      entityType: 'ConsumerLocationRequest',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { resolved: true };
  }

  @Get(':id')
  @RequirePermission('d2c.consumer.view')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const consumer = await this.consumerService.getConsumerProfile(user.organisationId, id);
    if (!consumer) {
      throw new NotFoundException('Consumer not found');
    }
    return toConsumerResponse(consumer);
  }

  @Post()
  @RequirePermission('d2c.consumer.manage')
  async register(
    @Body(new ZodValidationPipe(registerConsumerSchema)) body: RegisterConsumerInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { consumer, created } = await this.consumerService.registerConsumer(
      user.organisationId,
      body,
      user.sub,
    );

    if (created) {
      await this.auditService.record({
        action: CONSUMER_AUDIT_ACTIONS.REGISTERED,
        entityType: 'Consumer',
        entityId: consumer.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: {
          consumerCode: consumer.consumerCode,
          normalizedPhone: consumer.normalizedPhone,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return { ...toConsumerResponse(consumer), alreadyRegistered: !created };
  }

  @Patch(':id')
  @RequirePermission('d2c.consumer.manage')
  async updateProfile(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateConsumerProfileSchema)) body: UpdateConsumerProfileInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.consumerService.updateProfile(
      user.organisationId,
      id,
      body,
      user.sub,
    );

    await this.auditService.record({
      action: CONSUMER_AUDIT_ACTIONS.PROFILE_UPDATED,
      entityType: 'Consumer',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { fields: Object.keys(body) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toConsumerResponse(updated);
  }

  @Patch(':id/location')
  @RequirePermission('d2c.consumer.manage')
  async updateLocation(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateConsumerLocationSchema)) body: UpdateConsumerLocationInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.consumerService.updateConsumerLocation(
      user.organisationId,
      id,
      body.territoryId ?? null,
      user.sub,
    );

    await this.auditService.record({
      action: CONSUMER_AUDIT_ACTIONS.LOCATION_UPDATED,
      entityType: 'Consumer',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { territoryId: updated.territoryId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toConsumerResponse(updated);
  }

  @Post(':id/activate')
  @RequirePermission('d2c.consumer.manage')
  async activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.consumerService.activate(user.organisationId, id, user.sub);
    await this.auditService.record({
      action: CONSUMER_AUDIT_ACTIONS.ACTIVATED,
      entityType: 'Consumer',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toConsumerResponse(updated);
  }

  @Post(':id/suspend')
  @RequirePermission('d2c.consumer.manage')
  async suspend(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.consumerService.suspend(user.organisationId, id, user.sub);
    await this.auditService.record({
      action: CONSUMER_AUDIT_ACTIONS.SUSPENDED,
      entityType: 'Consumer',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toConsumerResponse(updated);
  }

  @Post(':id/deactivate')
  @RequirePermission('d2c.consumer.manage')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.consumerService.deactivate(user.organisationId, id, user.sub);
    await this.auditService.record({
      action: CONSUMER_AUDIT_ACTIONS.DEACTIVATED,
      entityType: 'Consumer',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toConsumerResponse(updated);
  }

  @Post(':id/location-requests')
  @RequirePermission('d2c.consumer.manage')
  async reportLocationNotFound(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createConsumerLocationRequestSchema))
    body: CreateConsumerLocationRequestInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const request = await this.consumerService.reportLocationNotFound(
      user.organisationId,
      id,
      body.rawLocationText,
    );
    await this.auditService.record({
      action: CONSUMER_AUDIT_ACTIONS.LOCATION_REQUEST_CREATED,
      entityType: 'ConsumerLocationRequest',
      entityId: request.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { consumerId: id },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return toLocationRequestResponse(request);
  }
}

/** Hand-built response shape — never a raw Prisma entity (docs/domains/d2c.md
 *  §9 "Public vs Internal Data"). Every field here is already
 *  internal/admin-appropriate; the DISTINCTION this comment documents is for
 *  a FUTURE consumer-facing/WhatsApp response shape, which must be built
 *  separately and expose strictly less (no `id`, no audit actor ids, no raw
 *  `createdById`/`updatedById`) — never this same function reused as-is. */
function toConsumerResponse(consumer: Consumer) {
  return {
    id: consumer.id,
    consumerCode: consumer.consumerCode,
    fullName: consumer.fullName,
    phoneNumber: consumer.phoneNumber,
    normalizedPhone: consumer.normalizedPhone,
    email: consumer.email,
    status: consumer.status,
    territoryId: consumer.territoryId,
    address: consumer.address,
    marketingOptIn: consumer.marketingOptIn,
    createdAt: consumer.createdAt,
    updatedAt: consumer.updatedAt,
  };
}

function toLocationRequestResponse(request: ConsumerLocationRequest) {
  return {
    id: request.id,
    consumerId: request.consumerId,
    rawLocationText: request.rawLocationText,
    resolvedAt: request.resolvedAt,
    resolvedByUserId: request.resolvedByUserId,
    resolutionNotes: request.resolutionNotes,
    createdAt: request.createdAt,
  };
}
