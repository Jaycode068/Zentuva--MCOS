import { Injectable } from '@nestjs/common';
import { Prisma, WorkSchedule, WorkScheduleStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListWorkSchedulesParams {
  status?: WorkScheduleStatus;
}

export interface CreateWorkScheduleData {
  organisationId: string;
  code: string;
  name: string;
  description?: string;
  workDays: number[];
  expectedStartTime: string;
  expectedEndTime: string;
  gracePeriodMinutes?: number;
}

export interface CreateWorkScheduleResult {
  workSchedule: WorkSchedule;
  wasCreated: boolean;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** Exact `DepartmentRepository` structure — the codebase's master-data-with-
 *  idempotent-code convention. */
@Injectable()
export class WorkScheduleRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<WorkSchedule | null> {
    return this.prisma.workSchedule.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListWorkSchedulesParams = {},
  ): Promise<WorkSchedule[]> {
    return this.prisma.workSchedule.findMany({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
      orderBy: { code: 'asc' },
    });
  }

  async create(data: CreateWorkScheduleData): Promise<CreateWorkScheduleResult> {
    try {
      const workSchedule = await this.prisma.workSchedule.create({
        data: {
          organisationId: data.organisationId,
          code: data.code,
          name: data.name,
          description: data.description,
          workDays: data.workDays,
          expectedStartTime: data.expectedStartTime,
          expectedEndTime: data.expectedEndTime,
          gracePeriodMinutes: data.gracePeriodMinutes ?? 0,
        },
      });
      return { workSchedule, wasCreated: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const existing = await this.prisma.workSchedule.findFirst({
          where: { organisationId: data.organisationId, code: data.code },
        });
        if (existing) {
          return { workSchedule: existing, wasCreated: false };
        }
      }
      throw error;
    }
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.WorkScheduleUncheckedUpdateInput,
  ): Promise<WorkSchedule | null> {
    return this.updateMatching(organisationId, id, data);
  }

  activate(organisationId: string, id: string): Promise<WorkSchedule | null> {
    return this.updateMatching(organisationId, id, { status: WorkScheduleStatus.ACTIVE });
  }

  deactivate(organisationId: string, id: string): Promise<WorkSchedule | null> {
    return this.updateMatching(organisationId, id, { status: WorkScheduleStatus.INACTIVE });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.WorkScheduleUncheckedUpdateInput,
  ): Promise<WorkSchedule | null> {
    const result = await this.prisma.workSchedule.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.workSchedule.findUniqueOrThrow({ where: { id } });
  }
}
