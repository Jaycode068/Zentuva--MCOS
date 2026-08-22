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
import { Territory, TerritoryStatus } from '@prisma/client';
import {
  CreateTerritoryInput,
  UpdateTerritoryInput,
  createTerritorySchema,
  updateTerritorySchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { TERRITORY_AUDIT_ACTIONS } from './territory-audit-actions';
import { TerritoryService } from './territory.service';

/**
 * Territory HTTP surface (Sprint 4.8, docs/domains/territories.md). `GET` requires only
 * authentication — Member has read-only access; every write additionally requires the
 * Owner or Administrator role (`RolesGuard`).
 *
 * Tenant isolation: every method resolves the target territory by `(id, organisationId)`
 * together, same convention as every other domain controller.
 */
@Controller('retail/territories')
@UseGuards(JwtAuthGuard)
export class TerritoryController {
  constructor(
    private readonly territoryService: TerritoryService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: TerritoryStatus,
    @Query('parentTerritoryId') parentTerritoryId?: string,
    @Query('search') search?: string,
  ) {
    const territories = await this.territoryService.list(user.organisationId, {
      status,
      parentTerritoryId,
      search: search?.trim() || undefined,
    });
    return { items: territories.map(toTerritoryResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const territory = await this.territoryService.getById(user.organisationId, id);
    if (!territory) {
      throw new NotFoundException('Territory not found');
    }
    return toTerritoryResponse(territory);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createTerritorySchema)) body: CreateTerritoryInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const created = await this.territoryService.create(user.organisationId, body, user.sub);

    await this.auditService.record({
      action: TERRITORY_AUDIT_ACTIONS.CREATED,
      entityType: 'Territory',
      entityId: created.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { territoryCode: created.territoryCode, name: created.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toTerritoryResponse(created);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTerritorySchema)) body: UpdateTerritoryInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.territoryService.update(user.organisationId, id, body, user.sub);

    await this.auditService.record({
      action: TERRITORY_AUDIT_ACTIONS.UPDATED,
      entityType: 'Territory',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { fields: Object.keys(body) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toTerritoryResponse(updated);
  }

  @Post(':id/activate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.territoryService.activate(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: TERRITORY_AUDIT_ACTIONS.ACTIVATED,
      entityType: 'Territory',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toTerritoryResponse(updated);
  }

  @Post(':id/deactivate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.territoryService.deactivate(user.organisationId, id, user.sub);

    await this.auditService.record({
      action: TERRITORY_AUDIT_ACTIONS.DEACTIVATED,
      entityType: 'Territory',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toTerritoryResponse(updated);
  }
}

function toTerritoryResponse(territory: Territory) {
  return {
    id: territory.id,
    territoryCode: territory.territoryCode,
    name: territory.name,
    type: territory.type,
    parentTerritoryId: territory.parentTerritoryId,
    status: territory.status,
    description: territory.description,
    createdAt: territory.createdAt,
    updatedAt: territory.updatedAt,
  };
}
