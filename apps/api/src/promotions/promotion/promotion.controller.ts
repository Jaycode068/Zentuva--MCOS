import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PromotionStatus } from '@prisma/client';
import {
  CreatePromotionInput,
  UpdatePromotionInput,
  createPromotionSchema,
  paginationSchema,
  updatePromotionSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { PROMOTION_AUDIT_ACTIONS } from './promotion-audit-actions';
import { PromotionWithRelations } from './promotion.repository';
import { PromotionService } from './promotion.service';
import {
  InvalidPromotionConditionError,
  InvalidPromotionTransitionError,
  PromotionNotActivatableError,
  PromotionNotEditableError,
} from './promotion.types';

/**
 * Sprint 40 — Promotion HTTP surface (docs/domains/d2c.md). `promotions.promotion.view`
 * gates reads; `.manage` gates every mutation (create/edit/activate/pause/resume) — the
 * one authoring surface a business user configures a new commercial promotion through,
 * never a code change (docs/domains/d2c.md "Critical Business Requirement").
 */
@Controller('promotions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PromotionController {
  constructor(
    private readonly promotionService: PromotionService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission('promotions.promotion.view')
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('page') pageRaw?: string,
    @Query('pageSize') pageSizeRaw?: string,
    @Query('status') status?: PromotionStatus,
    @Query('search') search?: string,
  ) {
    const { page, pageSize } = paginationSchema.parse({ page: pageRaw, pageSize: pageSizeRaw });
    const { items, total } = await this.promotionService.list(user.organisationId, {
      status,
      search: search?.trim() || undefined,
      page,
      pageSize,
    });
    return { items: items.map(toPromotionResponse), total, page, pageSize };
  }

  @Get(':id')
  @RequirePermission('promotions.promotion.view')
  async getOne(@Param('id') id: string, @CurrentUser() user: TokenPayload) {
    const promotion = await this.promotionService.getById(user.organisationId, id);
    return toPromotionResponse(promotion);
  }

  @Post()
  @RequirePermission('promotions.promotion.manage')
  async create(
    @Body(new ZodValidationPipe(createPromotionSchema)) body: CreatePromotionInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    try {
      const promotion = await this.promotionService.create(user.organisationId, body, user.sub);
      await this.auditService.record({
        action: PROMOTION_AUDIT_ACTIONS.CREATED,
        entityType: 'Promotion',
        entityId: promotion.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { name: promotion.name },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return toPromotionResponse(promotion);
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @Patch(':id')
  @RequirePermission('promotions.promotion.manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePromotionSchema)) body: UpdatePromotionInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    try {
      const promotion = await this.promotionService.update(user.organisationId, id, body, user.sub);
      await this.auditService.record({
        action: PROMOTION_AUDIT_ACTIONS.UPDATED,
        entityType: 'Promotion',
        entityId: id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { fields: Object.keys(body) },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return toPromotionResponse(promotion);
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @Post(':id/activate')
  @RequirePermission('promotions.promotion.manage')
  async activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    try {
      const promotion = await this.promotionService.activate(user.organisationId, id, user.sub);
      await this.auditService.record({
        action: PROMOTION_AUDIT_ACTIONS.ACTIVATED,
        entityType: 'Promotion',
        entityId: id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return toPromotionResponse(promotion);
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @Post(':id/pause')
  @RequirePermission('promotions.promotion.manage')
  async pause(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    try {
      const promotion = await this.promotionService.pause(user.organisationId, id, user.sub);
      await this.auditService.record({
        action: PROMOTION_AUDIT_ACTIONS.PAUSED,
        entityType: 'Promotion',
        entityId: id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return toPromotionResponse(promotion);
    } catch (error) {
      throw toHttpException(error);
    }
  }

  @Post(':id/resume')
  @RequirePermission('promotions.promotion.manage')
  async resume(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    try {
      const promotion = await this.promotionService.resume(user.organisationId, id, user.sub);
      await this.auditService.record({
        action: PROMOTION_AUDIT_ACTIONS.RESUMED,
        entityType: 'Promotion',
        entityId: id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      return toPromotionResponse(promotion);
    } catch (error) {
      throw toHttpException(error);
    }
  }
}

function toHttpException(error: unknown): Error {
  if (
    error instanceof PromotionNotEditableError ||
    error instanceof InvalidPromotionTransitionError ||
    error instanceof PromotionNotActivatableError ||
    error instanceof InvalidPromotionConditionError
  ) {
    return new BadRequestException(error.message);
  }
  if (error instanceof Error) {
    return error;
  }
  return new BadRequestException('Unexpected error');
}

function toPromotionResponse(promotion: PromotionWithRelations) {
  return {
    id: promotion.id,
    name: promotion.name,
    description: promotion.description,
    status: promotion.status,
    startsAt: promotion.startsAt,
    endsAt: promotion.endsAt,
    activatedAt: promotion.activatedAt,
    conditions: promotion.conditions,
    benefits: promotion.benefits,
    createdAt: promotion.createdAt,
    updatedAt: promotion.updatedAt,
  };
}
