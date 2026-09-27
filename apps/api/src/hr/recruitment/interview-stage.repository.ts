import { Injectable } from '@nestjs/common';
import { InterviewStage, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateInterviewStageData {
  organisationId: string;
  vacancyId: string;
  name: string;
  description?: string;
  sequence: number;
  isRequired: boolean;
  evaluationRequired: boolean;
  participantUserIds: string[];
}

/** Sprint 30 — Recruitment & Candidate Interview Management Foundation
 *  (recruitment.md §"Configurable Interview Process"). Thin Prisma access
 *  only. `InterviewStageParticipant` is the DEFAULT panel — copied into
 *  `InterviewParticipant` at scheduling time (`InterviewRepository.schedule`). */
@Injectable()
export class InterviewStageRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string) {
    return this.prisma.interviewStage.findFirst({
      where: { id, organisationId },
      include: { participants: true },
    });
  }

  listByVacancy(organisationId: string, vacancyId: string) {
    return this.prisma.interviewStage.findMany({
      where: { organisationId, vacancyId },
      include: { participants: true },
      orderBy: { sequence: 'asc' },
    });
  }

  async maxSequence(vacancyId: string): Promise<number> {
    const last = await this.prisma.interviewStage.findFirst({
      where: { vacancyId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });
    return last?.sequence ?? 0;
  }

  create(data: CreateInterviewStageData): Promise<InterviewStage> {
    return this.prisma.interviewStage.create({
      data: {
        organisationId: data.organisationId,
        vacancyId: data.vacancyId,
        name: data.name,
        description: data.description,
        sequence: data.sequence,
        isRequired: data.isRequired,
        evaluationRequired: data.evaluationRequired,
        participants: {
          create: data.participantUserIds.map((userId) => ({
            organisationId: data.organisationId,
            userId,
          })),
        },
      },
      include: { participants: true },
    });
  }

  /** Replaces the default panel wholesale — a small, bounded list (max 20 per
   *  the validation schema), so delete-then-recreate inside one transaction
   *  is simpler and safer than a diff, and matches this codebase's existing
   *  "replace wholesale" convention for small config lists elsewhere. */
  async replaceParticipants(
    organisationId: string,
    interviewStageId: string,
    participantUserIds: string[],
  ): Promise<InterviewStage | null> {
    const stage = await this.prisma.interviewStage.findFirst({
      where: { id: interviewStageId, organisationId },
    });
    if (!stage) {
      return null;
    }
    await this.prisma.$transaction([
      this.prisma.interviewStageParticipant.deleteMany({ where: { interviewStageId } }),
      this.prisma.interviewStageParticipant.createMany({
        data: participantUserIds.map((userId) => ({ organisationId, interviewStageId, userId })),
      }),
    ]);
    return this.findById(organisationId, interviewStageId);
  }

  async update(
    organisationId: string,
    id: string,
    data: Prisma.InterviewStageUpdateInput,
  ): Promise<InterviewStage | null> {
    const result = await this.prisma.interviewStage.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.findById(organisationId, id);
  }
}
