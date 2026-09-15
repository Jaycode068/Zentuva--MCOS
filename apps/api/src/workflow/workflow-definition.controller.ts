import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
  CreateWorkflowDefinitionInput,
  UpdateWorkflowDefinitionInput,
  createWorkflowDefinitionSchema,
  updateWorkflowDefinitionSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../identity/audit/audit.service';
import { ZodValidationPipe } from '../identity/auth/common/zod-validation.pipe';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { RequirePermission } from '../identity/auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../identity/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../identity/auth/guards/permissions.guard';
import { TokenPayload } from '../identity/auth/ports/token.port';
import { WORKFLOW_AUDIT_ACTIONS } from './workflow-audit-actions';
import { WorkflowDefinitionService } from './workflow-definition.service';

/**
 * Workflow Definitions + Steps administration (docs/domains/workflow.md §10). `view`
 * lists/reads; every write requires `workflow.definition.manage`.
 */
@Controller('workflows/definitions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WorkflowDefinitionController {
  constructor(
    private readonly workflowDefinitionService: WorkflowDefinitionService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @RequirePermission('workflow.definition.view')
  async list(@CurrentUser() user: TokenPayload) {
    const items = await this.workflowDefinitionService.listWithUsageCounts(user.organisationId);
    return { items };
  }

  @Get(':id')
  @RequirePermission('workflow.definition.view')
  getOne(@CurrentUser() user: TokenPayload, @Param('id') id: string) {
    return this.workflowDefinitionService.getByIdOrThrow(user.organisationId, id);
  }

  @Post()
  @RequirePermission('workflow.definition.manage')
  async create(
    @Body(new ZodValidationPipe(createWorkflowDefinitionSchema))
    body: CreateWorkflowDefinitionInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const definition = await this.workflowDefinitionService.create(
      user.organisationId,
      body,
      user.sub,
    );
    await this.auditService.record({
      action: WORKFLOW_AUDIT_ACTIONS.DEFINITION_CREATED,
      entityType: 'WorkflowDefinition',
      entityId: definition.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { code: definition.code, subjectType: definition.subjectType },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return definition;
  }

  @Patch(':id')
  @RequirePermission('workflow.definition.manage')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWorkflowDefinitionSchema))
    body: UpdateWorkflowDefinitionInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const updated = await this.workflowDefinitionService.update(
      user.organisationId,
      id,
      body,
      user.sub,
    );
    await this.auditService.record({
      action: WORKFLOW_AUDIT_ACTIONS.DEFINITION_UPDATED,
      entityType: 'WorkflowDefinition',
      entityId: updated.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { fields: Object.keys(body) },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return updated;
  }

  @Post(':id/activate')
  @RequirePermission('workflow.definition.manage')
  async activate(@Param('id') id: string, @CurrentUser() user: TokenPayload, @Req() req: Request) {
    const definition = await this.workflowDefinitionService.activate(
      user.organisationId,
      id,
      user.sub,
    );
    await this.auditService.record({
      action: WORKFLOW_AUDIT_ACTIONS.DEFINITION_ACTIVATED,
      entityType: 'WorkflowDefinition',
      entityId: definition.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return definition;
  }

  @Post(':id/deactivate')
  @RequirePermission('workflow.definition.manage')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    const definition = await this.workflowDefinitionService.deactivate(
      user.organisationId,
      id,
      user.sub,
    );
    await this.auditService.record({
      action: WORKFLOW_AUDIT_ACTIONS.DEFINITION_DEACTIVATED,
      entityType: 'WorkflowDefinition',
      entityId: definition.id,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return definition;
  }
}
