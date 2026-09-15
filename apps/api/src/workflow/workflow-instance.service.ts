import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WorkflowDecisionType } from '@prisma/client';

import { WorkflowDefinitionService } from './workflow-definition.service';
import { WorkflowEligibilityService } from './workflow-eligibility.service';
import {
  ListWorkflowInstancesParams,
  WorkflowInstanceRepository,
  WorkflowInstanceWithSteps,
} from './workflow-instance.repository';
import { WORKFLOW_SUBJECT_HANDLERS, WorkflowSubjectHandler } from './workflow-subject-handler';

export interface CreateWorkflowInstanceInput {
  workflowDefinitionCode: string;
  subjectType: string;
  subjectId: string;
}

/**
 * Domain service for `WorkflowInstance` + `WorkflowStepInstance` + `WorkflowDecision` —
 * the sequential approval engine itself (Sprint 26, docs/domains/workflow.md §5, §8,
 * §13). Orchestrates: subject validation (via the injected `WorkflowSubjectHandler`
 * array), eligibility (via `WorkflowEligibilityService`), concurrency-safe state
 * transitions (via `WorkflowInstanceRepository`'s conditional `updateMany`s), and the
 * domain callback that lets the owning subject's own status actually move.
 */
@Injectable()
export class WorkflowInstanceService {
  private readonly handlersByType: Map<string, WorkflowSubjectHandler>;

  constructor(
    private readonly workflowInstanceRepository: WorkflowInstanceRepository,
    private readonly workflowDefinitionService: WorkflowDefinitionService,
    private readonly workflowEligibilityService: WorkflowEligibilityService,
    @Inject(WORKFLOW_SUBJECT_HANDLERS) handlers: WorkflowSubjectHandler[],
  ) {
    this.handlersByType = new Map(handlers.map((h) => [h.subjectType, h]));
  }

  private getHandler(subjectType: string): WorkflowSubjectHandler {
    const handler = this.handlersByType.get(subjectType);
    if (!handler) {
      throw new BadRequestException(`Subject type "${subjectType}" is not supported by Workflow`);
    }
    return handler;
  }

  getById(organisationId: string, id: string): Promise<WorkflowInstanceWithSteps | null> {
    return this.workflowInstanceRepository.findById(organisationId, id);
  }

  async getByIdOrThrow(organisationId: string, id: string): Promise<WorkflowInstanceWithSteps> {
    const instance = await this.workflowInstanceRepository.findById(organisationId, id);
    if (!instance) {
      throw new NotFoundException('Workflow instance not found');
    }
    return instance;
  }

  list(
    organisationId: string,
    params?: ListWorkflowInstancesParams,
  ): Promise<WorkflowInstanceWithSteps[]> {
    return this.workflowInstanceRepository.findManyByOrganisation(organisationId, params);
  }

  getDecisionHistory(workflowInstanceId: string) {
    return this.workflowInstanceRepository.findDecisionsByInstance(workflowInstanceId);
  }

  /** `POST /workflows/instances` — workflow.md §7: validates the definition is
   *  `ACTIVE`, the subject type matches, the subject itself is eligible (via its
   *  handler), and no other non-terminal instance already targets this exact subject.
   *  Creates the `WorkflowInstance` in `DRAFT` with every step pre-snapshotted
   *  `PENDING` — nothing about the subject changes yet (that's `submit`'s job). */
  async create(
    organisationId: string,
    input: CreateWorkflowInstanceInput,
    requestedById: string,
  ): Promise<WorkflowInstanceWithSteps> {
    const definition = await this.workflowDefinitionService.getByCode(
      organisationId,
      input.workflowDefinitionCode,
    );
    if (!definition) {
      throw new NotFoundException(
        `Workflow definition "${input.workflowDefinitionCode}" not found`,
      );
    }
    if (definition.status !== 'ACTIVE') {
      throw new BadRequestException('Workflow definition is not active');
    }
    if (definition.subjectType !== input.subjectType) {
      throw new BadRequestException(
        `Workflow definition "${input.workflowDefinitionCode}" does not apply to subject type "${input.subjectType}"`,
      );
    }

    const handler = this.getHandler(input.subjectType);
    const validation = await handler.validateForSubmission(organisationId, input.subjectId);
    if (!validation.ok) {
      throw new BadRequestException(validation.reason ?? 'Subject is not eligible for submission');
    }

    const conflicting = await this.workflowInstanceRepository.findActiveForSubject(
      organisationId,
      input.subjectType,
      input.subjectId,
    );
    if (conflicting) {
      throw new ConflictException(
        'This record already has an active workflow instance in progress',
      );
    }

    return this.workflowInstanceRepository.createWithSteps(
      {
        organisationId,
        workflowDefinitionId: definition.id,
        workflowDefinitionVersion: definition.version,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        requestedById,
        status: 'DRAFT',
      },
      definition.steps.map((step) => ({
        definitionStepId: step.id,
        stepNameSnapshot: step.name,
        sequence: step.sequence,
        requiredPermissionSnapshot: step.requiredPermission,
        requiredScopeSnapshot: step.requiredScope,
        assignedUserIdSnapshot: step.assignedUserId,
        status: 'PENDING',
      })),
    );
  }

  /** `POST /workflows/instances/:id/submit` — `DRAFT` → `SUBMITTED` → `IN_PROGRESS`
   *  (step 1 activated), and calls the subject handler's `onWorkflowSubmitted`. Only
   *  the original requester may submit their own draft (workflow.md §4 "`DRAFT` may be
   *  edited or cancelled by the requester"). */
  async submit(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<WorkflowInstanceWithSteps> {
    const instance = await this.getByIdOrThrow(organisationId, id);
    if (instance.requestedById !== actorUserId) {
      throw new BadRequestException('Only the requester may submit this workflow instance');
    }

    const submitted = await this.workflowInstanceRepository.submit(organisationId, id);
    if (!submitted) {
      throw new ConflictException('Workflow instance has already been submitted');
    }

    const firstStep = instance.stepInstances[0];
    if (firstStep) {
      await this.workflowInstanceRepository.activateStep(id, firstStep.id);
    }

    const handler = this.getHandler(instance.subjectType);
    await handler.onWorkflowSubmitted(organisationId, instance.subjectId, actorUserId);

    return this.getByIdOrThrow(organisationId, id);
  }

  /** `POST /workflows/instances/:id/approve` — workflow.md §5, §6, §13. Re-validates
   *  eligibility against the CURRENT step's snapshot every time (never a cached
   *  decision), then attempts the concurrency-safe transition. On the last step,
   *  advances the instance to `APPROVED` and calls the subject handler's
   *  `onWorkflowApproved`; otherwise activates the next `PENDING` step. */
  async approve(
    organisationId: string,
    id: string,
    actorUserId: string,
    comment?: string,
  ): Promise<WorkflowInstanceWithSteps> {
    const { instance, activeStep, definition } = await this.getActiveStepOrThrow(
      organisationId,
      id,
    );
    await this.assertEligible(organisationId, instance, activeStep, definition, actorUserId);

    const transitioned = await this.workflowInstanceRepository.decideStep(
      activeStep.id,
      id,
      'APPROVED',
      { actorUserId, decision: WorkflowDecisionType.APPROVE, comment },
    );
    if (!transitioned) {
      throw new ConflictException('This step has already been decided by someone else');
    }

    const nextStep = instance.stepInstances.find((s) => s.sequence === activeStep.sequence + 1);
    if (nextStep) {
      await this.workflowInstanceRepository.activateStep(id, nextStep.id);
    } else {
      await this.workflowInstanceRepository.setInstanceStatus(organisationId, id, 'APPROVED');
      const handler = this.getHandler(instance.subjectType);
      await handler.onWorkflowApproved(organisationId, instance.subjectId, actorUserId);
    }

    return this.getByIdOrThrow(organisationId, id);
  }

  async reject(
    organisationId: string,
    id: string,
    actorUserId: string,
    comment?: string,
  ): Promise<WorkflowInstanceWithSteps> {
    return this.exitWorkflow(
      organisationId,
      id,
      actorUserId,
      'REJECTED',
      WorkflowDecisionType.REJECT,
      comment,
    );
  }

  /** workflow.md §4 "restart/resume rule": for MVP, `RETURNED` is terminal for THIS
   *  `WorkflowInstance` — no step is rewound back to `PENDING`/re-activated. The
   *  subject reverts to an editable state (via the handler's `onWorkflowExited`, same
   *  as reject/cancel) and, if corrected, resubmission means creating a brand NEW
   *  `WorkflowInstance` against the same definition. A true "resume the same instance
   *  from step 1" pattern is a documented, deferred capability (workflow.md §16) —
   *  rewinding steps mid-flight is exactly the kind of advanced branching this
   *  sprint's brief says to avoid. */
  async return_(
    organisationId: string,
    id: string,
    actorUserId: string,
    comment?: string,
  ): Promise<WorkflowInstanceWithSteps> {
    return this.exitWorkflow(
      organisationId,
      id,
      actorUserId,
      'RETURNED',
      WorkflowDecisionType.RETURN,
      comment,
    );
  }

  /** `POST /workflows/instances/:id/cancel` — unlike approve/reject/return, cancelling
   *  does not require eligibility on the CURRENT step (it isn't a step decision at
   *  all); the controller's `workflow.instance.cancel` permission gate is the entire
   *  authorization check. Reachable from any non-terminal status, including `DRAFT`
   *  (workflow.md §4). */
  async cancel(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<WorkflowInstanceWithSteps> {
    const instance = await this.getByIdOrThrow(organisationId, id);

    const changed = await this.workflowInstanceRepository.setInstanceStatus(
      organisationId,
      id,
      'CANCELLED',
      { cancelledAt: new Date() },
    );
    if (!changed) {
      throw new ConflictException('Workflow instance is already in a terminal state');
    }

    if (instance.status !== 'DRAFT') {
      const handler = this.getHandler(instance.subjectType);
      await handler.onWorkflowExited(organisationId, instance.subjectId, actorUserId);
    }

    return this.getByIdOrThrow(organisationId, id);
  }

  /** `workflow.md §4 "COMPLETED means the workflow outcome has been consumed"` — not
   *  called automatically; a subject handler (or, for future integrations, the owning
   *  domain's own controller) calls this once it has actually acted on the `APPROVED`
   *  outcome. No PO integration calls this yet in Sprint 26 — `onWorkflowApproved`
   *  already performs the PO's entire side effect (`PENDING` → `APPROVED`), so there is
   *  no further "consumption" step to mark complete; exposed for future integrations
   *  whose approved outcome is consumed asynchronously. */
  async markCompleted(organisationId: string, id: string): Promise<WorkflowInstanceWithSteps> {
    const changed = await this.workflowInstanceRepository.markCompleted(organisationId, id);
    if (!changed) {
      throw new ConflictException('Workflow instance is not in an APPROVED state');
    }
    return this.getByIdOrThrow(organisationId, id);
  }

  /** `GET /workflows/my-approvals` — workflow.md §9 "the backend must filter the
   *  results," never merely hide buttons client-side. Re-checks eligibility for every
   *  currently-`ACTIVE` step in the organisation; only genuinely eligible ones are
   *  returned. */
  async listMyApprovals(organisationId: string, userId: string) {
    const activeSteps =
      await this.workflowInstanceRepository.findActiveStepsByOrganisation(organisationId);
    const results: typeof activeSteps = [];
    for (const step of activeSteps) {
      const definition = await this.workflowDefinitionService.getById(
        organisationId,
        step.workflowInstance.workflowDefinitionId,
      );
      const result = await this.workflowEligibilityService.checkStepEligibility({
        organisationId,
        requiredPermission: step.requiredPermissionSnapshot,
        requiredScope: step.requiredScopeSnapshot,
        assignedUserId: step.assignedUserIdSnapshot,
        requestedById: step.workflowInstance.requestedById,
        allowSelfApproval: definition?.allowSelfApproval ?? false,
        candidateUserId: userId,
      });
      if (result.eligible) {
        results.push(step);
      }
    }
    return results;
  }

  async listEligibleApprovers(organisationId: string, workflowInstanceId: string) {
    const { activeStep, instance, definition } = await this.getActiveStepOrThrow(
      organisationId,
      workflowInstanceId,
    );
    return this.workflowEligibilityService.listEligibleApprovers({
      organisationId,
      requiredPermission: activeStep.requiredPermissionSnapshot,
      requiredScope: activeStep.requiredScopeSnapshot,
      assignedUserId: activeStep.assignedUserIdSnapshot,
      requestedById: instance.requestedById,
      allowSelfApproval: definition?.allowSelfApproval ?? false,
    });
  }

  private async getActiveStepOrThrow(organisationId: string, id: string) {
    const instance = await this.getByIdOrThrow(organisationId, id);
    const activeStep = instance.stepInstances.find((s) => s.status === 'ACTIVE');
    if (!activeStep) {
      throw new BadRequestException('This workflow instance has no active step to act on');
    }
    const definition = await this.workflowDefinitionService.getById(
      organisationId,
      instance.workflowDefinitionId,
    );
    return { instance, activeStep, definition };
  }

  private async assertEligible(
    organisationId: string,
    instance: WorkflowInstanceWithSteps,
    activeStep: WorkflowInstanceWithSteps['stepInstances'][number],
    definition: Awaited<ReturnType<WorkflowDefinitionService['getById']>>,
    actorUserId: string,
  ): Promise<void> {
    const result = await this.workflowEligibilityService.checkStepEligibility({
      organisationId,
      requiredPermission: activeStep.requiredPermissionSnapshot,
      requiredScope: activeStep.requiredScopeSnapshot,
      assignedUserId: activeStep.assignedUserIdSnapshot,
      requestedById: instance.requestedById,
      allowSelfApproval: definition?.allowSelfApproval ?? false,
      candidateUserId: actorUserId,
    });
    if (!result.eligible) {
      throw new BadRequestException(result.reason ?? 'You are not eligible to act on this step');
    }
  }

  private async exitWorkflow(
    organisationId: string,
    id: string,
    actorUserId: string,
    instanceStatus: 'REJECTED' | 'RETURNED',
    decisionType: WorkflowDecisionType,
    comment?: string,
  ): Promise<WorkflowInstanceWithSteps> {
    const { instance, activeStep, definition } = await this.getActiveStepOrThrow(
      organisationId,
      id,
    );
    await this.assertEligible(organisationId, instance, activeStep, definition, actorUserId);

    const stepStatus = instanceStatus === 'REJECTED' ? 'REJECTED' : 'RETURNED';
    const transitioned = await this.workflowInstanceRepository.decideStep(
      activeStep.id,
      id,
      stepStatus,
      { actorUserId, decision: decisionType, comment },
    );
    if (!transitioned) {
      throw new ConflictException('This step has already been decided by someone else');
    }

    await this.workflowInstanceRepository.setInstanceStatus(organisationId, id, instanceStatus);

    const handler = this.getHandler(instance.subjectType);
    await handler.onWorkflowExited(organisationId, instance.subjectId, actorUserId);

    return this.getByIdOrThrow(organisationId, id);
  }
}
