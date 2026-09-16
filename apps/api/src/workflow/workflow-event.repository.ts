import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WorkflowEvent } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

const logger = new Logger('WorkflowEvent');

export interface RecordWorkflowEventInput {
  organisationId: string;
  workflowInstanceId: string;
  workflowDefinitionId: string;
  workflowDefinitionVersion: number;
  subjectType: string;
  subjectId: string;
  subjectReference?: string | null;
  eventType: string;
  actorUserId?: string | null;
  targetUserId?: string | null;
  workflowStepInstanceId?: string | null;
  correlationId: string;
  idempotencyKey: string;
  summary?: Record<string, unknown>;
}

/**
 * Sprint 26.1 §7 "Workflow Events" — writes inside an ALREADY-OPEN transaction (`tx`,
 * `Prisma.TransactionClient`) so the event row commits atomically with the state
 * transition that produced it. Every caller is a `WorkflowInstanceRepository` method
 * already wrapped in `this.prisma.$transaction(...)` — this function is never called
 * outside one.
 *
 * A duplicate write for the same logical occurrence — the unique
 * `(organisationId, idempotencyKey)` constraint on `WorkflowEvent` — is swallowed as a
 * no-op, not surfaced as an error: workflow.md §7 "retries must not create duplicate
 * logical events" means the SECOND attempt silently succeeding-as-a-no-op is the
 * correct behavior. In practice this should be unreachable (every caller derives
 * `idempotencyKey` from a state transition already gated by a conditional `updateMany`
 * that only one concurrent caller can win), but the catch keeps event-recording
 * itself idempotent even if that ever changes.
 */
export async function recordWorkflowEventInTx(
  tx: Prisma.TransactionClient,
  input: RecordWorkflowEventInput,
): Promise<void> {
  try {
    await tx.workflowEvent.create({
      data: {
        organisationId: input.organisationId,
        workflowInstanceId: input.workflowInstanceId,
        workflowDefinitionId: input.workflowDefinitionId,
        workflowDefinitionVersion: input.workflowDefinitionVersion,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        subjectReference: input.subjectReference ?? null,
        eventType: input.eventType,
        actorUserId: input.actorUserId ?? null,
        targetUserId: input.targetUserId ?? null,
        workflowStepInstanceId: input.workflowStepInstanceId ?? null,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        summary: (input.summary ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      logger.debug(`Duplicate workflow event suppressed: ${input.idempotencyKey}`);
      return;
    }
    throw error;
  }
}

/** Read-only access for the admin UI / future Notifications consumer — no business
 *  logic, matching this codebase's thin-repository convention. */
@Injectable()
export class WorkflowEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByInstance(workflowInstanceId: string): Promise<WorkflowEvent[]> {
    return this.prisma.workflowEvent.findMany({
      where: { workflowInstanceId },
      orderBy: { occurredAt: 'asc' },
    });
  }

  findManyByOrganisation(organisationId: string, limit = 200): Promise<WorkflowEvent[]> {
    return this.prisma.workflowEvent.findMany({
      where: { organisationId },
      orderBy: { occurredAt: 'desc' },
      take: limit,
    });
  }
}
