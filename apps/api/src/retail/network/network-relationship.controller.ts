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
import { DistributionRelationshipType, NetworkRelationshipStatus } from '@prisma/client';
import {
  CreateNetworkRelationshipInput,
  UpdateNetworkRelationshipInput,
  createNetworkRelationshipSchema,
  updateNetworkRelationshipSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../../identity/audit/audit.service';
import { ZodValidationPipe } from '../../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { Roles } from '../../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../identity/auth/guards/roles.guard';
import { TokenPayload } from '../../identity/auth/ports/token.port';
import { NETWORK_RELATIONSHIP_AUDIT_ACTIONS } from './network-relationship-audit-actions';
import { NetworkRelationshipWithCustomers } from './network-relationship.repository';
import { NetworkRelationshipService } from './network-relationship.service';

/**
 * Distribution Network Relationship HTTP surface (Sprint 4.8,
 * docs/domains/retail-network.md). `GET` requires only authentication — Member has
 * read-only access; every write additionally requires the Owner or Administrator role
 * (`RolesGuard`).
 *
 * Tenant isolation: every method resolves the target relationship by `(id,
 * organisationId)` together, same convention as every other domain controller.
 */
@Controller('retail/network-relationships')
@UseGuards(JwtAuthGuard)
export class NetworkRelationshipController {
  constructor(
    private readonly networkRelationshipService: NetworkRelationshipService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: TokenPayload,
    @Query('status') status?: NetworkRelationshipStatus,
    @Query('customerId') customerId?: string,
    @Query('relationshipType') relationshipType?: DistributionRelationshipType,
  ) {
    const relationships = await this.networkRelationshipService.list(user.organisationId, {
      status,
      customerId,
      relationshipType,
    });
    return { items: relationships.map(toNetworkRelationshipResponse) };
  }

  @Get(':id')
  async getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const relationship = await this.networkRelationshipService.getById(user.organisationId, id);
    if (!relationship) {
      throw new NotFoundException('Network relationship not found');
    }
    return toNetworkRelationshipResponse(relationship);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createNetworkRelationshipSchema))
    body: CreateNetworkRelationshipInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const created = await this.networkRelationshipService.create(
      user.organisationId,
      body,
      user.sub,
    );

    await this.auditService.record({
      action: NETWORK_RELATIONSHIP_AUDIT_ACTIONS.CREATED,
      entityType: 'DistributionNetworkRelationship',
      entityId: created.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: {
        sourceCustomerId: created.sourceCustomerId,
        targetCustomerId: created.targetCustomerId,
        relationshipType: created.relationshipType,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toNetworkRelationshipResponse(created);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateNetworkRelationshipSchema))
    body: UpdateNetworkRelationshipInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.networkRelationshipService.update(
      user.organisationId,
      id,
      body,
      user.sub,
    );

    await this.auditService.record({
      action: NETWORK_RELATIONSHIP_AUDIT_ACTIONS.UPDATED,
      entityType: 'DistributionNetworkRelationship',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { fields: Object.keys(body) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toNetworkRelationshipResponse(updated);
  }

  @Post(':id/deactivate')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.networkRelationshipService.deactivate(
      user.organisationId,
      id,
      user.sub,
    );

    await this.auditService.record({
      action: NETWORK_RELATIONSHIP_AUDIT_ACTIONS.DEACTIVATED,
      entityType: 'DistributionNetworkRelationship',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toNetworkRelationshipResponse(updated);
  }
}

function toNetworkRelationshipResponse(relationship: NetworkRelationshipWithCustomers) {
  return {
    id: relationship.id,
    sourceCustomer: relationship.sourceCustomer,
    targetCustomer: relationship.targetCustomer,
    relationshipType: relationship.relationshipType,
    effectiveFrom: relationship.effectiveFrom,
    effectiveTo: relationship.effectiveTo,
    status: relationship.status,
    notes: relationship.notes,
    createdAt: relationship.createdAt,
    updatedAt: relationship.updatedAt,
  };
}
