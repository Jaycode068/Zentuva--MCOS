import { randomUUID } from 'crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { WorkflowDecisionType } from '@prisma/client';

import { WorkflowDefinitionService } from './workflow-definition.service';
import { WorkflowEligibilityService } from './workflow-eligibility.service';
import { RecordWorkflowEventInput, WorkflowEventRepository } from './workflow-event.repository';
import { buildWorkflowEventIdempotencyKey, WORKFLOW_EVENT_TYPES } from './workflow-events';
import {
  ConflictingActiveInstanceError,
  ListWorkflowInstancesParams,
  WorkflowInstanceRepository,
  WorkflowInstanceWithSteps,
} from './workflow-instance.repository';
import { WORKFLOW_SUBJECT_HANDLERS, WorkflowSubjectHandler } from './workflow-subject-handler';

export interface CreateWorkflowInstanceInput {
  workflowDefinitionCode: string;
  subjectType: string;
  subjectId: string;
  dueAt?: Date;
}

/** Every read path returns this, not the raw Prisma row — `isOverdue` is ALWAYS
 *  computed at read time from `dueAt`, never persisted (workflow.md §9 "OVERDUE is
 *  not a status" — it can never drift out of sync with the real state because it is
 *  recomputed on every read). */
export interface WorkflowInstanceView extends WorkflowInstanceWithSteps {
  isOverdue: boolean;
}

const OVERDUE_ELIGIBLE_STATUSES = new Set(['DRAFT', 'SUBMITTED', 'IN_PROGRESS']);

/**
 * Domain service for `WorkflowInstance` + `WorkflowStepInstance` + `WorkflowDecision` —
 * the sequential approval engine itself (Sprint 26, docs/domains/workflow.md §5, §8,
 * §13; hardened Sprint 26.1 — return/resubmission, event durability, expiry,
 * domain-integration atomicity). Orchestrates: subject validation (via the injected
 * `WorkflowSubjectHandler` array), eligibility (via `WorkflowEligibilityService`),
 * concurrency-safe state transitions (via `WorkflowInstanceRepository`'s conditional
 * `updateMany`s), the domain callback that lets the owning subject's own status
 * actually move, and — since Sprint 26.1 — the durable `WorkflowEvent` record each
 * successful transition produces.
 */
@Injectable()
export class WorkflowInstanceService {
  private readonly handlersByType: Map<string, WorkflowSubjectHandler>;

  constructor(
    private readonly workflowInstanceRepository: WorkflowInstanceRepository,
    private readonly workflowDefinitionService: WorkflowDefinitionService,
    private readonly workflowEligibilityService: WorkflowEligibilityService,
    @Inject(WORKFLOW_SUBJECT_HANDLERS) handlers: WorkflowSubjectHandler[],
    @Optional() private readonly workflowEventRepository?: WorkflowEventRepository,
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

  private toView(instance: WorkflowInstanceWithSteps): WorkflowInstanceView {
    const isOverdue =
      instance.dueAt != null &&
      instance.dueAt.getTime() < Date.now() &&
      OVERDUE_ELIGIBLE_STATUSES.has(instance.status);
    return { ...instance, isOverdue };
  }

  /** Builds a fully-formed `WorkflowEvent` insert — the service's job per
   *  `WorkflowInstanceRepository`'s doc comment ("building the event payload is the
   *  service's job; the repository only persists what it's given"). */
  private buildEvent(params: {
    instance: Pick<
      WorkflowInstanceWithSteps,
      | 'organisationId'
      | 'id'
      | 'workflowDefinitionId'
      | 'workflowDefinitionVersion'
      | 'subjectType'
      | 'subjectId'
    >;
    correlationId: string;
    eventType: (typeof WORKFLOW_EVENT_TYPES)[keyof typeof WORKFLOW_EVENT_TYPES];
    idempotencySubjectId: string;
    stepInstanceId?: string;
    actorUserId?: string;
    targetUserId?: string;
    summary?: Record<string, unknown>;
  }): RecordWorkflowEventInput {
    return {
      organisationId: params.instance.organisationId,
      workflowInstanceId: params.instance.id,
      workflowDefinitionId: params.instance.workflowDefinitionId,
      workflowDefinitionVersion: params.instance.workflowDefinitionVersion,
      subjectType: params.instance.subjectType,
      subjectId: params.instance.subjectId,
      eventType: params.eventType,
      actorUserId: params.actorUserId,
      targetUserId: params.targetUserId,
      workflowStepInstanceId: params.stepInstanceId,
      correlationId: params.correlationId,
      idempotencyKey: buildWorkflowEventIdempotencyKey(
        params.eventType,
        params.idempotencySubjectId,
      ),
      summary: params.summary,
    };
  }

  async getById(organisationId: string, id: string): Promise<WorkflowInstanceView | null> {
    const instance = await this.workflowInstanceRepository.findById(organisationId, id);
    return instance ? this.toView(instance) : null;
  }

  async getByIdOrThrow(organisationId: string, id: string): Promise<WorkflowInstanceView> {
    const instance = await this.workflowInstanceRepository.findById(organisationId, id);
    if (!instance) {
      throw new NotFoundException('Workflow instance not found');
    }
    return this.toView(instance);
  }

  async list(
    organisationId: string,
    params?: ListWorkflowInstancesParams,
  ): Promise<WorkflowInstanceView[]> {
    const items = await this.workflowInstanceRepository.findManyByOrganisation(
      organisationId,
      params,
    );
    return items.map((item) => this.toView(item));
  }

  getDecisionHistory(workflowInstanceId: string) {
    return this.workflowInstanceRepository.findDecisionsByInstance(workflowInstanceId);
  }

  /** `GET /workflows/instances/:id/events` — Sprint 26.1 §7. Read access to the
   *  durable event log; tenant isolation is the caller's job (the controller confirms
   *  the instance belongs to this organisation via `getByIdOrThrow` first, same
   *  pattern as `getDecisionHistory`). */
  getEvents(workflowInstanceId: string) {
    return this.workflowEventRepository?.findManyByInstance(workflowInstanceId) ?? [];
  }

  /** `POST /workflows/instances` — workflow.md §7: validates the definition is
   *  `ACTIVE`, the subject type matches, the subject itself is eligible (via its
   *  handler), and no other non-terminal instance already targets this exact subject.
   *  Creates the `WorkflowInstance` in `DRAFT` with every step pre-snapshotted
   *  `PENDING` — nothing about the subject changes yet (that's `submit`'s job).
   *
   *  Sprint 26.1: the "no conflicting active instance" check below is a fast,
   *  non-authoritative pre-flight (see `findActiveForSubject`'s doc comment) — the
   *  real guarantee under concurrency is the database's own partial unique index,
   *  which `createWithSteps` translates into a 409 here if it fires. */
  async create(
    organisationId: string,
    input: CreateWorkflowInstanceInput,
    requestedById: string,
  ): Promise<WorkflowInstanceView> {
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

    try {
      const created = await this.workflowInstanceRepository.createWithSteps(
        {
          organisationId,
          workflowDefinitionId: definition.id,
          workflowDefinitionVersion: definition.version,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          requestedById,
          status: 'DRAFT',
          dueAt: input.dueAt,
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
      return this.toView(created);
    } catch (error) {
      if (error instanceof ConflictingActiveInstanceError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  /** `POST /workflows/instances/:id/submit` — `DRAFT` → `SUBMITTED` → `IN_PROGRESS`
   *  (step 1 activated). Only the original requester may submit their own draft
   *  (workflow.md §4 "`DRAFT` may be edited or cancelled by the requester").
   *
   *  Sprint 26.1 atomicity fix: the subject handler's `onWorkflowSubmitted` is called
   *  BEFORE any workflow-side state changes (Sprint 26 called it last). If the domain
   *  callback throws, the instance is untouched — still cleanly `DRAFT` — rather than
   *  Sprint 26's ordering, where a domain-integration failure could leave the
   *  workflow already `IN_PROGRESS` with an active step while the underlying subject
   *  never actually left `DRAFT`. */
  async submit(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<WorkflowInstanceView> {
    const correlationId = randomUUID();
    const instance = await this.getByIdOrThrow(organisationId, id);
    if (instance.requestedById !== actorUserId) {
      throw new BadRequestException('Only the requester may submit this workflow instance');
    }
    if (instance.status !== 'DRAFT') {
      throw new ConflictException('Workflow instance has already been submitted');
    }

    const handler = this.getHandler(instance.subjectType);
    await handler.onWorkflowSubmitted(organisationId, instance.subjectId, actorUserId);

    const submitted = await this.workflowInstanceRepository.submit(
      organisationId,
      id,
      this.buildEvent({
        instance,
        correlationId,
        eventType: WORKFLOW_EVENT_TYPES.SUBMITTED,
        idempotencySubjectId: instance.id,
        actorUserId,
      }),
    );
    if (!submitted) {
      throw new ConflictException('Workflow instance has already been submitted');
    }

    const firstStep = instance.stepInstances[0];
    if (firstStep) {
      await this.workflowInstanceRepository.activateStep(
        id,
        firstStep.id,
        this.buildEvent({
          instance,
          correlationId,
          eventType: WORKFLOW_EVENT_TYPES.APPROVAL_REQUIRED,
          idempotencySubjectId: firstStep.id,
          stepInstanceId: firstStep.id,
          summary: { stepSequence: firstStep.sequence, stepName: firstStep.stepNameSnapshot },
        }),
      );
    }

    return this.getByIdOrThrow(organisationId, id);
  }

  /** `POST /workflows/instances/:id/approve` — workflow.md §5, §6, §12. Re-validates
   *  eligibility against the CURRENT step's snapshot every time (never a cached
   *  decision), then attempts the concurrency-safe transition. On the last step,
   *  finalizes via `finalizeApproval` (see that method's doc comment for the
   *  Sprint 26.1 atomicity fix); otherwise activates the next `PENDING` step.
   *
   *  Sprint 26.1 recovery path: if there is no `ACTIVE` step but every step is
   *  already `APPROVED` and the instance is still `IN_PROGRESS`, a PRIOR call's
   *  `finalizeApproval` domain callback must have failed after `decideStep` already
   *  committed. Retrying re-runs only the domain callback + finalization — never a
   *  second `WorkflowDecision` — satisfying the brief's "repeated integration
   *  attempts are safe where retries are supported." */
  async approve(
    organisationId: string,
    id: string,
    actorUserId: string,
    comment?: string,
  ): Promise<WorkflowInstanceView> {
    const correlationId = randomUUID();
    const instance = await this.getByIdOrThrow(organisationId, id);
    const activeStep = instance.stepInstances.find((s) => s.status === 'ACTIVE');

    if (!activeStep) {
      const allStepsApproved =
        instance.stepInstances.length > 0 &&
        instance.stepInstances.every((s) => s.status === 'APPROVED');
      if (instance.status === 'IN_PROGRESS' && allStepsApproved) {
        const lastStep = instance.stepInstances[instance.stepInstances.length - 1];
        const decisions = await this.workflowInstanceRepository.findDecisionsByInstance(
          instance.id,
        );
        const finalDecision = decisions.find(
          (d) => d.workflowStepInstanceId === lastStep?.id && d.decision === 'APPROVE',
        );
        return this.finalizeApproval(
          organisationId,
          instance,
          finalDecision?.actorUserId ?? actorUserId,
          correlationId,
        );
      }
      throw new BadRequestException('This workflow instance has no active step to act on');
    }

    const definition = await this.workflowDefinitionService.getById(
      organisationId,
      instance.workflowDefinitionId,
    );
    await this.assertEligible(organisationId, instance, activeStep, definition, actorUserId);

    const transitioned = await this.workflowInstanceRepository.decideStep(
      activeStep.id,
      id,
      'APPROVED',
      { actorUserId, decision: WorkflowDecisionType.APPROVE, comment },
      this.buildEvent({
        instance,
        correlationId,
        eventType: WORKFLOW_EVENT_TYPES.STEP_APPROVED,
        idempotencySubjectId: activeStep.id,
        stepInstanceId: activeStep.id,
        actorUserId,
        summary: { stepSequence: activeStep.sequence, comment: comment ?? null },
      }),
    );
    if (!transitioned) {
      throw new ConflictException('This step has already been decided by someone else');
    }

    const nextStep = instance.stepInstances.find((s) => s.sequence === activeStep.sequence + 1);
    if (nextStep) {
      await this.workflowInstanceRepository.activateStep(
        id,
        nextStep.id,
        this.buildEvent({
          instance,
          correlationId,
          eventType: WORKFLOW_EVENT_TYPES.APPROVAL_REQUIRED,
          idempotencySubjectId: nextStep.id,
          stepInstanceId: nextStep.id,
          summary: { stepSequence: nextStep.sequence, stepName: nextStep.stepNameSnapshot },
        }),
      );
      return this.getByIdOrThrow(organisationId, id);
    }

    return this.finalizeApproval(organisationId, instance, actorUserId, correlationId);
  }

  /** Sprint 26.1 atomicity fix (brief: "a workflow cannot be marked successfully
   *  completed if the required domain transition failed"). Sprint 26 called
   *  `setInstanceStatus(APPROVED)` BEFORE the domain handler — a domain-integration
   *  failure left the instance falsely claiming `APPROVED` while the subject was
   *  never actually updated. This calls the handler FIRST: if it throws, the instance
   *  stays `IN_PROGRESS` (truthful — "still not finished"), and `approve()`'s
   *  recovery path (above) lets a later call retry cleanly. `setInstanceStatus`'s own
   *  conditional `WHERE status IN (non-terminal)` makes a retry-after-success a safe
   *  no-op, and `PurchaseOrderWorkflowHandler.onWorkflowApproved` is a plain
   *  idempotent `UPDATE`, safe to run twice. */
  private async finalizeApproval(
    organisationId: string,
    instance: WorkflowInstanceWithSteps,
    finalApproverId: string,
    correlationId: string,
  ): Promise<WorkflowInstanceView> {
    const handler = this.getHandler(instance.subjectType);
    await handler.onWorkflowApproved(organisationId, instance.subjectId, finalApproverId);
    await this.workflowInstanceRepository.setInstanceStatus(
      organisationId,
      instance.id,
      'APPROVED',
      {},
      this.buildEvent({
        instance,
        correlationId,
        eventType: WORKFLOW_EVENT_TYPES.APPROVED,
        idempotencySubjectId: instance.id,
        actorUserId: finalApproverId,
      }),
    );
    return this.getByIdOrThrow(organisationId, instance.id);
  }

  async reject(
    organisationId: string,
    id: string,
    actorUserId: string,
    comment?: string,
  ): Promise<WorkflowInstanceView> {
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
   *  as reject/cancel) and correction is resumed via the dedicated `resubmit()`
   *  below — see its doc comment for the "new linked instance, not a rewound one"
   *  design decision. */
  async return_(
    organisationId: string,
    id: string,
    actorUserId: string,
    comment?: string,
  ): Promise<WorkflowInstanceView> {
    return this.exitWorkflow(
      organisationId,
      id,
      actorUserId,
      'RETURNED',
      WorkflowDecisionType.RETURN,
      comment,
    );
  }

  /** `POST /workflows/instances/:id/resubmit` — Sprint 26.1 §3 "Return &
   *  Resubmission design". Chosen model: create a NEW `WorkflowInstance` linked to
   *  the `RETURNED` predecessor via `previousInstanceId`/`resubmissionCount`, rather
   *  than reusing/rewinding the same instance. Rationale (workflow.md §3 has the full
   *  writeup): `WorkflowStepInstance` rows are immutable point-in-time snapshots with
   *  a `@@unique([workflowInstanceId, sequence])` constraint — resetting them to
   *  `PENDING` in place for a second cycle would either violate that constraint (if
   *  new rows are added) or destroy the first cycle's own decision history (if the
   *  same rows are reused), directly conflicting with "previous decisions must remain
   *  immutable and visible." A new linked instance preserves 100% of the old one's
   *  history untouched and restarts the approval chain from the CURRENT active
   *  definition version (matching how a first-time submission already always uses
   *  whatever is currently active) — the simpler of the two options the brief itself
   *  offered as an acceptable fallback.
   *
   *  Concurrency: `claimForResubmission` is the atomic single-winner claim (only the
   *  first call against a given `RETURNED`, not-yet-resubmitted instance succeeds);
   *  the database's partial unique index additionally prevents this from ever
   *  producing two active instances for the same subject even if some other path
   *  raced it independently. */
  async resubmit(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<WorkflowInstanceView> {
    const correlationId = randomUUID();
    const previous = await this.getByIdOrThrow(organisationId, id);

    if (previous.requestedById !== actorUserId) {
      throw new BadRequestException('Only the original requester may resubmit this workflow');
    }
    if (previous.status !== 'RETURNED') {
      throw new BadRequestException('Only a RETURNED workflow instance can be resubmitted');
    }

    const claimed = await this.workflowInstanceRepository.claimForResubmission(organisationId, id);
    if (!claimed) {
      throw new ConflictException('This workflow instance has already been resubmitted');
    }

    const originalDefinition = await this.workflowDefinitionService.getByIdOrThrow(
      organisationId,
      previous.workflowDefinitionId,
    );
    const activeDefinition = await this.workflowDefinitionService.getByCode(
      organisationId,
      originalDefinition.code,
    );
    if (!activeDefinition || activeDefinition.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Workflow definition "${originalDefinition.code}" is no longer active — cannot resubmit`,
      );
    }

    const handler = this.getHandler(previous.subjectType);
    const validation = await handler.validateForSubmission(organisationId, previous.subjectId);
    if (!validation.ok) {
      throw new BadRequestException(
        validation.reason ?? 'Subject is not eligible for resubmission',
      );
    }

    // Domain callback BEFORE the new WorkflowInstance row exists — same "fail clean"
    // reasoning as submit()'s atomicity fix above. If this throws, the resubmission
    // claim stays consumed with no new instance created; documented as a narrow,
    // honest known limitation in workflow.md §16 (matching the same class of gap
    // already accepted for exitWorkflow's domain callback).
    await handler.onWorkflowSubmitted(organisationId, previous.subjectId, actorUserId);

    const newInstanceId = randomUUID();
    let created: WorkflowInstanceWithSteps;
    try {
      created = await this.workflowInstanceRepository.createWithSteps(
        {
          id: newInstanceId,
          organisationId,
          workflowDefinitionId: activeDefinition.id,
          workflowDefinitionVersion: activeDefinition.version,
          subjectType: previous.subjectType,
          subjectId: previous.subjectId,
          requestedById: previous.requestedById,
          status: 'SUBMITTED',
          submittedAt: new Date(),
          previousInstanceId: previous.id,
          resubmissionCount: previous.resubmissionCount + 1,
        },
        activeDefinition.steps.map((step) => ({
          definitionStepId: step.id,
          stepNameSnapshot: step.name,
          sequence: step.sequence,
          requiredPermissionSnapshot: step.requiredPermission,
          requiredScopeSnapshot: step.requiredScope,
          assignedUserIdSnapshot: step.assignedUserId,
          status: 'PENDING',
        })),
        {
          organisationId,
          workflowInstanceId: newInstanceId,
          workflowDefinitionId: activeDefinition.id,
          workflowDefinitionVersion: activeDefinition.version,
          subjectType: previous.subjectType,
          subjectId: previous.subjectId,
          eventType: WORKFLOW_EVENT_TYPES.RESUBMITTED,
          actorUserId,
          correlationId,
          idempotencyKey: buildWorkflowEventIdempotencyKey(
            WORKFLOW_EVENT_TYPES.RESUBMITTED,
            newInstanceId,
          ),
          summary: {
            previousInstanceId: previous.id,
            resubmissionCount: previous.resubmissionCount + 1,
          },
        },
      );
    } catch (error) {
      if (error instanceof ConflictingActiveInstanceError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }

    const firstStep = created.stepInstances[0];
    if (firstStep) {
      await this.workflowInstanceRepository.activateStep(
        created.id,
        firstStep.id,
        this.buildEvent({
          instance: created,
          correlationId,
          eventType: WORKFLOW_EVENT_TYPES.APPROVAL_REQUIRED,
          idempotencySubjectId: firstStep.id,
          stepInstanceId: firstStep.id,
          summary: { stepSequence: firstStep.sequence, stepName: firstStep.stepNameSnapshot },
        }),
      );
    }

    return this.getByIdOrThrow(organisationId, created.id);
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
  ): Promise<WorkflowInstanceView> {
    const correlationId = randomUUID();
    const instance = await this.getByIdOrThrow(organisationId, id);

    const changed = await this.workflowInstanceRepository.setInstanceStatus(
      organisationId,
      id,
      'CANCELLED',
      { cancelledAt: new Date() },
      this.buildEvent({
        instance,
        correlationId,
        eventType: WORKFLOW_EVENT_TYPES.CANCELLED,
        idempotencySubjectId: instance.id,
        actorUserId,
      }),
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

  /** `POST /workflows/instances/:id/expire` — Sprint 26.1 §9. An explicit, deliberate
   *  transition (never inferred): only succeeds if the instance is still non-terminal
   *  AND `dueAt` has actually passed (`WorkflowInstanceRepository.expire`'s own
   *  conditional `WHERE`). No scheduled job calls this in this sprint — deliberately
   *  out of scope (Sprint 26.1 brief: "do not build escalation rules") — this exists
   *  so the transition itself is real, tested, and ready for a future job to call. */
  async expire(
    organisationId: string,
    id: string,
    actorUserId: string,
  ): Promise<WorkflowInstanceView> {
    const correlationId = randomUUID();
    const instance = await this.getByIdOrThrow(organisationId, id);

    const expired = await this.workflowInstanceRepository.expire(
      organisationId,
      id,
      this.buildEvent({
        instance,
        correlationId,
        eventType: WORKFLOW_EVENT_TYPES.EXPIRED,
        idempotencySubjectId: instance.id,
        actorUserId,
      }),
    );
    if (!expired) {
      throw new ConflictException(
        'Workflow instance cannot be expired (already terminal, or its due date has not passed)',
      );
    }
    return this.getByIdOrThrow(organisationId, id);
  }

  /** `workflow.md §4 "COMPLETED means the workflow outcome has been consumed"` — not
   *  called automatically; a subject handler (or, for future integrations, the owning
   *  domain's own controller) calls this once it has actually acted on the `APPROVED`
   *  outcome. No PO integration calls this yet — `onWorkflowApproved` already
   *  performs the PO's entire side effect, so there is no further "consumption" step
   *  to mark complete; exposed for future integrations whose approved outcome is
   *  consumed asynchronously. */
  async markCompleted(organisationId: string, id: string): Promise<WorkflowInstanceView> {
    const correlationId = randomUUID();
    const instance = await this.getByIdOrThrow(organisationId, id);
    const changed = await this.workflowInstanceRepository.markCompleted(
      organisationId,
      id,
      this.buildEvent({
        instance,
        correlationId,
        eventType: WORKFLOW_EVENT_TYPES.COMPLETED,
        idempotencySubjectId: instance.id,
      }),
    );
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

  /** Reject/return share this: the concurrency-safe step decision, then the
   *  instance-level terminal status, then the domain callback. Sprint 26.1 §2
   *  "Return comment rules": a comment is mandatory for both — checked here,
   *  server-authoritatively, in addition to (never instead of) the Zod schema at the
   *  controller boundary.
   *
   *  Known limitation (workflow.md §16, unchanged from Sprint 26): if
   *  `handler.onWorkflowExited` throws AFTER `decideStep`/`setInstanceStatus` already
   *  committed, the workflow instance is correctly terminal (the human decision was
   *  real and is preserved) but the domain record may not have reverted to an
   *  editable state. Unlike `approve()`'s `finalizeApproval`, there is no retry entry
   *  point for this today — a genuinely rare failure mode (the callback is a single
   *  conditional `UPDATE`) documented honestly rather than solved with additional
   *  machinery this sprint. */
  private async exitWorkflow(
    organisationId: string,
    id: string,
    actorUserId: string,
    instanceStatus: 'REJECTED' | 'RETURNED',
    decisionType: WorkflowDecisionType,
    comment?: string,
  ): Promise<WorkflowInstanceView> {
    if (!comment || !comment.trim()) {
      throw new BadRequestException(
        `A comment is required to ${instanceStatus === 'REJECTED' ? 'reject' : 'return'} a workflow instance`,
      );
    }

    const correlationId = randomUUID();
    const { instance, activeStep, definition } = await this.getActiveStepOrThrow(
      organisationId,
      id,
    );
    await this.assertEligible(organisationId, instance, activeStep, definition, actorUserId);

    const stepStatus = instanceStatus === 'REJECTED' ? 'REJECTED' : 'RETURNED';
    const eventType =
      instanceStatus === 'REJECTED' ? WORKFLOW_EVENT_TYPES.REJECTED : WORKFLOW_EVENT_TYPES.RETURNED;
    const transitioned = await this.workflowInstanceRepository.decideStep(
      activeStep.id,
      id,
      stepStatus,
      { actorUserId, decision: decisionType, comment },
      this.buildEvent({
        instance,
        correlationId,
        eventType,
        idempotencySubjectId: activeStep.id,
        stepInstanceId: activeStep.id,
        actorUserId,
        summary: { stepSequence: activeStep.sequence, comment },
      }),
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
