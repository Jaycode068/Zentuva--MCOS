import { Body, Controller, Get, NotFoundException, Patch, Req, UseGuards } from '@nestjs/common';
import { Organisation } from '@prisma/client';
import {
  UpdateOrganisationProfileInput as UpdateOrganisationProfileDto,
  updateOrganisationProfileSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { ZodValidationPipe } from '../auth/common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TokenPayload } from '../auth/ports/token.port';
import { ORGANISATION_AUDIT_ACTIONS } from './organisation-audit-actions';
import { OrganisationService, UpdateOrganisationProfileInput } from './organisation.service';

/**
 * Organisation Management HTTP surface (Sprint 2.1 brief): retrieve and update the
 * authenticated caller's own organisation profile only. Deliberately no
 * create/list/delete/switch-organisation endpoints — out of scope for this sprint.
 *
 * `GET /me` requires only authentication (any role may read). `PATCH /me` additionally
 * requires the Owner or Administrator role (RolesGuard) — Member is read-only, per the
 * brief's "Authorisation (MVP)" section.
 */
@Controller('organisation')
export class OrganisationController {
  constructor(
    private readonly organisationService: OrganisationService,
    private readonly auditService: AuditService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(@CurrentUser() user: TokenPayload) {
    const organisation = await this.organisationService.getById(user.organisationId);
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }
    return toOrganisationProfileResponse(organisation);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('Owner', 'Administrator')
  async updateMe(
    @Body(new ZodValidationPipe(updateOrganisationProfileSchema))
    body: UpdateOrganisationProfileDto,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const organisation = await this.organisationService.updateProfile(
      user.organisationId,
      toDomainInput(body),
    );

    await this.auditService.record({
      action: ORGANISATION_AUDIT_ACTIONS.UPDATED,
      entityType: 'Organisation',
      entityId: organisation.id,
      organisationId: organisation.id,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toOrganisationProfileResponse(organisation);
  }
}

/** Wire-level field names (organisationName, phoneNumber, addressLine, timezone) map to
 *  the underlying Prisma column names (name, phone, addressLine1, timeZone) here — the
 *  DTO/domain boundary is deliberately explicit rather than reusing Prisma names on the
 *  wire. Read-only fields (id, organisationCode, slug, createdAt, updatedAt) never appear
 *  in the input DTO, so there's nothing to strip. */
function toDomainInput(dto: UpdateOrganisationProfileDto): UpdateOrganisationProfileInput {
  return {
    ...(dto.organisationName !== undefined && { name: dto.organisationName }),
    ...(dto.displayName !== undefined && { displayName: dto.displayName }),
    ...(dto.description !== undefined && { description: dto.description }),
    ...(dto.email !== undefined && { businessEmail: dto.email }),
    ...(dto.phoneNumber !== undefined && { phone: dto.phoneNumber }),
    ...(dto.website !== undefined && { website: dto.website }),
    ...(dto.country !== undefined && { country: dto.country }),
    ...(dto.state !== undefined && { state: dto.state }),
    ...(dto.city !== undefined && { city: dto.city }),
    ...(dto.addressLine !== undefined && { addressLine1: dto.addressLine }),
    ...(dto.industry !== undefined && { industry: dto.industry }),
    ...(dto.currency !== undefined && { currency: dto.currency }),
    ...(dto.timezone !== undefined && { timeZone: dto.timezone }),
  };
}

function toOrganisationProfileResponse(org: Organisation) {
  return {
    id: org.id,
    organisationCode: org.organisationCode,
    slug: org.slug,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
    organisationName: org.name,
    displayName: org.displayName,
    description: org.description,
    email: org.businessEmail,
    phoneNumber: org.phone,
    website: org.website,
    country: org.country,
    state: org.state,
    city: org.city,
    addressLine: org.addressLine1,
    industry: org.industry,
    currency: org.currency,
    timezone: org.timeZone,
  };
}
