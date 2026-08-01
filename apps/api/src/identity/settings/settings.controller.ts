import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { Organisation } from '@prisma/client';
import {
  updateWorkspaceSettingsSchema,
  type UpdateWorkspaceSettingsInput,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { ZodValidationPipe } from '../auth/common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TokenPayload } from '../auth/ports/token.port';
import { assertValidImageFile } from '../common/image-upload-validation';
import {
  OrganisationService,
  UpdateWorkspaceSettingsPatch,
} from '../organisation/organisation.service';
import { mergeWorkspaceSettings } from '../organisation/workspace-settings';
import { WORKSPACE_AUDIT_ACTIONS } from '../organisation/workspace-audit-actions';

const LOGO_VARIANTS = new Set(['light', 'dark']);

type LogoVariant = 'light' | 'dark';

/**
 * The Workspace Configuration HTTP surface (Sprint 3.4 brief): `GET`/`PATCH
 * /api/settings/workspace` and `POST`/`DELETE /api/settings/logo`. `GET` requires only
 * authentication (any role may view the workspace's branding/settings — matches
 * `OrganisationController`'s `GET /me` precedent, Sprint 2.1); every write requires Owner
 * or Administrator (`RolesGuard`), same as that controller's `PATCH /me`. Reuses
 * `OrganisationService` throughout — no new repository.
 */
@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(
    private readonly organisationService: OrganisationService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {}

  @Get('workspace')
  async getWorkspace(@CurrentUser() user: TokenPayload) {
    const organisation = await this.organisationService.getById(user.organisationId);
    if (!organisation) {
      throw new NotFoundException('Organisation not found');
    }
    return toWorkspaceSettingsResponse(organisation);
  }

  @Patch('workspace')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async updateWorkspace(
    @Body(new ZodValidationPipe(updateWorkspaceSettingsSchema)) body: UpdateWorkspaceSettingsInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const organisation = await this.organisationService.updateWorkspaceSettings(
      user.organisationId,
      toDomainPatch(body),
    );

    await this.auditService.record({
      action: WORKSPACE_AUDIT_ACTIONS.UPDATED,
      entityType: 'Organisation',
      entityId: organisation.id,
      organisationId: organisation.id,
      actorUserId: user.sub,
      metadata: { fields: Object.keys(body) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toWorkspaceSettingsResponse(organisation);
  }

  @Post('logo')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  @UseInterceptors(FileInterceptor('file'))
  async uploadLogo(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('variant') variantRaw: string | undefined,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded — attach it as multipart field "file"');
    }
    const variant = parseVariant(variantRaw);
    assertValidImageFile(file, this.config, 'Logo');

    const organisation = await this.organisationService.setLogo(user.organisationId, variant, {
      mimeType: file.mimetype,
      buffer: file.buffer,
    });

    await this.auditService.record({
      action: WORKSPACE_AUDIT_ACTIONS.LOGO_UPLOADED,
      entityType: 'Organisation',
      entityId: organisation.id,
      organisationId: organisation.id,
      actorUserId: user.sub,
      metadata: { variant, mimeType: file.mimetype, sizeBytes: file.size },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toWorkspaceSettingsResponse(organisation);
  }

  @Delete('logo')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async deleteLogo(
    @Query('variant') variantRaw: string | undefined,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const variant = parseVariant(variantRaw);
    const organisation = await this.organisationService.removeLogo(user.organisationId, variant);

    await this.auditService.record({
      action: WORKSPACE_AUDIT_ACTIONS.LOGO_REMOVED,
      entityType: 'Organisation',
      entityId: organisation.id,
      organisationId: organisation.id,
      actorUserId: user.sub,
      metadata: { variant },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return toWorkspaceSettingsResponse(organisation);
  }
}

function parseVariant(raw: string | undefined): LogoVariant {
  const value = raw ?? 'light';
  if (!LOGO_VARIANTS.has(value)) {
    throw new BadRequestException('variant must be "light" or "dark"');
  }
  return value as LogoVariant;
}

/**
 * Wire-level field names (Sprint 3.4: `manufacturingSector`, plus everything
 * `updateOrganisationProfileSchema` already defines) map to their Prisma column names
 * here — same explicit wire/domain boundary `OrganisationController.toDomainInput`
 * established in Sprint 2.1.
 */
function toDomainPatch(dto: UpdateWorkspaceSettingsInput): UpdateWorkspaceSettingsPatch {
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
    ...(dto.timeFormat !== undefined && { timeFormat: dto.timeFormat }),
    ...(dto.numberFormat !== undefined && { numberFormat: dto.numberFormat }),
    ...(dto.fiscalYearStart !== undefined && { fiscalYearStart: dto.fiscalYearStart }),
    ...(dto.manufacturingSector !== undefined && { businessType: dto.manufacturingSector }),
    ...(dto.registrationNumber !== undefined && { registrationNumber: dto.registrationNumber }),
    ...(dto.taxId !== undefined && { taxId: dto.taxId }),
    ...(dto.employeeCount !== undefined && { employeeCount: dto.employeeCount }),
    ...(dto.primaryColor !== undefined && { primaryColor: dto.primaryColor }),
    ...(dto.accentColor !== undefined && { accentColor: dto.accentColor }),
    ...(dto.theme !== undefined && { theme: dto.theme }),
    ...(dto.preferences !== undefined && { preferences: dto.preferences }),
  };
}

function toWorkspaceSettingsResponse(org: Organisation) {
  const settings = mergeWorkspaceSettings(org.settings);
  return {
    id: org.id,
    organisationCode: org.organisationCode,
    slug: org.slug,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,

    // General
    organisationName: org.name,
    displayName: org.displayName,
    description: org.description,
    email: org.businessEmail,
    phoneNumber: org.phone,
    website: org.website,

    // Branding
    logoUrl: org.logoUrl,
    darkLogoUrl: org.darkLogoUrl,
    primaryColor: org.primaryColor,
    accentColor: org.accentColor,
    theme: settings.theme,

    // Regional
    country: org.country,
    state: org.state,
    city: org.city,
    addressLine: org.addressLine1,
    currency: org.currency,
    timezone: org.timeZone,
    dateFormat: org.dateFormat,
    timeFormat: org.timeFormat,
    numberFormat: org.numberFormat,
    fiscalYearStart: org.fiscalYearStart,

    // Business
    industry: org.industry,
    manufacturingSector: org.businessType,
    registrationNumber: org.registrationNumber,
    taxId: org.taxId,
    employeeCount: org.employeeCount,

    // Preferences
    preferences: settings.preferences,
  };
}
