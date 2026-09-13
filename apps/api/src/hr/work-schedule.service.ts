import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { WorkSchedule } from '@prisma/client';
import { CreateWorkScheduleInput, UpdateWorkScheduleInput } from '@zentuva/validation';

import {
  CreateWorkScheduleResult,
  ListWorkSchedulesParams,
  WorkScheduleRepository,
} from './work-schedule.repository';

@Injectable()
export class WorkScheduleService {
  constructor(private readonly workScheduleRepository: WorkScheduleRepository) {}

  getById(organisationId: string, id: string): Promise<WorkSchedule> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListWorkSchedulesParams): Promise<WorkSchedule[]> {
    return this.workScheduleRepository.findManyByOrganisation(organisationId, params);
  }

  async create(
    organisationId: string,
    input: CreateWorkScheduleInput,
  ): Promise<CreateWorkScheduleResult> {
    this.assertValidTimes(input.expectedStartTime, input.expectedEndTime);
    return this.workScheduleRepository.create({
      organisationId,
      code: input.code,
      name: input.name,
      description: input.description,
      workDays: input.workDays,
      expectedStartTime: input.expectedStartTime,
      expectedEndTime: input.expectedEndTime,
      gracePeriodMinutes: input.gracePeriodMinutes,
    });
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateWorkScheduleInput,
  ): Promise<WorkSchedule> {
    await this.getByIdOrThrow(organisationId, id);
    if (input.expectedStartTime || input.expectedEndTime) {
      const existing = await this.getByIdOrThrow(organisationId, id);
      this.assertValidTimes(
        input.expectedStartTime ?? existing.expectedStartTime,
        input.expectedEndTime ?? existing.expectedEndTime,
      );
    }
    const updated = await this.workScheduleRepository.update(organisationId, id, {
      name: input.name,
      description: input.description,
      workDays: input.workDays,
      expectedStartTime: input.expectedStartTime,
      expectedEndTime: input.expectedEndTime,
      gracePeriodMinutes: input.gracePeriodMinutes,
    });
    if (!updated) {
      throw new NotFoundException('Work schedule not found');
    }
    return updated;
  }

  async activate(organisationId: string, id: string): Promise<WorkSchedule> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.workScheduleRepository.activate(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Work schedule not found');
    }
    return updated;
  }

  async deactivate(organisationId: string, id: string): Promise<WorkSchedule> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.workScheduleRepository.deactivate(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Work schedule not found');
    }
    return updated;
  }

  /** Overnight schedules (end < start) are permitted — only an exact
   *  zero-duration start===end configuration is rejected as invalid. */
  private assertValidTimes(expectedStartTime: string, expectedEndTime: string): void {
    if (expectedStartTime === expectedEndTime) {
      throw new BadRequestException('Expected start and end time cannot be identical');
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<WorkSchedule> {
    const workSchedule = await this.workScheduleRepository.findById(organisationId, id);
    if (!workSchedule) {
      throw new NotFoundException('Work schedule not found');
    }
    return workSchedule;
  }
}
