import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InterviewStage, Prisma } from '@prisma/client';
import { CreateInterviewStageInput } from '@zentuva/validation';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

import { UserService } from '../../identity/user/user.service';
import { InterviewStageRepository } from './interview-stage.repository';
import { VacancyRepository } from './vacancy.repository';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Interview Participants"). Participants must be actual
 * organisation `User`s — never a free-text role — validated here against
 * `UserService.getById` (the same tenant-scoped lookup every other
 * participant-selection surface in this codebase uses), never trusted from
 * the request body alone.
 */
@Injectable()
export class InterviewStageService {
  constructor(
    private readonly interviewStageRepository: InterviewStageRepository,
    private readonly vacancyRepository: VacancyRepository,
    private readonly userService: UserService,
  ) {}

  async getById(organisationId: string, id: string) {
    const stage = await this.interviewStageRepository.findById(organisationId, id);
    if (!stage) {
      throw new NotFoundException('Interview stage not found');
    }
    return stage;
  }

  listByVacancy(organisationId: string, vacancyId: string) {
    return this.interviewStageRepository.listByVacancy(organisationId, vacancyId);
  }

  private async assertValidParticipants(
    organisationId: string,
    participantUserIds: string[],
  ): Promise<void> {
    const uniqueIds = new Set(participantUserIds);
    for (const userId of uniqueIds) {
      const user = await this.userService.getById(organisationId, userId);
      if (!user) {
        throw new BadRequestException(`User ${userId} not found in this organisation`);
      }
    }
  }

  async create(
    organisationId: string,
    vacancyId: string,
    input: CreateInterviewStageInput,
  ): Promise<InterviewStage> {
    const vacancy = await this.vacancyRepository.findById(organisationId, vacancyId);
    if (!vacancy) {
      throw new NotFoundException('Vacancy not found');
    }
    await this.assertValidParticipants(organisationId, input.participantUserIds);

    try {
      return await this.interviewStageRepository.create({
        organisationId,
        vacancyId,
        name: input.name,
        description: input.description,
        sequence: input.sequence,
        isRequired: input.isRequired,
        evaluationRequired: input.evaluationRequired,
        participantUserIds: [...new Set(input.participantUserIds)],
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new BadRequestException(
          `This vacancy already has an interview stage at sequence ${input.sequence}`,
        );
      }
      throw error;
    }
  }

  async replaceParticipants(
    organisationId: string,
    interviewStageId: string,
    participantUserIds: string[],
  ): Promise<InterviewStage> {
    await this.getById(organisationId, interviewStageId);
    await this.assertValidParticipants(organisationId, participantUserIds);
    const updated = await this.interviewStageRepository.replaceParticipants(
      organisationId,
      interviewStageId,
      [...new Set(participantUserIds)],
    );
    if (!updated) {
      throw new NotFoundException('Interview stage not found');
    }
    return updated;
  }
}
