import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Interview } from '@prisma/client';
import { ScheduleInterviewInput } from '@zentuva/validation';

import { UserService } from '../../identity/user/user.service';
import { ApplicationRepository } from './application.repository';
import { InterviewRepository } from './interview.repository';
import { InterviewStageRepository } from './interview-stage.repository';
import { RecruitmentNotificationService } from './recruitment-notification.service';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Interview Scheduling" / §"Notification Integration").
 * Scheduling is the ONE place this domain creates a `Notification` — never
 * from the public careers controller, never from screening.
 */
@Injectable()
export class InterviewService {
  constructor(
    private readonly interviewRepository: InterviewRepository,
    private readonly interviewStageRepository: InterviewStageRepository,
    private readonly applicationRepository: ApplicationRepository,
    private readonly userService: UserService,
    private readonly recruitmentNotificationService: RecruitmentNotificationService,
  ) {}

  async getById(organisationId: string, id: string) {
    const interview = await this.interviewRepository.findById(organisationId, id);
    if (!interview) {
      throw new NotFoundException('Interview not found');
    }
    return interview;
  }

  async getByIdWithRelations(organisationId: string, id: string) {
    const interview = await this.interviewRepository.findByIdWithRelations(organisationId, id);
    if (!interview) {
      throw new NotFoundException('Interview not found');
    }
    return interview;
  }

  listByApplication(organisationId: string, applicationId: string) {
    return this.interviewRepository.listByApplication(organisationId, applicationId);
  }

  /** Self-scoped — "my evaluations," reachable by ANY authenticated user
   *  regardless of `hr.recruitment.*` permissions (recruitment.md
   *  §"Access Control" — a panelist may hold none of them). */
  listForParticipant(organisationId: string, userId: string) {
    return this.interviewRepository.listForParticipant(organisationId, userId);
  }

  async isParticipant(interviewId: string, userId: string): Promise<boolean> {
    return this.interviewRepository.isParticipant(interviewId, userId);
  }

  async schedule(
    organisationId: string,
    applicationId: string,
    interviewStageId: string,
    input: ScheduleInterviewInput,
    createdById: string,
  ): Promise<Interview> {
    const application = await this.applicationRepository.findByIdWithRelations(
      organisationId,
      applicationId,
    );
    if (!application) {
      throw new NotFoundException('Application not found');
    }
    const stage = await this.interviewStageRepository.findById(organisationId, interviewStageId);
    if (!stage) {
      throw new NotFoundException('Interview stage not found');
    }
    if (stage.vacancyId !== application.vacancyId) {
      throw new BadRequestException('This interview stage does not belong to the same vacancy');
    }
    if (application.status === 'REJECTED' || application.status === 'WITHDRAWN') {
      throw new BadRequestException(
        `Cannot schedule an interview for an application with status ${application.status}`,
      );
    }

    const uniqueParticipantIds = [...new Set(input.participantUserIds)];
    for (const userId of uniqueParticipantIds) {
      const user = await this.userService.getById(organisationId, userId);
      if (!user) {
        throw new BadRequestException(`User ${userId} not found in this organisation`);
      }
    }

    const interview = await this.interviewRepository.schedule({
      organisationId,
      applicationId,
      interviewStageId,
      scheduledAt: input.scheduledAt,
      durationMinutes: input.durationMinutes,
      location: input.location,
      meetingLink: input.meetingLink,
      participantUserIds: uniqueParticipantIds,
      createdById,
    });
    if (!interview) {
      throw new BadRequestException('An interview for this candidate and stage already exists');
    }

    await this.applicationRepository.markInterviewing(organisationId, applicationId);

    await this.recruitmentNotificationService.notifyInterviewScheduled({
      organisationId,
      interviewId: interview.id,
      participantUserIds: uniqueParticipantIds,
      candidateName: `${application.candidate.firstName} ${application.candidate.lastName}`.trim(),
      positionTitle: application.vacancy.title,
      stageName: stage.name,
      scheduledAt: interview.scheduledAt,
      actionUrl: `/hr-interviews/${interview.id}`,
    });

    return interview;
  }

  async complete(organisationId: string, id: string): Promise<Interview> {
    const updated = await this.interviewRepository.complete(organisationId, id);
    if (!updated) {
      throw new BadRequestException('Interview must be SCHEDULED to mark it completed');
    }
    return updated;
  }
}
