import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MaintenanceSchedule } from '@prisma/client';
import {
  CreateMaintenanceScheduleInput,
  UpdateMaintenanceScheduleInput,
} from '@zentuva/validation';

import { AssetMeterRepository } from '../assets/asset-meter.repository';
import { AssetRepository } from '../assets/asset.repository';
import { MaintenancePlanRepository } from './maintenance-plan.repository';
import {
  CreateMaintenanceScheduleResult,
  GenerateScheduleResult,
  ListMaintenanceSchedulesParams,
  MaintenanceScheduleRepository,
} from './maintenance-schedule.repository';

/**
 * Domain service for `MaintenanceSchedule` (Sprint 21, docs/domains/
 * maintenance.md). Validates that the target asset actually belongs to
 * this organisation, that the schedule's plan applies to it (specific
 * `Asset` match, or the asset's own category matches a category-level
 * plan), and — for meter-based schedules — that the asset actually has a
 * meter of the requested type (reusing Sprint 20's own `AssetMeterRepository`,
 * never a second meter system).
 */
@Injectable()
export class MaintenanceScheduleService {
  constructor(
    private readonly maintenanceScheduleRepository: MaintenanceScheduleRepository,
    private readonly maintenancePlanRepository: MaintenancePlanRepository,
    private readonly assetRepository: AssetRepository,
    private readonly assetMeterRepository: AssetMeterRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<MaintenanceSchedule> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListMaintenanceSchedulesParams) {
    return this.maintenanceScheduleRepository.findManyByOrganisation(organisationId, params);
  }

  async create(
    organisationId: string,
    input: CreateMaintenanceScheduleInput,
    actorUserId: string,
  ): Promise<CreateMaintenanceScheduleResult> {
    const plan = await this.maintenancePlanRepository.findById(
      organisationId,
      input.maintenancePlanId,
    );
    if (!plan) {
      throw new BadRequestException('Maintenance plan not found');
    }
    const asset = await this.assetRepository.findById(organisationId, input.assetId);
    if (!asset) {
      throw new BadRequestException('Asset not found');
    }
    if (plan.assetId && plan.assetId !== asset.id) {
      throw new BadRequestException(
        'This plan targets a different specific asset — it cannot be scheduled against this one',
      );
    }
    if (plan.assetCategoryId && plan.assetCategoryId !== asset.categoryId) {
      throw new BadRequestException(
        "This plan targets a different asset category — the asset's own category does not match",
      );
    }

    if (input.scheduleType === 'METER_BASED') {
      const meter = await this.assetMeterRepository.findManyByAsset(organisationId, asset.id);
      const hasMeter = meter.some((m) => m.meterType === input.meterType);
      if (!hasMeter) {
        throw new BadRequestException(
          `This asset has no ${input.meterType} meter — add one on the asset before scheduling meter-based maintenance against it`,
        );
      }
    }

    return this.maintenanceScheduleRepository.create({
      organisationId,
      maintenancePlanId: input.maintenancePlanId,
      assetId: input.assetId,
      scheduleType: input.scheduleType,
      frequencyValue: input.frequencyValue,
      frequencyUnit: input.frequencyUnit,
      nextDueDate: input.nextDueDate,
      meterType: input.meterType,
      meterInterval: input.meterInterval,
      nextDueMeterReading: input.nextDueMeterReading,
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
    });
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateMaintenanceScheduleInput,
  ): Promise<MaintenanceSchedule> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.maintenanceScheduleRepository.update(organisationId, id, {
      frequencyValue: input.frequencyValue,
      frequencyUnit: input.frequencyUnit,
      nextDueDate: input.nextDueDate,
      meterInterval: input.meterInterval,
      nextDueMeterReading: input.nextDueMeterReading,
    });
    if (!updated) {
      throw new NotFoundException('Maintenance schedule not found');
    }
    return updated;
  }

  async setStatus(
    organisationId: string,
    id: string,
    active: boolean,
  ): Promise<MaintenanceSchedule> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = active
      ? await this.maintenanceScheduleRepository.activate(organisationId, id)
      : await this.maintenanceScheduleRepository.deactivate(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Maintenance schedule not found');
    }
    return updated;
  }

  async generate(
    organisationId: string,
    id: string,
    actorUserId: string,
    idempotencyKey?: string,
  ): Promise<GenerateScheduleResult> {
    await this.getByIdOrThrow(organisationId, id);
    return this.maintenanceScheduleRepository.generate(
      organisationId,
      id,
      actorUserId,
      idempotencyKey,
    );
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<MaintenanceSchedule> {
    const schedule = await this.maintenanceScheduleRepository.findById(organisationId, id);
    if (!schedule) {
      throw new NotFoundException('Maintenance schedule not found');
    }
    return schedule;
  }
}
