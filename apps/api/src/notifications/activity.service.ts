import { Inject, Injectable } from '@nestjs/common';

import { UserService } from '../identity/user/user.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  WORKFLOW_SUBJECT_HANDLERS,
  WorkflowSubjectHandler,
} from '../workflow/workflow-subject-handler';
import { describeSubject, humanizeSubjectType } from './subject-label.util';

export interface ActivityRecord {
  id: string;
  organisationId: string;
  actorUserId: string | null;
  actorName: string | null;
  activityType: string;
  subjectType: string;
  subjectId: string;
  subjectReference: string;
  summary: string;
  metadata: unknown;
  occurredAt: Date;
  sourceEventId: string;
}

/**
 * Sprint 27 §Workstream 6 "Activity Centre Foundation" (docs/domains/notifications.md
 * §10). Answers "what happened," not "what needs MY attention" — deliberately NOT the
 * same data as `Notification` (organisation-wide, not recipient-scoped; nothing here
 * has a read/unread state; reading an activity item never marks any notification
 * read, and dismissing/reading a notification never removes its activity record).
 *
 * No new table: composed live from the existing, already-immutable `WorkflowEvent`
 * rows (Sprint 27 rule "if existing audit/event infrastructure can support a useful
 * activity feed, compose from it rather than duplicate"). `WorkflowEvent` rows are
 * never updated by application code except their own `notification*` processing-state
 * columns (Sprint 26.1/27) — the activity-relevant columns
 * (`eventType`/`actorUserId`/`subjectType`/`subjectId`/`summary`/`occurredAt`) are
 * write-once, satisfying "activity records should be immutable where they represent
 * historical facts" without a second table to keep immutable.
 */
@Injectable()
export class ActivityService {
  private readonly handlersByType: Map<string, WorkflowSubjectHandler>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    @Inject(WORKFLOW_SUBJECT_HANDLERS) handlers: WorkflowSubjectHandler[],
  ) {
    this.handlersByType = new Map(handlers.map((h) => [h.subjectType, h]));
  }

  async list(
    organisationId: string,
    params: { subjectType?: string; subjectId?: string; skip?: number; take?: number } = {},
  ): Promise<{ items: ActivityRecord[]; total: number }> {
    const where = {
      organisationId,
      ...(params.subjectType ? { subjectType: params.subjectType } : {}),
      ...(params.subjectId ? { subjectId: params.subjectId } : {}),
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

    const items = await Promise.all(
      events.map(async (event) => {
        const [actor, subjectReference] = await Promise.all([
          event.actorUserId ? this.userService.getById(organisationId, event.actorUserId) : null,
          describeSubject(this.handlersByType, organisationId, event.subjectType, event.subjectId),
        ]);
        const label = humanizeSubjectType(event.subjectType);
        const actorName = actor ? `${actor.firstName} ${actor.lastName}` : null;

        return {
          id: event.id,
          organisationId: event.organisationId,
          actorUserId: event.actorUserId,
          actorName,
          activityType: event.eventType,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          subjectReference,
          summary: `${label} ${subjectReference}: ${event.eventType.replace(/_/g, ' ').toLowerCase()}${
            actorName ? ` (by ${actorName})` : ''
          }`,
          metadata: event.summary,
          occurredAt: event.occurredAt,
          sourceEventId: event.id,
        };
      }),
    );

    return { items, total };
  }
}
