import { Injectable } from '@nestjs/common';
import { Application, ApplicationStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateApplicationAnswerData {
  vacancyQuestionId: string;
  answerText?: string;
  answerNumber?: number;
  answerBoolean?: boolean;
}

export interface CreateApplicationData {
  organisationId: string;
  vacancyId: string;
  candidateId: string;
  resumeUrl?: string;
  resumeKey?: string;
  coverLetterText?: string;
  answers: CreateApplicationAnswerData[];
}

export interface ListApplicationsParams {
  vacancyId?: string;
  status?: ApplicationStatus;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Application Lifecycle"). `@@unique([organisationId,
 * vacancyId, candidateId])` is the duplicate-submission guard — `create()`
 * returns `null` on a P2002 conflict rather than throwing, the SAME
 * idempotent-create convention `WhatsAppDeliveryRepository`/`EmailDeliveryRepository`
 * already established (never a silent application-level check alone).
 */
@Injectable()
export class ApplicationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<Application | null> {
    return this.prisma.application.findFirst({ where: { id, organisationId } });
  }

  findByIdWithRelations(organisationId: string, id: string) {
    return this.prisma.application.findFirst({
      where: { id, organisationId },
      include: {
        candidate: true,
        vacancy: { include: { position: true, department: true } },
        answers: { include: { vacancyQuestion: true } },
        interviews: {
          include: {
            interviewStage: true,
            participants: true,
            evaluations: true,
            decisions: { orderBy: { decidedAt: 'desc' } },
          },
          orderBy: { interviewStage: { sequence: 'asc' } },
        },
        offers: { orderBy: { createdAt: 'desc' } },
      },
    });
  }

  findExisting(
    organisationId: string,
    vacancyId: string,
    candidateId: string,
  ): Promise<Application | null> {
    return this.prisma.application.findFirst({ where: { organisationId, vacancyId, candidateId } });
  }

  list(organisationId: string, params: ListApplicationsParams = {}) {
    return this.prisma.application.findMany({
      where: {
        organisationId,
        ...(params.vacancyId ? { vacancyId: params.vacancyId } : {}),
        ...(params.status ? { status: params.status } : {}),
      },
      include: { candidate: true, vacancy: { select: { title: true } } },
      orderBy: { submittedAt: 'desc' },
    });
  }

  async create(data: CreateApplicationData): Promise<Application | null> {
    try {
      return await this.prisma.application.create({
        data: {
          organisationId: data.organisationId,
          vacancyId: data.vacancyId,
          candidateId: data.candidateId,
          resumeUrl: data.resumeUrl,
          resumeKey: data.resumeKey,
          coverLetterText: data.coverLetterText,
          answers: {
            create: data.answers.map((a) => ({
              organisationId: data.organisationId,
              vacancyQuestionId: a.vacancyQuestionId,
              answerText: a.answerText,
              answerNumber: a.answerNumber,
              answerBoolean: a.answerBoolean,
            })),
          },
        },
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

  async screen(
    organisationId: string,
    id: string,
    screenedByUserId: string,
    screeningNotes?: string,
  ): Promise<Application | null> {
    const result = await this.prisma.application.updateMany({
      where: { id, organisationId, status: { in: ['SUBMITTED', 'SCREENING'] } },
      data: { status: 'SCREENING', screenedByUserId, screenedAt: new Date(), screeningNotes },
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(organisationId, id);
  }

  async shortlist(
    organisationId: string,
    id: string,
    screenedByUserId: string,
    screeningNotes?: string,
  ): Promise<Application | null> {
    const result = await this.prisma.application.updateMany({
      where: { id, organisationId, status: { in: ['SUBMITTED', 'SCREENING'] } },
      data: {
        status: 'SHORTLISTED',
        screenedByUserId,
        screenedAt: new Date(),
        ...(screeningNotes ? { screeningNotes } : {}),
      },
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(organisationId, id);
  }

  async reject(
    organisationId: string,
    id: string,
    screenedByUserId: string,
    screeningNotes?: string,
  ): Promise<Application | null> {
    const result = await this.prisma.application.updateMany({
      where: {
        id,
        organisationId,
        status: { in: ['SUBMITTED', 'SCREENING', 'SHORTLISTED', 'INTERVIEWING'] },
      },
      data: {
        status: 'REJECTED',
        screenedByUserId,
        screenedAt: new Date(),
        ...(screeningNotes ? { screeningNotes } : {}),
      },
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(organisationId, id);
  }

  /** Set once a candidate's first `Interview` for this application is
   *  scheduled — no-op (returns the current row) if already `INTERVIEWING` or
   *  further along, never regresses a further-along application backward. */
  async markInterviewing(organisationId: string, id: string): Promise<void> {
    await this.prisma.application.updateMany({
      where: { id, organisationId, status: { in: ['SHORTLISTED'] } },
      data: { status: 'INTERVIEWING' },
    });
  }

  async setStatus(
    organisationId: string,
    id: string,
    status: ApplicationStatus,
  ): Promise<Application | null> {
    const result = await this.prisma.application.updateMany({
      where: { id, organisationId },
      data: { status },
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(organisationId, id);
  }
}
