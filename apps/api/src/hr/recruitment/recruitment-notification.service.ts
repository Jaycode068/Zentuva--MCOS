import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface InterviewScheduledNotificationInput {
  organisationId: string;
  interviewId: string;
  participantUserIds: string[];
  candidateName: string;
  positionTitle: string;
  stageName: string;
  scheduledAt: Date | null;
  actionUrl: string;
}

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Notification Integration"). Creates `Notification` rows
 * DIRECTLY against the shared `notifications` table — reusing the exact
 * model/idempotency shape `NotificationRepository` itself uses
 * (`createMany({ skipDuplicates: true })` against the partial unique index
 * scoped to `sourceType = 'INTERVIEW'`, added in this sprint's migration) —
 * rather than importing `NotificationsModule`, which would create a circular
 * module dependency (`WorkflowModule` → `RecruitmentModule` →
 * `NotificationsModule` → `WorkflowModule`, since Notifications imports
 * Workflow and Workflow now imports Recruitment for the Hiring Request
 * handler). `PrismaService` is globally registered
 * (`@Global()`, `prisma.module.ts`), so this needs no module import at all.
 *
 * Deliberately NEVER calls an email/WhatsApp provider directly (brief §18/
 * §41 "do not create hardcoded channel logic inside Recruitment") — once this
 * row exists, the EXISTING `EmailDeliveryCreationService`/
 * `WhatsAppDeliveryCreationService` (Sprint 28/29, unchanged) pick it up on
 * their next sweep exactly like a Workflow-sourced notification, since both
 * scan the `Notification` table generically.
 *
 * `INTERVIEW_SCHEDULED` and `INTERVIEW_EVALUATION_REQUIRED` fire TOGETHER,
 * once, in the same call that creates the `Interview` — recruitment.md §9
 * documents why a genuinely delayed post-interview reminder is deferred (no
 * background scheduler exists anywhere in this codebase).
 */
@Injectable()
export class RecruitmentNotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async notifyInterviewScheduled(input: InterviewScheduledNotificationInput): Promise<void> {
    if (input.participantUserIds.length === 0) {
      return;
    }

    const whenText = input.scheduledAt
      ? input.scheduledAt.toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : 'a time to be confirmed';

    const scheduledTitle = `Interview Scheduled — ${input.candidateName}`;
    const scheduledBody = `Candidate: ${input.candidateName}\nPosition: ${input.positionTitle}\nStage: ${input.stageName}\nDate: ${whenText}\n\nYou are an interviewer for this stage.`;

    const evaluationTitle = `Evaluation Required — ${input.candidateName}`;
    const evaluationBody = `Your evaluation is needed for ${input.candidateName}'s ${input.stageName} interview (${input.positionTitle}). Please submit your independent score and recommendation.`;

    const rows: Prisma.NotificationCreateManyInput[] = [];
    for (const recipientUserId of input.participantUserIds) {
      rows.push({
        organisationId: input.organisationId,
        recipientUserId,
        type: 'INTERVIEW_SCHEDULED',
        title: scheduledTitle,
        body: scheduledBody,
        sourceType: 'INTERVIEW',
        sourceId: input.interviewId,
        actionUrl: input.actionUrl,
      });
      rows.push({
        organisationId: input.organisationId,
        recipientUserId,
        type: 'INTERVIEW_EVALUATION_REQUIRED',
        title: evaluationTitle,
        body: evaluationBody,
        sourceType: 'INTERVIEW',
        sourceId: input.interviewId,
        actionUrl: input.actionUrl,
      });
    }

    await this.prisma.notification.createMany({ data: rows, skipDuplicates: true });
  }
}
