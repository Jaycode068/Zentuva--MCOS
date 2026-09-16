import { Inject, Injectable } from '@nestjs/common';
import {
  NotificationType,
  WorkflowEvent,
  WorkflowInstance,
  WorkflowStepInstance,
} from '@prisma/client';

import {
  WORKFLOW_SUBJECT_HANDLERS,
  WorkflowSubjectHandler,
} from '../workflow/workflow-subject-handler';
import { describeSubject, humanizeSubjectType } from './subject-label.util';

export interface BuiltNotificationMessage {
  type: NotificationType;
  title: string;
  body: string;
  actionUrl: string;
}

/** Only the workflow event types that actually produce a notification (see
 *  `NotificationRecipientResolver`) need an entry — `null` recipients from the
 *  resolver already short-circuit before this map is consulted, but keeping the map
 *  keyed the same way documents the pairing in one place. */
const EVENT_TO_NOTIFICATION_TYPE: Partial<Record<string, NotificationType>> = {
  APPROVAL_REQUIRED: 'WORKFLOW_APPROVAL_REQUIRED',
  STEP_APPROVED: 'WORKFLOW_STEP_APPROVED',
  APPROVED: 'WORKFLOW_APPROVED',
  REJECTED: 'WORKFLOW_STEP_REJECTED',
  RETURNED: 'WORKFLOW_RETURNED',
  RESUBMITTED: 'WORKFLOW_RESUBMITTED',
  CANCELLED: 'WORKFLOW_CANCELLED',
  EXPIRED: 'WORKFLOW_EXPIRED',
};

/**
 * Sprint 27 §Workstream 8 "Notification Message Construction" (docs/domains/
 * notifications.md §9). The ONLY place workflow notification text is written —
 * `NotificationEventProcessorService` never inlines a title/body itself. Deterministic
 * (same event + same instance state always produces the same text), safe against
 * missing optional metadata (a step with no name, a subject the handler can't
 * describe), and produces plain text only — never HTML — so the frontend can render
 * it with ordinary text interpolation with no injection risk, even though `comment`
 * is user-authored free text (Sprint 26.1's required reject/return comment).
 */
@Injectable()
export class NotificationMessageBuilder {
  private readonly handlersByType: Map<string, WorkflowSubjectHandler>;

  constructor(@Inject(WORKFLOW_SUBJECT_HANDLERS) handlers: WorkflowSubjectHandler[]) {
    this.handlersByType = new Map(handlers.map((h) => [h.subjectType, h]));
  }

  /** Returns `null` for an event type with no defined message (mirrors the
   *  recipient resolver's own "no mapping = no notification" default) — the
   *  processor should never reach this for an event `NotificationRecipientResolver`
   *  already returned zero recipients for, but this stays safe either way. */
  async build(
    event: WorkflowEvent,
    instance: WorkflowInstance,
    step: WorkflowStepInstance | undefined,
  ): Promise<BuiltNotificationMessage | null> {
    const type = EVENT_TO_NOTIFICATION_TYPE[event.eventType];
    if (!type) return null;

    const label = humanizeSubjectType(instance.subjectType);
    const ref = await describeSubject(
      this.handlersByType,
      instance.organisationId,
      instance.subjectType,
      instance.subjectId,
    );
    const stepName = step?.stepNameSnapshot;
    const summary = (event.summary ?? {}) as Record<string, unknown>;
    const comment = typeof summary.comment === 'string' ? summary.comment.trim() : undefined;
    const actionUrl = `/settings/workflows/instances/${instance.id}`;

    switch (type) {
      case 'WORKFLOW_APPROVAL_REQUIRED':
        return {
          type,
          title: 'Approval required',
          body: `${label} ${ref} is awaiting your approval${stepName ? ` (${stepName})` : ''}.`,
          actionUrl,
        };
      case 'WORKFLOW_STEP_APPROVED':
        return {
          type,
          title: 'Step approved',
          body: `Step "${stepName ?? 'a step'}" of your ${label} ${ref} was approved. Moving to the next step.`,
          actionUrl,
        };
      case 'WORKFLOW_APPROVED':
        return {
          type,
          title: 'Approved',
          body: `Your ${label} ${ref} has been fully approved.`,
          actionUrl,
        };
      case 'WORKFLOW_STEP_REJECTED':
        return {
          type,
          title: 'Rejected',
          body: `Your ${label} ${ref} was rejected${comment ? `: "${comment}"` : '.'}`,
          actionUrl,
        };
      case 'WORKFLOW_RETURNED':
        return {
          type,
          title: 'Returned for correction',
          body: `Your ${label} ${ref} was returned for correction${comment ? `: "${comment}"` : '.'}`,
          actionUrl,
        };
      case 'WORKFLOW_RESUBMITTED':
        return {
          type,
          title: 'Resubmitted',
          body: `${label} ${ref}, which you returned for correction, has been resubmitted.`,
          actionUrl,
        };
      case 'WORKFLOW_CANCELLED':
        return {
          type,
          title: 'Cancelled',
          body: `Your ${label} ${ref} was cancelled.`,
          actionUrl,
        };
      case 'WORKFLOW_EXPIRED':
        return {
          type,
          title: 'Expired',
          body: `${label} ${ref} has expired without a decision.`,
          actionUrl,
        };
    }
  }
}
