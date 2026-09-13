import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { PolicyStatus } from '@prisma/client';
import {
  AcknowledgePolicyInput,
  CreatePolicyInput,
  CreatePolicyVersionInput,
  UpdatePolicyInput,
  acknowledgePolicySchema,
  createPolicySchema,
  createPolicyVersionSchema,
  updatePolicySchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { Roles } from '../identity/auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../identity/auth/guards/roles.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { HR_AUDIT_ACTIONS } from './hr-audit-actions';
import { PolicyService } from './policy.service';

@Controller('hr/policies')
@UseGuards(JwtAuthGuard)
export class PolicyController {
  constructor(
    private readonly policyService: PolicyService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async list(@CurrentUser() user: TokenPayload, @Query('status') status?: PolicyStatus) {
    const items = await this.policyService.list(user.organisationId, { status });
    return { items };
  }

  @Get(':id')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.policyService.getById(user.organisationId, id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async create(
    @Body(new ZodValidationPipe(createPolicySchema)) body: CreatePolicyInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const { policy, wasCreated } = await this.policyService.create(user.organisationId, body);
    if (wasCreated) {
      await this.auditService.record({
        action: HR_AUDIT_ACTIONS.POLICY_CREATED,
        entityType: 'Policy',
        entityId: policy.id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { code: policy.code, title: policy.title },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return policy;
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePolicySchema)) body: UpdatePolicyInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.policyService.update(user.organisationId, id, body);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.POLICY_UPDATED,
      entityType: 'Policy',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post(':id/archive')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async archive(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const updated = await this.policyService.archive(user.organisationId, id);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.POLICY_ARCHIVED,
      entityType: 'Policy',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  // --- Versions -----------------------------------------------------------

  @Get(':id/versions')
  async listVersions(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    const items = await this.policyService.listVersions(user.organisationId, id);
    return { items };
  }

  @Post(':id/versions')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async createVersion(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createPolicyVersionSchema)) body: CreatePolicyVersionInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const version = await this.policyService.createVersion(user.organisationId, id, body);
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.POLICY_VERSION_CREATED,
      entityType: 'Policy',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { versionId: version.id, versionNumber: version.versionNumber },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return version;
  }

  @Post(':id/versions/:versionId/publish')
  @UseGuards(RolesGuard)
  @Roles('Owner', 'Administrator')
  async publishVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const version = await this.policyService.publishVersion(
      user.organisationId,
      id,
      versionId,
      user.sub,
    );
    await this.auditService.record({
      action: HR_AUDIT_ACTIONS.POLICY_VERSION_PUBLISHED,
      entityType: 'Policy',
      entityId: id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { versionId: version.id, versionNumber: version.versionNumber },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return version;
  }

  @Post(':id/versions/:versionId/acknowledge')
  async acknowledge(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Body(new ZodValidationPipe(acknowledgePolicySchema)) body: AcknowledgePolicyInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const acknowledgement = await this.policyService.acknowledge(
      user.organisationId,
      versionId,
      body,
      user.sub,
    );
    if (acknowledgement.wasCreated) {
      await this.auditService.record({
        action: HR_AUDIT_ACTIONS.POLICY_ACKNOWLEDGED,
        entityType: 'Policy',
        entityId: id,
        organisationId: user.organisationId,
        actorUserId: user.sub,
        metadata: { versionId, employeeId: acknowledgement.acknowledgement.employeeId },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    }
    return acknowledgement.acknowledgement;
  }
}
