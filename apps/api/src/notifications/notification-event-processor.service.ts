import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationProcessingStatus, Prisma, WorkflowEvent } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { categoryForType } from './notification-category';
import { NotificationMessageBuilder } from './notification-message-builder';
import {
  MAX_PROCESSING_ATTEMPTS,
  PROCESSING_LEASE_MS,
  retryDelayForAttempt,
} from './notification-processing.constants';
import { NotificationPreferenceService } from './notification-preference.service';
import { NotificationRecipientResolver } from './notification-recipient-resolver';

const STEPS_ORDER = { stepInstances: { orderBy: { sequence: 'asc' as const } } };

export interface ProcessPendingEventsResult {
  processed: number;
  failed: number;
  notificationsCreated: number;
}

export interface ProcessingRecordView {
  id: string;
  eventType: string;
  workflowInstanceId: string;
  subjectType: string;
  subjectId: string;
  status: NotificationProcessingStatus;
  attempts: number;
  firstAttemptAt: Date | null;
  lastAttemptAt: Date | null;
  processedAt: Date | null;
  nextRetryAt: Date | null;
  lastErrorCategory: string | null;
  lastError: string | null;
  occurredAt: Date;
}

export interface ListProcessingRecordsParams {
  status?: NotificationProcessingStatus;
  skip?: number;
  take?: number;
}

function toView(event: WorkflowEvent): ProcessingRecordView {
  return {
    id: event.id,
    eventType: event.eventType,
    workflowInstanceId: event.workflowInstanceId,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    status: event.notificationProcessingStatus,
    attempts: event.notificationAttempts,
    firstAttemptAt: event.notificationFirstAttemptAt,
    lastAttemptAt: event.notificationLastAttemptAt,
    processedAt: event.notificationProcessedAt,
    nextRetryAt: event.notificationNextRetryAt,
    lastErrorCategory: event.notificationLastErrorCategory,
    lastError: event.notificationLastError,
    occurredAt: event.occurredAt,
  };
}

function classifyError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return `PRISMA_${error.code}`;
  if (error instanceof Error && error.name) return error.name;
  return 'UNKNOWN';
}

/**
 * Sprint 27/27.1 — the consumer half of the `WorkflowEvent → Notification`
 * boundary. Reads `WorkflowEvent` rows directly via Prisma (never
 * `WorkflowInstanceService`) and never writes to any `Workflow*` table except
 * `WorkflowEvent`'s own `notification*` processing-state columns.
 *
 * Sprint 27.1 §Workstream A rewrite — the state machine is now explicit
 * (`NotificationProcessingStatus`: `PENDING` → `PROCESSING` → `PROCESSED`, or
 * back to `PENDING` with backoff / terminal `FAILED`, notifications.md §4) and
 * concurrency-safe: `claimBatch` uses a per-row conditional `updateMany` (this
 * codebase's established idiom — `WorkflowInstanceRepository.decideStep`'s own
 * pattern) as the actual claim, not merely a `SELECT`. Two concurrent callers of
 * `processPendingEvents` racing the same event: only one's `updateMany` affects a
 * row (`count === 1`); the other sees `count === 0` and simply doesn't include
 * that event in its own claimed batch — there is no window where both process the
 * same event.
 */
@Injectable()
export class NotificationEventProcessorService {
  private readonly logger = new Logger(NotificationEventProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recipientResolver: NotificationRecipientResolver,
    private readonly messageBuilder: NotificationMessageBuilder,
    private readonly preferenceService: NotificationPreferenceService,
  ) {}

  /** Claims and processes up to `limit` events for ONE organisation. Tenant-scoped
   *  by construction. One event's failure never blocks another's — the loop
   *  continues, and the return value surfaces failures rather than swallowing
   *  them. */
  async processPendingEvents(
    organisationId: string,
    limit = 50,
  ): Promise<ProcessPendingEventsResult> {
    const claimed = await this.claimBatch(organisationId, limit);

    let processed = 0;
    let failed = 0;
    let notificationsCreated = 0;

    for (const event of claimed) {
      try {
        notificationsCreated += await this.processOne(event);
        processed++;
      } catch (error) {
        failed++;
        await this.recordFailure(event, error);
      }
    }

    return { processed, failed, notificationsCreated };
  }

  /** The claim step (notifications.md §4 "Concurrency protection"). Selects
   *  candidates that are either `PENDING` and due (`notificationNextRetryAt` in
   *  the past or unset), or `PROCESSING` with an abandoned lease
   *  (`notificationLeaseAt` older than `PROCESSING_LEASE_MS` — a crashed prior
   *  attempt, notifications.md §4 "Stale-lease recovery"). Each candidate is then
   *  claimed individually via a conditional `updateMany` re-checking the SAME
   *  predicate at claim time — a candidate another concurrent call already
   *  claimed between the `SELECT` and this `UPDATE` simply fails to claim
   *  (`count === 0`) and is skipped, never double-processed. */
  private async claimBatch(organisationId: string, limit: number): Promise<WorkflowEvent[]> {
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - PROCESSING_LEASE_MS);

    const candidates = await this.prisma.workflowEvent.findMany({
      where: {
        organisationId,
        OR: [
          { notificationProcessingStatus: 'PENDING', notificationNextRetryAt: null },
          { notificationProcessingStatus: 'PENDING', notificationNextRetryAt: { lte: now } },
          { notificationProcessingStatus: 'PROCESSING', notificationLeaseAt: { lt: staleCutoff } },
        ],
      },
      orderBy: { occurredAt: 'asc' },
      take: limit,
    });

    const claimed: WorkflowEvent[] = [];
    for (const candidate of candidates) {
      const result = await this.prisma.workflowEvent.updateMany({
        where: {
          id: candidate.id,
          OR: [
            { notificationProcessingStatus: 'PENDING' },
            {
              notificationProcessingStatus: 'PROCESSING',
              notificationLeaseAt: { lt: staleCutoff },
            },
          ],
        },
        data: {
          notificationProcessingStatus: 'PROCESSING',
          notificationLeaseAt: now,
          notificationFirstAttemptAt: candidate.notificationFirstAttemptAt ?? now,
        },
      });
      if (result.count > 0) {
        claimed.push(candidate);
      }
    }
    return claimed;
  }

  /** One event, fully atomic: every recipient's `Notification` row AND the
   *  event's own terminal `PROCESSED` state commit together, or neither does. A
   *  crash between this transaction committing and the caller returning cannot
   *  cause a duplicate on retry: `createMany({ skipDuplicates: true })` against
   *  the DB unique index makes re-inserting the same rows a no-op, and if the
   *  transaction already committed, the row is `PROCESSED` and never claimed
   *  again. Sprint 27.1: recipients whose `NotificationPreference` disables this
   *  event's category are filtered out BEFORE message construction — they never
   *  receive a row, but the event still reaches `PROCESSED` normally (a
   *  preference is not a failure). Returns the number of NEW notification rows
   *  actually inserted. */
  private async processOne(event: WorkflowEvent): Promise<number> {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id: event.workflowInstanceId },
      include: STEPS_ORDER,
    });
    if (!instance) {
      // The instance is unreachable — nothing sensible to notify anyone about.
      // Not a failure: mark PROCESSED so this never retries forever.
      await this.prisma.workflowEvent.update({
        where: { id: event.id },
        data: {
          notificationProcessingStatus: 'PROCESSED',
          notificationProcessedAt: new Date(),
          notificationLeaseAt: null,
        },
      });
      return 0;
    }

    const resolved = await this.recipientResolver.resolve(event, instance, instance.stepInstances);
    const uniqueRecipients = [...new Set(resolved)];

    const step = event.workflowStepInstanceId
      ? instance.stepInstances.find((s) => s.id === event.workflowStepInstanceId)
      : undefined;
    const message =
      uniqueRecipients.length > 0 ? await this.messageBuilder.build(event, instance, step) : null;

    const enabledRecipients =
      message && uniqueRecipients.length > 0
        ? await this.preferenceService.filterEnabledRecipients(
            event.organisationId,
            uniqueRecipients,
            categoryForType(message.type),
          )
        : [];

    const rows: Prisma.NotificationCreateManyInput[] =
      message && enabledRecipients.length > 0
        ? enabledRecipients.map((recipientUserId) => ({
            organisationId: event.organisationId,
            recipientUserId,
            type: message.type,
            channel: 'IN_APP' as const,
            title: message.title,
            body: message.body,
            sourceEventId: event.id,
            sourceType: event.subjectType,
            sourceId: event.subjectId,
            actionUrl: message.actionUrl,
          }))
        : [];

    return this.prisma.$transaction(async (tx) => {
      let created = 0;
      if (rows.length > 0) {
        const batch = await tx.notification.createMany({ data: rows, skipDuplicates: true });
        created = batch.count;
      }
      await tx.workflowEvent.update({
        where: { id: event.id },
        data: {
          notificationProcessingStatus: 'PROCESSED',
          notificationProcessedAt: new Date(),
          notificationAttempts: { increment: 1 },
          notificationLastAttemptAt: new Date(),
          notificationLastError: null,
          notificationLastErrorCategory: null,
          notificationLeaseAt: null,
          notificationNextRetryAt: null,
        },
      });
      return created;
    });
  }

  /** A retryable outcome: attempts < `MAX_PROCESSING_ATTEMPTS` → back to
   *  `PENDING` with backoff (notifications.md §4 "Retry policy"). Attempts
   *  exhausted → terminal `FAILED`, requiring `retryEvent` below. Guarded by
   *  `WHERE notificationProcessingStatus: 'PROCESSING'` — only the caller that
   *  actually holds the claim can record its own outcome. */
  private async recordFailure(event: WorkflowEvent, error: unknown): Promise<void> {
    const attempts = event.notificationAttempts + 1;
    const message = error instanceof Error ? error.message : String(error);
    const category = classifyError(error);
    const terminal = attempts >= MAX_PROCESSING_ATTEMPTS;

    this.logger.error(
      `Notification processing attempt ${attempts} failed for WorkflowEvent ${event.id} (${event.eventType}): ${message}`,
    );

    await this.prisma.workflowEvent.updateMany({
      where: { id: event.id, notificationProcessingStatus: 'PROCESSING' },
      data: {
        notificationProcessingStatus: terminal ? 'FAILED' : 'PENDING',
        notificationAttempts: { increment: 1 },
        notificationLastAttemptAt: new Date(),
        notificationLastError: message.slice(0, 2000),
        notificationLastErrorCategory: category,
        notificationNextRetryAt: terminal
          ? null
          : new Date(Date.now() + retryDelayForAttempt(attempts)),
        notificationLeaseAt: null,
      },
    });
  }

  /** Sprint 27.1 §Workstream F "Operational Administration" — paginated,
   *  tenant-scoped inspection of processing records, optionally filtered by
   *  status (typically `FAILED`, per the brief's "which source event failed").
   *  Read-only; never mutates. */
  async listProcessingRecords(
    organisationId: string,
    params: ListProcessingRecordsParams = {},
  ): Promise<{ items: ProcessingRecordView[]; total: number }> {
    const where = {
      organisationId,
      ...(params.status ? { notificationProcessingStatus: params.status } : {}),
    };
    const [events, total] = await Promise.all([
      this.prisma.workflowEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip: params.skip,
        take: params.take ?? 50,
      }),
      this.prisma.workflowEvent.count({ where }),
    ]);
    return { items: events.map(toView), total };
  }

  /** Sprint 27.1 §Workstream F — a tenant-scoped, idempotent manual retry.
   *  Eligible from `FAILED` (attempts exhausted) or `PROCESSING` (stuck, even
   *  before the normal stale-lease window elapses — brief: "Events manually
   *  selected for retry by an authorised administrator"). Bypasses the normal
   *  backoff delay entirely ("whether manual retry can override the normal retry
   *  delay" — yes, always): `notificationNextRetryAt` is set to `now()`, so the
   *  very next `processPendingEvents` call picks it up immediately. Does NOT
   *  reset `notificationAttempts` — the full attempt history is preserved for
   *  audit; a manually-retried event can still exhaust attempts and return to
   *  `FAILED` again. Cannot create a duplicate notification: the eventual
   *  `processOne` call still goes through the same `createMany({
   *  skipDuplicates: true })` path as any other attempt. */
  async retryEvent(organisationId: string, eventId: string): Promise<ProcessingRecordView> {
    const existing = await this.prisma.workflowEvent.findFirst({
      where: { id: eventId, organisationId },
    });
    if (!existing) {
      throw new NotFoundException('Processing record not found');
    }
    if (existing.notificationProcessingStatus === 'PROCESSED') {
      throw new ConflictException('This event has already been processed successfully');
    }

    const result = await this.prisma.workflowEvent.updateMany({
      where: {
        id: eventId,
        organisationId,
        notificationProcessingStatus: { in: ['FAILED', 'PROCESSING'] },
      },
      data: {
        notificationProcessingStatus: 'PENDING',
        notificationNextRetryAt: new Date(),
        notificationLeaseAt: null,
      },
    });
    if (result.count === 0) {
      throw new ConflictException('This event is not currently eligible for retry');
    }

    const updated = await this.prisma.workflowEvent.findFirstOrThrow({
      where: { id: eventId, organisationId },
    });
    return toView(updated);
  }
}
