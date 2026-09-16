import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WorkflowEvent } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { NotificationMessageBuilder } from './notification-message-builder';
import { NotificationRecipientResolver } from './notification-recipient-resolver';

const STEPS_ORDER = { stepInstances: { orderBy: { sequence: 'asc' as const } } };

export interface ProcessPendingEventsResult {
  processed: number;
  failed: number;
  notificationsCreated: number;
}

/**
 * Sprint 27 §Workstream 2 "Durable Event Consumption" (docs/domains/notifications.md
 * §4). The consumer half of the `WorkflowEvent → Notification` boundary — reads
 * `WorkflowEvent` rows directly via Prisma (never `WorkflowInstanceService`; the
 * contract is the TABLE, not a service call, matching workflow.md §7's own framing of
 * `WorkflowEvent` as "the durable, queryable record that consumer will read from").
 * `WorkflowInstanceService` is never imported here and this service never writes to
 * any `Workflow*` table except `WorkflowEvent`'s own processing-state columns — it
 * cannot mutate workflow state (Sprint 27 rule "the consumer does not mutate workflow
 * state").
 *
 * No queue/worker/cron infrastructure exists anywhere in this codebase today
 * (verified by inspection before writing this — no BullMQ, no `@nestjs/schedule`, no
 * Redis-backed job system). Per the brief's own "implement a safe service-level
 * processing mechanism and document how it will later be scheduled" allowance, this
 * is invoked on demand via `POST /notifications/process-events` (see
 * `NotificationsController`) rather than a background loop — see
 * notifications.md §4 "Processing trigger" for the full rationale and the documented
 * future swap to a scheduled job, which requires no change to the logic here, only to
 * what calls it.
 */
@Injectable()
export class NotificationEventProcessorService {
  private readonly logger = new Logger(NotificationEventProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recipientResolver: NotificationRecipientResolver,
    private readonly messageBuilder: NotificationMessageBuilder,
  ) {}

  /** Processes up to `limit` unprocessed events for ONE organisation, oldest first.
   *  Tenant-scoped by construction — there is no "process every organisation's
   *  events" call anywhere in this service. Each event is handled independently: one
   *  event's failure never blocks another's processing (the loop continues), and the
   *  method's own return value makes failures visible to whatever called it (the
   *  controller surfaces this directly in its response — Sprint 27 rule "do not
   *  silently swallow errors"). */
  async processPendingEvents(
    organisationId: string,
    limit = 50,
  ): Promise<ProcessPendingEventsResult> {
    const events = await this.prisma.workflowEvent.findMany({
      where: { organisationId, notificationProcessedAt: null },
      orderBy: { occurredAt: 'asc' },
      take: limit,
    });

    let processed = 0;
    let failed = 0;
    let notificationsCreated = 0;

    for (const event of events) {
      try {
        notificationsCreated += await this.processOne(event);
        processed++;
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to process workflow event ${event.id} (${event.eventType}): ${message}`,
        );
        await this.prisma.workflowEvent.update({
          where: { id: event.id },
          data: {
            notificationAttempts: { increment: 1 },
            notificationLastAttemptAt: new Date(),
            notificationLastError: message.slice(0, 2000),
          },
        });
      }
    }

    return { processed, failed, notificationsCreated };
  }

  /** One event, fully atomic: every recipient's `Notification` row AND the event's
   *  own `notificationProcessedAt` stamp commit together, or neither does (Sprint 27
   *  rule "do not mark an event processed if notification creation failed" +
   *  Workstream 9's "event is retried as a whole, with idempotent recipient
   *  creation" — the simpler of the two documented options, chosen deliberately).
   *  A crash between this transaction committing and the caller returning cannot
   *  cause a duplicate on retry either: `createMany({ skipDuplicates: true })`
   *  against the DB unique index makes re-inserting the same rows a no-op, and if
   *  the transaction already committed, `notificationProcessedAt` is already set so
   *  the event is never selected again. Returns the number of NEW notification rows
   *  actually inserted (excludes rows skipped as duplicates). */
  private async processOne(event: WorkflowEvent): Promise<number> {
    const instance = await this.prisma.workflowInstance.findUnique({
      where: { id: event.workflowInstanceId },
      include: STEPS_ORDER,
    });
    if (!instance) {
      // The instance was deleted or is otherwise unreachable — nothing sensible to
      // notify anyone about. Mark processed (not a failure) so this doesn't retry
      // forever; genuinely unreachable in practice since WorkflowInstance rows are
      // never deleted, only transitioned, but handled defensively.
      await this.prisma.workflowEvent.update({
        where: { id: event.id },
        data: { notificationProcessedAt: new Date() },
      });
      return 0;
    }

    const recipients = await this.recipientResolver.resolve(
      event,
      instance,
      instance.stepInstances,
    );
    const uniqueRecipients = [...new Set(recipients)];

    const step = event.workflowStepInstanceId
      ? instance.stepInstances.find((s) => s.id === event.workflowStepInstanceId)
      : undefined;
    const message =
      uniqueRecipients.length > 0 ? await this.messageBuilder.build(event, instance, step) : null;

    const rows: Prisma.NotificationCreateManyInput[] =
      message && uniqueRecipients.length > 0
        ? uniqueRecipients.map((recipientUserId) => ({
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

    const result = await this.prisma.$transaction(async (tx) => {
      let created = 0;
      if (rows.length > 0) {
        const batch = await tx.notification.createMany({ data: rows, skipDuplicates: true });
        created = batch.count;
      }
      await tx.workflowEvent.update({
        where: { id: event.id },
        data: {
          notificationProcessedAt: new Date(),
          notificationAttempts: { increment: 1 },
          notificationLastAttemptAt: new Date(),
          notificationLastError: null,
        },
      });
      return created;
    });

    return result;
  }
}
