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
import { RecordWorkflowEventInput, recordWorkflowEventInTx } from './workflow-event.repository';

export type WorkflowInstanceWithSteps = WorkflowInstance & {
  stepInstances: WorkflowStepInstance[];
};

export interface ListWorkflowInstancesParams {
  status?: WorkflowInstanceStatus;
  subjectType?: string;
  requestedById?: string;
  /** Sprint 26.1 §9 — `true` filters to non-terminal instances whose `dueAt` has
   *  passed, at the database level (never a client-side computation on the full
   *  list). Combining this with `status` is allowed but redundant/contradictory if
   *  `status` names a terminal state — the caller's responsibility to avoid. */
  overdue?: boolean;
}

const STEPS_ORDER = { stepInstances: { orderBy: { sequence: 'asc' as const } } };

const NON_TERMINAL_STATUSES: WorkflowInstanceStatus[] = ['DRAFT', 'SUBMITTED', 'IN_PROGRESS'];

/** Thrown by `createWithSteps` when the new partial unique index
 *  (`workflow_instances_one_active_per_subject`, added Sprint 26.1) rejects a second
 *  concurrent non-terminal instance for the same subject — the service layer catches
 *  this and reports 409, exactly like every other conflict here. */
export class ConflictingActiveInstanceError extends Error {
  constructor() {
    super('This record already has an active workflow instance in progress');
    this.name = 'ConflictingActiveInstanceError';
  }
}

/**
 * Thin Prisma access for `WorkflowInstance` + `WorkflowStepInstance` + `WorkflowDecision`
 * + `WorkflowEvent` — no business logic, see `WorkflowInstanceService` and
 * docs/domains/workflow.md.
 *
 * Concurrency-safety convention (workflow.md §12, matches
 * `PurchaseOrderRepository.update`'s own established idiom): every status transition
 * uses a conditional `updateMany` whose `WHERE` clause includes the expected current
 * status — `count === 0` means "someone else already moved it," the caller treats that
 * as a conflict, never a silent no-op. This is this codebase's existing concurrency
 * primitive throughout (also `AttendanceRepository.findOrCreateForDate`'s P2002 catch),
 * not a new pattern invented for Workflow.
 *
 * Sprint 26.1 addition: every mutating method here optionally accepts an `event`
 * (a fully-built `RecordWorkflowEventInput`) and, if the state transition succeeds,
 * writes it inside the SAME transaction — workflow.md §7 "a successful workflow
 * transition must produce one durable, tenant-scoped event record." Building the event
 * payload (which fields, which idempotency key) is the service's job; this repository
 * only persists what it's given, unchanged from its existing "no business logic" role.
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
        ...(params.overdue
          ? { status: { in: NON_TERMINAL_STATUSES }, dueAt: { lt: new Date() } }
          : {}),
      },
      include: STEPS_ORDER,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** workflow.md §12 "a business subject cannot receive conflicting active workflows
   *  unless explicitly allowed" — MVP default: at most one non-terminal instance per
   *  `(organisationId, subjectType, subjectId)`, regardless of which `WorkflowDefinition`
   *  it's for. This check is a fast, cheap pre-flight for a clear error message; the
   *  actual guarantee under concurrency is the database-level partial unique index
   *  `workflow_instances_one_active_per_subject` (Sprint 26.1) that `createWithSteps`
   *  relies on — this method alone is NOT race-safe (classic check-then-act), by
   *  design: it exists only to fail fast in the common, non-concurrent case. */
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
   *  creation and submission can never rewrite an already-created draft either.
   *
   *  Sprint 26.1: the actual concurrency guarantee against two simultaneous active
   *  instances for the same subject is the database's own partial unique index — a
   *  violation surfaces as `Prisma.PrismaClientKnownRequestError` code `P2002`, caught
   *  here and re-thrown as `ConflictingActiveInstanceError` so the service layer never
   *  has to know about Prisma error codes. `event`, if given (only used by
   *  `resubmit()` — a fresh `create()` doesn't fire an event until `submit()`), is
   *  written in the same transaction as the insert. */
  async createWithSteps(
    instanceData: Prisma.WorkflowInstanceUncheckedCreateInput,
    stepInstances: Prisma.WorkflowStepInstanceCreateManyWorkflowInstanceInput[],
    event?: RecordWorkflowEventInput,
  ): Promise<WorkflowInstanceWithSteps> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const instance = await tx.workflowInstance.create({
          data: { ...instanceData, stepInstances: { createMany: { data: stepInstances } } },
          include: STEPS_ORDER,
        });
        if (event) {
          await recordWorkflowEventInTx(tx, event);
        }
        return instance;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictingActiveInstanceError();
      }
      throw error;
    }
  }

  /** `DRAFT` → `SUBMITTED` (then the caller separately activates step 1). Conditional
   *  on the current status still being `DRAFT` — workflow.md §12 "a workflow cannot be
   *  submitted twice." */
  async submit(
    organisationId: string,
    id: string,
    event?: RecordWorkflowEventInput,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.workflowInstance.updateMany({
        where: { id, organisationId, status: 'DRAFT' },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      });
      if (result.count === 0) {
        return false;
      }
      if (event) {
        await recordWorkflowEventInTx(tx, event);
      }
      return true;
    });
  }

  /** `SUBMITTED`/`IN_PROGRESS` → `IN_PROGRESS`, activating one specific `PENDING` step
   *  (`PENDING` → `ACTIVE`). Idempotent-safe: if the step is no longer `PENDING`
   *  (already activated by a concurrent call), `count === 0` and the caller no-ops. */
  async activateStep(
    workflowInstanceId: string,
    stepInstanceId: string,
    event?: RecordWorkflowEventInput,
  ): Promise<boolean> {
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
      if (event) {
        await recordWorkflowEventInTx(tx, event);
      }
      return stepResult.count;
    });
    return result > 0;
  }

  /** The concurrency-critical write: only succeeds if the step is still `ACTIVE` —
   *  workflow.md §12 "two users cannot approve the same active step successfully." The
   *  first concurrent request wins (`count === 1`); every other loses (`count === 0`)
   *  and the service layer reports a conflict, never a second silent success. Writes
   *  the `WorkflowDecision` (and, if given, the `WorkflowEvent`) in the same
   *  transaction so a step can never end up `APPROVED` with no matching decision row
   *  (or vice versa). */
  async decideStep(
    stepInstanceId: string,
    workflowInstanceId: string,
    toStatus: WorkflowStepInstanceStatus,
    decision: {
      actorUserId: string;
      decision: WorkflowDecisionType;
      comment?: string;
    },
    event?: RecordWorkflowEventInput,
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
      if (event) {
        await recordWorkflowEventInTx(tx, event);
      }
      return true;
    });
  }

  /** Sets the parent `WorkflowInstance`'s own status — called after `decideStep`
   *  determines the instance-level outcome (advance to next step, or terminate), or
   *  directly for cancel. Conditional on the current status being non-terminal, same
   *  "someone already moved it" safety as every other transition here. */
  async setInstanceStatus(
    organisationId: string,
    id: string,
    status: WorkflowInstanceStatus,
    extra: { completedAt?: Date; cancelledAt?: Date; expiredAt?: Date } = {},
    event?: RecordWorkflowEventInput,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.workflowInstance.updateMany({
        where: { id, organisationId, status: { in: NON_TERMINAL_STATUSES } },
        data: { status, ...extra },
      });
      if (result.count === 0) {
        return false;
      }
      if (event) {
        await recordWorkflowEventInTx(tx, event);
      }
      return true;
    });
  }

  /** `COMPLETED` is reachable from `APPROVED` only — set once the owning domain has
   *  consumed the outcome (workflow.md §4). Kept as its own method (rather than folding
   *  into `setInstanceStatus`) since its precondition differs from every other
   *  transition here. */
  async markCompleted(
    organisationId: string,
    id: string,
    event?: RecordWorkflowEventInput,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.workflowInstance.updateMany({
        where: { id, organisationId, status: 'APPROVED' },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      if (result.count === 0) {
        return false;
      }
      if (event) {
        await recordWorkflowEventInTx(tx, event);
      }
      return true;
    });
  }

  /** Sprint 26.1 §9 — an explicit, deliberate `EXPIRED` transition. Only succeeds if
   *  the instance is still non-terminal AND `dueAt` has actually passed — a caller
   *  cannot expire a workflow early by mistake, and cannot expire one with no
   *  `dueAt` configured at all (`dueAt: { lt: now }` is never true for a `null`
   *  column). No background job calls this in this sprint (deliberately out of
   *  scope); it exists so the transition itself, and its "expired workflows can never
   *  be approved" consequence, is real and testable ahead of that future job. */
  async expire(
    organisationId: string,
    id: string,
    event?: RecordWorkflowEventInput,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.workflowInstance.updateMany({
        where: {
          id,
          organisationId,
          status: { in: NON_TERMINAL_STATUSES },
          dueAt: { lt: new Date() },
        },
        data: { status: 'EXPIRED', expiredAt: new Date() },
      });
      if (result.count === 0) {
        return false;
      }
      if (event) {
        await recordWorkflowEventInTx(tx, event);
      }
      return true;
    });
  }

  /** Sprint 26.1 §3 "Return & Resubmission" — the atomic single-winner claim: only
   *  the FIRST call against a given `RETURNED`, not-yet-resubmitted instance succeeds
   *  (`resubmittedAt IS NULL` in the `WHERE`). A second concurrent call — or a second
   *  call after the first already succeeded — sees `count === 0` and the service
   *  layer reports a conflict, never a second resubmission of the same instance. This
   *  is what makes "concurrent resubmission has exactly one winner" true even though
   *  the actual new-instance creation happens in a separate statement afterward. */
  async claimForResubmission(organisationId: string, id: string): Promise<boolean> {
    const result = await this.prisma.workflowInstance.updateMany({
      where: { id, organisationId, status: 'RETURNED', resubmittedAt: null },
      data: { resubmittedAt: new Date() },
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
