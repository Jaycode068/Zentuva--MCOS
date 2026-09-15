import { Injectable } from '@nestjs/common';
import {
  Prisma,
  WorkflowDecisionType,
  WorkflowInstance,
  WorkflowInstanceStatus,
  WorkflowStepInstance,
  WorkflowStepInstanceStatus,
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export type WorkflowInstanceWithSteps = WorkflowInstance & {
  stepInstances: WorkflowStepInstance[];
};

export interface ListWorkflowInstancesParams {
  status?: WorkflowInstanceStatus;
  subjectType?: string;
  requestedById?: string;
}

const STEPS_ORDER = { stepInstances: { orderBy: { sequence: 'asc' as const } } };

const NON_TERMINAL_STATUSES: WorkflowInstanceStatus[] = ['DRAFT', 'SUBMITTED', 'IN_PROGRESS'];

/**
 * Thin Prisma access for `WorkflowInstance` + `WorkflowStepInstance` + `WorkflowDecision`
 * — no business logic, see `WorkflowInstanceService` and docs/domains/workflow.md.
 *
 * Concurrency-safety convention (workflow.md §13, matches
 * `PurchaseOrderRepository.update`'s own established idiom): every status transition
 * uses a conditional `updateMany` whose `WHERE` clause includes the expected current
 * status — `count === 0` means "someone else already moved it," the caller treats that
 * as a conflict, never a silent no-op. This is this codebase's existing concurrency
 * primitive throughout (also `AttendanceRepository.findOrCreateForDate`'s P2002 catch),
 * not a new pattern invented for Workflow.
 */
@Injectable()
export class WorkflowInstanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<WorkflowInstanceWithSteps | null> {
    return this.prisma.workflowInstance.findFirst({
      where: { id, organisationId },
      include: STEPS_ORDER,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListWorkflowInstancesParams = {},
  ): Promise<WorkflowInstanceWithSteps[]> {
    return this.prisma.workflowInstance.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.subjectType ? { subjectType: params.subjectType } : {}),
        ...(params.requestedById ? { requestedById: params.requestedById } : {}),
      },
      include: STEPS_ORDER,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** workflow.md §13 "a business subject cannot receive conflicting active workflows
   *  unless explicitly allowed" — MVP default: at most one non-terminal instance per
   *  `(organisationId, subjectType, subjectId)`, regardless of which `WorkflowDefinition`
   *  it's for. Enforced here at the service-call boundary (checked immediately before
   *  `createWithSteps`, both inside the same short-lived request) rather than a DB
   *  constraint — Prisma has no declarative partial-unique-index support for "unique
   *  only among non-terminal rows," and a full always-on unique constraint would wrongly
   *  block a legitimate *second* approval of the same subject after the first one
   *  completed. */
  findActiveForSubject(
    organisationId: string,
    subjectType: string,
    subjectId: string,
  ): Promise<WorkflowInstance | null> {
    return this.prisma.workflowInstance.findFirst({
      where: {
        organisationId,
        subjectType,
        subjectId,
        status: { in: NON_TERMINAL_STATUSES },
      },
    });
  }

  /** Creates the `WorkflowInstance` (`DRAFT`) with every step pre-snapshotted as
   *  `PENDING` `WorkflowStepInstance` rows — workflow.md §3.5: snapshotting happens at
   *  instance CREATION, not at submission, so a `WorkflowDefinition` edit between
   *  creation and submission can never rewrite an already-created draft either. */
  createWithSteps(
    instanceData: Prisma.WorkflowInstanceUncheckedCreateInput,
    stepInstances: Prisma.WorkflowStepInstanceCreateManyWorkflowInstanceInput[],
  ): Promise<WorkflowInstanceWithSteps> {
    return this.prisma.workflowInstance.create({
      data: { ...instanceData, stepInstances: { createMany: { data: stepInstances } } },
      include: STEPS_ORDER,
    });
  }

  /** `DRAFT` → `SUBMITTED` (then the caller separately activates step 1). Conditional
   *  on the current status still being `DRAFT` — workflow.md §13 "a workflow cannot be
   *  submitted twice." */
  async submit(organisationId: string, id: string): Promise<boolean> {
    const result = await this.prisma.workflowInstance.updateMany({
      where: { id, organisationId, status: 'DRAFT' },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    return result.count > 0;
  }

  /** `SUBMITTED`/`IN_PROGRESS` → `IN_PROGRESS`, activating one specific `PENDING` step
   *  (`PENDING` → `ACTIVE`). Idempotent-safe: if the step is no longer `PENDING`
   *  (already activated by a concurrent call), `count === 0` and the caller no-ops. */
  async activateStep(workflowInstanceId: string, stepInstanceId: string): Promise<boolean> {
    const result = await this.prisma.$transaction(async (tx) => {
      const stepResult = await tx.workflowStepInstance.updateMany({
        where: { id: stepInstanceId, workflowInstanceId, status: 'PENDING' },
        data: { status: 'ACTIVE', startedAt: new Date() },
      });
      if (stepResult.count === 0) {
        return 0;
      }
      await tx.workflowInstance.updateMany({
        where: { id: workflowInstanceId, status: { in: ['SUBMITTED', 'IN_PROGRESS'] } },
        data: { status: 'IN_PROGRESS' },
      });
      return stepResult.count;
    });
    return result > 0;
  }

  /** The concurrency-critical write: only succeeds if the step is still `ACTIVE` —
   *  workflow.md §13 "two users cannot approve the same active step successfully." The
   *  first concurrent request wins (`count === 1`); every other loses (`count === 0`)
   *  and the service layer reports a conflict, never a second silent success. Writes
   *  the `WorkflowDecision` in the same transaction so a step can never end up
   *  `APPROVED` with no matching decision row (or vice versa). */
  async decideStep(
    stepInstanceId: string,
    workflowInstanceId: string,
    toStatus: WorkflowStepInstanceStatus,
    decision: {
      actorUserId: string;
      decision: WorkflowDecisionType;
      comment?: string;
    },
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const stepResult = await tx.workflowStepInstance.updateMany({
        where: { id: stepInstanceId, workflowInstanceId, status: 'ACTIVE' },
        data: { status: toStatus, completedAt: new Date() },
      });
      if (stepResult.count === 0) {
        return false;
      }
      await tx.workflowDecision.create({
        data: {
          workflowInstanceId,
          workflowStepInstanceId: stepInstanceId,
          actorUserId: decision.actorUserId,
          decision: decision.decision,
          comment: decision.comment,
        },
      });
      return true;
    });
  }

  /** Sets the parent `WorkflowInstance`'s own status — called after `decideStep`
   *  determines the instance-level outcome (advance to next step, or terminate).
   *  Conditional on the current status being non-terminal, same "someone already moved
   *  it" safety as every other transition here. */
  async setInstanceStatus(
    organisationId: string,
    id: string,
    status: WorkflowInstanceStatus,
    extra: { completedAt?: Date; cancelledAt?: Date } = {},
  ): Promise<boolean> {
    const result = await this.prisma.workflowInstance.updateMany({
      where: { id, organisationId, status: { in: NON_TERMINAL_STATUSES } },
      data: { status, ...extra },
    });
    return result.count > 0;
  }

  /** `COMPLETED` is reachable from `APPROVED` only — set once the owning domain has
   *  consumed the outcome (workflow.md §4). Kept as its own method (rather than folding
   *  into `setInstanceStatus`) since its precondition differs from every other
   *  transition here. */
  async markCompleted(organisationId: string, id: string): Promise<boolean> {
    const result = await this.prisma.workflowInstance.updateMany({
      where: { id, organisationId, status: 'APPROVED' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    return result.count > 0;
  }

  findDecisionsByInstance(workflowInstanceId: string) {
    return this.prisma.workflowDecision.findMany({
      where: { workflowInstanceId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Every `WorkflowStepInstance` currently `ACTIVE`, across the whole organisation —
   *  the raw candidate set `WorkflowInstanceService.listMyApprovals` filters down to
   *  "steps this specific user is eligible for," and
   *  `WorkflowDefinitionRepository.countActiveInstances`'s sibling for the step level. */
  findActiveStepsByOrganisation(
    organisationId: string,
  ): Promise<(WorkflowStepInstance & { workflowInstance: WorkflowInstance })[]> {
    return this.prisma.workflowStepInstance.findMany({
      where: { status: 'ACTIVE', workflowInstance: { organisationId } },
      include: { workflowInstance: true },
      orderBy: { startedAt: 'asc' },
    });
  }
}
