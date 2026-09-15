import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessScope, WorkflowDefinitionStatus } from '@prisma/client';

import { PERMISSION_CATALOGUE } from '../identity/authorization/permission-catalogue';
import { UserService } from '../identity/user/user.service';
import {
  CreateWorkflowStepInput,
  ListWorkflowDefinitionsParams,
  WorkflowDefinitionRepository,
  WorkflowDefinitionWithSteps,
} from './workflow-definition.repository';

export interface WorkflowStepDraft {
  name: string;
  code: string;
  sequence: number;
  requiredPermission: string;
  requiredScope?: AccessScope;
  assignedUserId?: string | null;
}

export interface CreateWorkflowDefinitionInput {
  name: string;
  code: string;
  description?: string;
  subjectType: string;
  allowSelfApproval?: boolean;
  steps: WorkflowStepDraft[];
}

export interface UpdateWorkflowDefinitionInput {
  name?: string;
  description?: string | null;
  allowSelfApproval?: boolean;
  steps?: WorkflowStepDraft[];
}

const VALID_PERMISSION_KEYS = new Set(PERMISSION_CATALOGUE.map((p) => p.key));

/**
 * Domain service for `WorkflowDefinition` + `WorkflowStep` (Sprint 26, docs/domains/
 * workflow.md §3.1-§3.3). Owns every validation rule the admin UI's Workflow
 * Definitions page depends on: at least one step, unique step codes/sequences, real
 * catalogue permissions, same-tenant explicit approvers, and "don't let an edit to an
 * already-`ACTIVE` definition silently corrupt an in-progress instance."
 */
@Injectable()
export class WorkflowDefinitionService {
  constructor(
    private readonly workflowDefinitionRepository: WorkflowDefinitionRepository,
    private readonly userService: UserService,
  ) {}

  getById(organisationId: string, id: string): Promise<WorkflowDefinitionWithSteps | null> {
    return this.workflowDefinitionRepository.findById(organisationId, id);
  }

  async getByIdOrThrow(organisationId: string, id: string): Promise<WorkflowDefinitionWithSteps> {
    const definition = await this.workflowDefinitionRepository.findById(organisationId, id);
    if (!definition) {
      throw new NotFoundException('Workflow definition not found');
    }
    return definition;
  }

  getByCode(organisationId: string, code: string): Promise<WorkflowDefinitionWithSteps | null> {
    return this.workflowDefinitionRepository.findByCode(organisationId, code);
  }

  list(
    organisationId: string,
    params?: ListWorkflowDefinitionsParams,
  ): Promise<WorkflowDefinitionWithSteps[]> {
    return this.workflowDefinitionRepository.findManyByOrganisation(organisationId, params);
  }

  async listWithUsageCounts(organisationId: string) {
    const definitions = await this.list(organisationId);
    return Promise.all(
      definitions.map(async (definition) => ({
        ...definition,
        instanceCount: await this.workflowDefinitionRepository.countInstances(
          organisationId,
          definition.id,
        ),
      })),
    );
  }

  async create(
    organisationId: string,
    input: CreateWorkflowDefinitionInput,
    actorUserId: string,
  ): Promise<WorkflowDefinitionWithSteps> {
    const steps = await this.validateSteps(organisationId, input.steps);
    const existing = await this.workflowDefinitionRepository.findByCode(organisationId, input.code);
    if (existing) {
      throw new BadRequestException(
        `A workflow definition with code "${input.code}" already exists`,
      );
    }

    return this.workflowDefinitionRepository.createWithSteps(
      {
        organisationId,
        name: input.name,
        code: input.code,
        description: input.description,
        subjectType: input.subjectType,
        allowSelfApproval: input.allowSelfApproval ?? false,
        createdById: actorUserId,
        updatedById: actorUserId,
      },
      steps,
    );
  }

  /** Edits to `name`/`description`/`allowSelfApproval` are always safe. Editing `steps`
   *  is rejected while any non-terminal instance of this definition exists — workflow.md
   *  §3.5 "avoid editing active definitions in a way that changes in-progress
   *  instances." An in-progress instance is unaffected either way (its
   *  `WorkflowStepInstance` rows already snapshotted the old configuration), but
   *  allowing a step-list edit mid-flight would be confusing even though it's not
   *  technically unsafe — simpler and clearer to require the admin wait for existing
   *  instances to finish (or cancel them) before reconfiguring steps. */
  async update(
    organisationId: string,
    id: string,
    input: UpdateWorkflowDefinitionInput,
    actorUserId: string,
  ): Promise<WorkflowDefinitionWithSteps> {
    const existing = await this.getByIdOrThrow(organisationId, id);

    let steps: CreateWorkflowStepInput[] | undefined;
    let versionBump: { version: number } | undefined;
    if (input.steps) {
      const activeCount = await this.workflowDefinitionRepository.countActiveInstances(
        organisationId,
        id,
      );
      if (activeCount > 0) {
        throw new BadRequestException(
          `Cannot change steps while ${activeCount} workflow instance(s) are still in progress. ` +
            'Wait for them to complete, or cancel them, first.',
        );
      }
      steps = await this.validateSteps(organisationId, input.steps);
      versionBump = { version: existing.version + 1 };
    }

    const updated = await this.workflowDefinitionRepository.update(
      organisationId,
      id,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.allowSelfApproval !== undefined
          ? { allowSelfApproval: input.allowSelfApproval }
          : {}),
        ...versionBump,
        updatedById: actorUserId,
      },
      steps,
    );
    if (!updated) {
      throw new NotFoundException('Workflow definition not found');
    }
    return updated;
  }

  /** A definition cannot be activated with zero steps — the one configuration state
   *  that would let a submission "succeed" into an instance with no approval step at
   *  all. Step-level validation (real permissions, same-tenant approvers, unique
   *  codes/sequences) already happened at create/update time, so activation only needs
   *  this one additional check. */
  async activate(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<WorkflowDefinitionWithSteps> {
    const existing = await this.getByIdOrThrow(organisationId, id);
    if (existing.steps.length === 0) {
      throw new BadRequestException('Cannot activate a workflow definition with no steps');
    }
    const updated = await this.workflowDefinitionRepository.update(organisationId, id, {
      status: WorkflowDefinitionStatus.ACTIVE,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Workflow definition not found');
    }
    return updated;
  }

  async deactivate(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<WorkflowDefinitionWithSteps> {
    const updated = await this.workflowDefinitionRepository.update(organisationId, id, {
      status: WorkflowDefinitionStatus.INACTIVE,
      updatedById: actorUserId,
    });
    if (!updated) {
      throw new NotFoundException('Workflow definition not found');
    }
    return updated;
  }

  /** Every rule from workflow.md §"Provide clear validation": at least one step, unique
   *  step codes, unique sequences, real catalogue permission keys, and (if an explicit
   *  approver is set) a User that actually belongs to this organisation. */
  private async validateSteps(
    organisationId: string,
    steps: WorkflowStepDraft[],
  ): Promise<CreateWorkflowStepInput[]> {
    if (steps.length === 0) {
      throw new BadRequestException('A workflow definition must have at least one step');
    }

    const codes = new Set<string>();
    const sequences = new Set<number>();
    for (const step of steps) {
      if (codes.has(step.code)) {
        throw new BadRequestException(`Duplicate step code "${step.code}"`);
      }
      codes.add(step.code);

      if (sequences.has(step.sequence)) {
        throw new BadRequestException(`Duplicate step sequence ${step.sequence}`);
      }
      sequences.add(step.sequence);

      if (!VALID_PERMISSION_KEYS.has(step.requiredPermission)) {
        throw new BadRequestException(
          `"${step.requiredPermission}" is not a permission in the catalogue`,
        );
      }

      if (step.assignedUserId) {
        const user = await this.userService.getById(organisationId, step.assignedUserId);
        if (!user) {
          throw new BadRequestException(
            `Assigned approver ${step.assignedUserId} does not belong to this organisation`,
          );
        }
      }
    }

    return steps;
  }
}
