import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import {
  CommonEmployeeAccessPolicyInput,
  commonEmployeeAccessPolicySchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../identity/auth/guards/permissions.guard';
import { mergeCommonEmployeeAccessPolicy } from '../identity/authorization/common-access-policy';
import { OrganisationService } from '../identity/organisation/organisation.service';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { ACCESS_AUDIT_ACTIONS } from './access-audit-actions';

/**
 * The organisation-level Common Employee Access policy (docs/domains/access-control.md
 * §6/§11 "Common Employee Access"). Read is open to any authenticated user (every
 * employee needs to know what self-service is available to them); only the write
 * requires `access.common_policy.manage`.
 */
@Controller('access/common-policy')
@UseGuards(JwtAuthGuard)
export class AccessCommonPolicyController {
  constructor(
    private readonly organisationService: OrganisationService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async get(@CurrentUser() user: TokenPayload) {
    const organisation = await this.organisationService.getById(user.organisationId);
    return mergeCommonEmployeeAccessPolicy(organisation?.settings);
  }

  @Patch()
  @UseGuards(PermissionsGuard)
  @RequirePermission('access.common_policy.manage')
  async update(
    @Body(new ZodValidationPipe(commonEmployeeAccessPolicySchema))
    body: CommonEmployeeAccessPolicyInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const organisation = await this.organisationService.getById(user.organisationId);
    const before = mergeCommonEmployeeAccessPolicy(organisation?.settings);
    const next = { ...before, ...body };

    await this.organisationService.updateCommonEmployeeAccessPolicy(user.organisationId, next);

    await this.auditService.record({
      action: ACCESS_AUDIT_ACTIONS.COMMON_POLICY_UPDATED,
      entityType: 'Organisation',
      entityId: user.organisationId,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { before, after: next },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return next;
  }
}
