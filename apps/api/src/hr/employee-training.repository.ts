import { Injectable } from '@nestjs/common';
import { EmployeeTraining, EmployeeTrainingStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListEmployeeTrainingParams {
  page: number;
  pageSize: number;
  employeeId?: string;
  trainingCourseId?: string;
  status?: EmployeeTrainingStatus;
}

export interface ListEmployeeTrainingResult {
  items: EmployeeTraining[];
  total: number;
}

export interface CreateEmployeeTrainingData {
  organisationId: string;
  employeeId: string;
  trainingCourseId: string;
  assignedByUserId: string;
  dueDate?: Date;
}

const ACTIVE_STATUSES: EmployeeTrainingStatus[] = ['ASSIGNED', 'IN_PROGRESS'];

@Injectable()
export class EmployeeTrainingRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<EmployeeTraining | null> {
    return this.prisma.employeeTraining.findFirst({ where: { id, organisationId } });
  }

  findByIdWithRelations(organisationId: string, id: string) {
    return this.prisma.employeeTraining.findFirst({
      where: { id, organisationId },
      include: {
        trainingCourse: true,
        employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
      },
    });
  }

  findActiveAssignment(
    organisationId: string,
    employeeId: string,
    trainingCourseId: string,
  ): Promise<EmployeeTraining | null> {
    return this.prisma.employeeTraining.findFirst({
      where: { organisationId, employeeId, trainingCourseId, status: { in: ACTIVE_STATUSES } },
    });
  }

  findManyByEmployee(organisationId: string, employeeId: string): Promise<EmployeeTraining[]> {
    return this.prisma.employeeTraining.findMany({
      where: { organisationId, employeeId },
      include: { trainingCourse: true },
      orderBy: { assignedAt: 'desc' },
    });
  }

  async findManyPaginated(
    organisationId: string,
    params: ListEmployeeTrainingParams,
  ): Promise<ListEmployeeTrainingResult> {
    const where: Prisma.EmployeeTrainingWhereInput = {
      organisationId,
      ...(params.employeeId ? { employeeId: params.employeeId } : {}),
      ...(params.trainingCourseId ? { trainingCourseId: params.trainingCourseId } : {}),
      ...(params.status ? { status: params.status } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.employeeTraining.findMany({
        where,
        include: {
          trainingCourse: { select: { id: true, code: true, title: true } },
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
        },
        orderBy: { assignedAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.employeeTraining.count({ where }),
    ]);
    return { items, total };
  }

  create(data: CreateEmployeeTrainingData): Promise<EmployeeTraining> {
    return this.prisma.employeeTraining.create({
      data: {
        organisationId: data.organisationId,
        employeeId: data.employeeId,
        trainingCourseId: data.trainingCourseId,
        assignedByUserId: data.assignedByUserId,
        dueDate: data.dueDate,
      },
    });
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.EmployeeTrainingUncheckedUpdateInput,
  ): Promise<EmployeeTraining | null> {
    return this.updateMatching(organisationId, id, data);
  }

  /** Lazily flips past-due ASSIGNED/IN_PROGRESS rows to OVERDUE — the
   *  documented no-cron-job derivation strategy (see schema doc comment on
   *  `EmployeeTraining`). Called before every list/get read. */
  async syncOverdue(organisationId: string): Promise<void> {
    await this.prisma.employeeTraining.updateMany({
      where: { organisationId, status: { in: ACTIVE_STATUSES }, dueDate: { lt: new Date() } },
      data: { status: 'OVERDUE' },
    });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.EmployeeTrainingUncheckedUpdateInput,
  ): Promise<EmployeeTraining | null> {
    const result = await this.prisma.employeeTraining.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.employeeTraining.findUniqueOrThrow({ where: { id } });
  }
}
