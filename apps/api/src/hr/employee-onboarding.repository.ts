import { Injectable } from '@nestjs/common';
import { EmployeeOnboarding, EmployeeOnboardingTask, OnboardingStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface OnboardingWithTasks extends EmployeeOnboarding {
  tasks: EmployeeOnboardingTask[];
}

const DEFAULT_ONBOARDING_TASKS: { title: string; isRequired: boolean; sortOrder: number }[] = [
  { title: 'Collect employment documentation', isRequired: true, sortOrder: 1 },
  { title: 'Confirm department and position', isRequired: true, sortOrder: 2 },
  { title: 'Create or link user account', isRequired: true, sortOrder: 3 },
  { title: 'Provide workplace orientation', isRequired: true, sortOrder: 4 },
  { title: 'Acknowledge key policies', isRequired: true, sortOrder: 5 },
  { title: 'Assign reporting manager', isRequired: false, sortOrder: 6 },
  { title: 'Confirm onboarding completion', isRequired: true, sortOrder: 7 },
];

@Injectable()
export class EmployeeOnboardingRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmployeeId(
    organisationId: string,
    employeeId: string,
  ): Promise<OnboardingWithTasks | null> {
    return this.prisma.employeeOnboarding.findFirst({
      where: { organisationId, employeeId },
      include: { tasks: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  countOpenTasks(organisationId: string): Promise<number> {
    return this.prisma.employeeOnboardingTask.count({
      where: {
        organisationId,
        completedAt: null,
        onboarding: { status: OnboardingStatus.IN_PROGRESS },
      },
    });
  }

  countByStatus(organisationId: string, status: OnboardingStatus): Promise<number> {
    return this.prisma.employeeOnboarding.count({ where: { organisationId, status } });
  }

  findById(organisationId: string, id: string): Promise<OnboardingWithTasks | null> {
    return this.prisma.employeeOnboarding.findFirst({
      where: { id, organisationId },
      include: { tasks: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  findTask(
    organisationId: string,
    onboardingId: string,
    taskId: string,
  ): Promise<EmployeeOnboardingTask | null> {
    return this.prisma.employeeOnboardingTask.findFirst({
      where: { id: taskId, onboardingId, organisationId },
    });
  }

  /** Creates the onboarding record plus its default checklist tasks in one
   *  transaction — soft-idempotent: if one already exists for this
   *  employee, returns it unchanged rather than creating a second. */
  async startOrGet(
    organisationId: string,
    employeeId: string,
    targetCompletionDate: Date | undefined,
  ): Promise<{ onboarding: OnboardingWithTasks; wasCreated: boolean }> {
    const existing = await this.findByEmployeeId(organisationId, employeeId);
    if (existing) {
      return { onboarding: existing, wasCreated: false };
    }

    const onboarding = await this.prisma.$transaction(async (tx) => {
      const created = await tx.employeeOnboarding.create({
        data: {
          organisationId,
          employeeId,
          status: OnboardingStatus.IN_PROGRESS,
          startedAt: new Date(),
          targetCompletionDate,
        },
      });
      await tx.employeeOnboardingTask.createMany({
        data: DEFAULT_ONBOARDING_TASKS.map((task) => ({
          organisationId,
          onboardingId: created.id,
          title: task.title,
          isRequired: task.isRequired,
          sortOrder: task.sortOrder,
        })),
      });
      return tx.employeeOnboarding.findUniqueOrThrow({
        where: { id: created.id },
        include: { tasks: { orderBy: { sortOrder: 'asc' } } },
      });
    });

    return { onboarding, wasCreated: true };
  }

  async completeTask(
    organisationId: string,
    taskId: string,
    completedByUserId: string,
  ): Promise<{ task: EmployeeOnboardingTask | null; wasCompleted: boolean }> {
    const result = await this.prisma.employeeOnboardingTask.updateMany({
      where: { id: taskId, organisationId, completedAt: null },
      data: { completedAt: new Date(), completedByUserId },
    });
    if (result.count === 0) {
      const task = await this.prisma.employeeOnboardingTask.findFirst({
        where: { id: taskId, organisationId },
      });
      return { task, wasCompleted: false };
    }
    const task = await this.prisma.employeeOnboardingTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    return { task, wasCompleted: true };
  }

  async markCompleted(
    organisationId: string,
    id: string,
    notes: string | undefined,
  ): Promise<EmployeeOnboarding | null> {
    const result = await this.prisma.employeeOnboarding.updateMany({
      where: { id, organisationId },
      data: { status: OnboardingStatus.COMPLETED, completedAt: new Date(), notes },
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.employeeOnboarding.findUniqueOrThrow({ where: { id } });
  }
}
