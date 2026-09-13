import { Injectable } from '@nestjs/common';
import { Prisma, TrainingCourse, TrainingCourseStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface CreateTrainingCourseData {
  organisationId: string;
  code: string;
  title: string;
  description?: string;
  provider?: string;
  deliveryMode: 'IN_PERSON' | 'ONLINE' | 'BLENDED' | 'SELF_STUDY';
  durationMinutes?: number;
  validityPeriodDays?: number;
}

export interface CreateTrainingCourseResult {
  trainingCourse: TrainingCourse;
  wasCreated: boolean;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** Exact `DepartmentRepository`/`WorkScheduleRepository` master-data
 *  convention: idempotent create-by-code, `updateMany`-then-refetch
 *  mutations. */
@Injectable()
export class TrainingCourseRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<TrainingCourse | null> {
    return this.prisma.trainingCourse.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: { status?: TrainingCourseStatus } = {},
  ): Promise<TrainingCourse[]> {
    return this.prisma.trainingCourse.findMany({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
      orderBy: { code: 'asc' },
    });
  }

  async create(data: CreateTrainingCourseData): Promise<CreateTrainingCourseResult> {
    try {
      const trainingCourse = await this.prisma.trainingCourse.create({
        data: {
          organisationId: data.organisationId,
          code: data.code,
          title: data.title,
          description: data.description,
          provider: data.provider,
          deliveryMode: data.deliveryMode,
          durationMinutes: data.durationMinutes,
          validityPeriodDays: data.validityPeriodDays,
        },
      });
      return { trainingCourse, wasCreated: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const existing = await this.prisma.trainingCourse.findFirst({
          where: { organisationId: data.organisationId, code: data.code },
        });
        if (existing) {
          return { trainingCourse: existing, wasCreated: false };
        }
      }
      throw error;
    }
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.TrainingCourseUncheckedUpdateInput,
  ): Promise<TrainingCourse | null> {
    return this.updateMatching(organisationId, id, data);
  }

  setStatus(
    organisationId: string,
    id: string,
    status: TrainingCourseStatus,
  ): Promise<TrainingCourse | null> {
    return this.updateMatching(organisationId, id, { status });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.TrainingCourseUncheckedUpdateInput,
  ): Promise<TrainingCourse | null> {
    const result = await this.prisma.trainingCourse.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.trainingCourse.findUniqueOrThrow({ where: { id } });
  }
}
