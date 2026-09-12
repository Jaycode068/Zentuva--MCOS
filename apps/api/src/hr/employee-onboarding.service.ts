import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EmployeeOnboardingTask } from '@prisma/client';

import { EmployeeRepository } from './employee.repository';
import {
  EmployeeOnboardingRepository,
  OnboardingWithTasks,
} from './employee-onboarding.repository';

@Injectable()
export class EmployeeOnboardingService {
  constructor(
    private readonly onboardingRepository: EmployeeOnboardingRepository,
    private readonly employeeRepository: EmployeeRepository,
  ) {}

  async getByEmployeeId(organisationId: string, employeeId: string): Promise<OnboardingWithTasks> {
    const onboarding = await this.onboardingRepository.findByEmployeeId(organisationId, employeeId);
    if (!onboarding) {
      throw new NotFoundException('Onboarding not found for this employee');
    }
    return onboarding;
  }

  async start(
    organisationId: string,
    employeeId: string,
    targetCompletionDate?: Date,
  ): Promise<{ onboarding: OnboardingWithTasks; wasCreated: boolean }> {
    const employee = await this.employeeRepository.findById(organisationId, employeeId);
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    if (employee.employmentStatus === 'SEPARATED') {
      throw new BadRequestException('Cannot start onboarding for a separated employee');
    }

    const result = await this.onboardingRepository.startOrGet(
      organisationId,
      employeeId,
      targetCompletionDate,
    );

    if (result.wasCreated && employee.employmentStatus === 'DRAFT') {
      await this.employeeRepository.setEmploymentStatus(organisationId, employeeId, {
        employmentStatus: 'ONBOARDING',
      });
    }

    return result;
  }

  async completeTask(
    organisationId: string,
    employeeId: string,
    taskId: string,
    completedByUserId: string,
  ): Promise<{ task: EmployeeOnboardingTask; wasCompleted: boolean }> {
    const onboarding = await this.getByEmployeeId(organisationId, employeeId);
    const belongsToOnboarding = onboarding.tasks.some((task) => task.id === taskId);
    if (!belongsToOnboarding) {
      throw new NotFoundException('Onboarding task not found');
    }

    const { task, wasCompleted } = await this.onboardingRepository.completeTask(
      organisationId,
      taskId,
      completedByUserId,
    );
    if (!task) {
      throw new NotFoundException('Onboarding task not found');
    }
    return { task, wasCompleted };
  }

  async complete(
    organisationId: string,
    employeeId: string,
    notes: string | undefined,
  ): Promise<{ onboarding: OnboardingWithTasks; wasCompleted: boolean }> {
    const onboarding = await this.getByEmployeeId(organisationId, employeeId);

    if (onboarding.status === 'COMPLETED') {
      return { onboarding, wasCompleted: false };
    }
    if (onboarding.status === 'CANCELLED') {
      throw new BadRequestException('Cannot complete a cancelled onboarding');
    }

    const incompleteRequired = onboarding.tasks.filter(
      (task) => task.isRequired && !task.completedAt,
    );
    if (incompleteRequired.length > 0) {
      throw new BadRequestException(
        `Cannot complete onboarding — required task(s) not yet done: ${incompleteRequired
          .map((task) => task.title)
          .join(', ')}`,
      );
    }

    const updated = await this.onboardingRepository.markCompleted(
      organisationId,
      onboarding.id,
      notes,
    );
    if (!updated) {
      throw new NotFoundException('Onboarding not found');
    }

    const employee = await this.employeeRepository.findById(organisationId, employeeId);
    if (employee?.employmentStatus === 'ONBOARDING') {
      await this.employeeRepository.setEmploymentStatus(organisationId, employeeId, {
        employmentStatus: 'ACTIVE',
      });
    }

    return {
      onboarding: { ...updated, tasks: onboarding.tasks },
      wasCompleted: true,
    };
  }
}
