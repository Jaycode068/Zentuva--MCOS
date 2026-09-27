import { Injectable } from '@nestjs/common';
import { Interview, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ScheduleInterviewData {
  organisationId: string;
  applicationId: string;
  interviewStageId: string;
  scheduledAt: Date;
  durationMinutes?: number;
  location?: string;
  meetingLink?: string;
  participantUserIds: string[];
  createdById: string;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Interview Scheduling"). `@@unique([applicationId,
 * interviewStageId])` is both the "one interview per candidate per stage"
 * business rule AND the concurrency/duplicate-schedule guard — `schedule()`
 * returns `null` on a P2002 conflict rather than throwing, same idempotent-
 * create convention as `ApplicationRepository.create`.
 */
@Injectable()
export class InterviewRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string) {
    return this.prisma.interview.findFirst({
      where: { id, organisationId },
      include: { participants: true, interviewStage: true, application: true },
    });
  }

  findByIdWithRelations(organisationId: string, id: string) {
    return this.prisma.interview.findFirst({
      where: { id, organisationId },
      include: {
        participants: true,
        evaluations: true,
        decisions: { orderBy: { decidedAt: 'desc' } },
        interviewStage: true,
        application: { include: { candidate: true, vacancy: true } },
      },
    });
  }

  findByApplicationAndStage(
    organisationId: string,
    applicationId: string,
    interviewStageId: string,
  ) {
    return this.prisma.interview.findFirst({
      where: { organisationId, applicationId, interviewStageId },
      include: { participants: true, evaluations: true },
    });
  }

  listByApplication(organisationId: string, applicationId: string) {
    return this.prisma.interview.findMany({
      where: { organisationId, applicationId },
      include: {
        participants: true,
        evaluations: true,
        decisions: { orderBy: { decidedAt: 'desc' } },
        interviewStage: true,
      },
      orderBy: { interviewStage: { sequence: 'asc' } },
    });
  }

  /** Every user assigned as a participant on ANY interview — the base query
   *  for "my evaluations," self-scoped by `userId` alone (no permission
   *  required — recruitment.md §"HR Visibility" vs. the self-scoped
   *  interviewer surface are deliberately different authorization models). */
  listForParticipant(organisationId: string, userId: string) {
    return this.prisma.interview.findMany({
      where: { organisationId, participants: { some: { userId } } },
      include: {
        interviewStage: true,
        evaluations: { where: { evaluatorUserId: userId } },
        application: { include: { candidate: true, vacancy: { select: { title: true } } } },
      },
      orderBy: { scheduledAt: 'desc' },
    });
  }

  async schedule(data: ScheduleInterviewData): Promise<Interview | null> {
    try {
      return await this.prisma.interview.create({
        data: {
          organisationId: data.organisationId,
          applicationId: data.applicationId,
          interviewStageId: data.interviewStageId,
          scheduledAt: data.scheduledAt,
          durationMinutes: data.durationMinutes,
          location: data.location,
          meetingLink: data.meetingLink,
          createdById: data.createdById,
          participants: {
            create: data.participantUserIds.map((userId) => ({
              organisationId: data.organisationId,
              userId,
            })),
          },
        },
        include: { participants: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        return null;
      }
      throw error;
    }
  }

  async isParticipant(interviewId: string, userId: string): Promise<boolean> {
    const row = await this.prisma.interviewParticipant.findFirst({
      where: { interviewId, userId },
    });
    return row !== null;
  }

  async complete(organisationId: string, id: string): Promise<Interview | null> {
    const result = await this.prisma.interview.updateMany({
      where: { id, organisationId, status: 'SCHEDULED' },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.interview.findFirst({ where: { id, organisationId } });
  }
}
