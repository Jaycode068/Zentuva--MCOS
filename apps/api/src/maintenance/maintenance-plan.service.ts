import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MaintenancePlanStatus } from '@prisma/client';
import { CreateMaintenancePlanInput, UpdateMaintenancePlanInput } from '@zentuva/validation';

import { AssetCategoryRepository } from '../assets/asset-category.repository';
import { AssetRepository } from '../assets/asset.repository';
import {
  CreateMaintenancePlanResult,
  ListMaintenancePlansParams,
  MaintenancePlanRepository,
  MaintenancePlanWithTasks,
} from './maintenance-plan.repository';
import { MaintenanceTypeRepository } from './maintenance-type.repository';

/**
 * Domain service for the `MaintenancePlan` aggregate (Sprint 21, docs/
 * domains/maintenance.md). Enforces the "must target exactly one of Asset
 * or Asset Category" rule (Zod-enforced at the controller boundary, and
 * re-validated here so the rule holds regardless of caller) and that every
 * referenced entity actually belongs to this organisation.
 */
@Injectable()
export class MaintenancePlanService {
  constructor(
    private readonly maintenancePlanRepository: MaintenancePlanRepository,
    private readonly maintenanceTypeRepository: MaintenanceTypeRepository,
    private readonly assetRepository: AssetRepository,
    private readonly assetCategoryRepository: AssetCategoryRepository,
  ) {}

  getById(organisationId: string, id: string): Promise<MaintenancePlanWithTasks> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListMaintenancePlansParams) {
    return this.maintenancePlanRepository.findManyByOrganisation(organisationId, params);
  }

  async create(
    organisationId: string,
    input: CreateMaintenancePlanInput,
    actorUserId: string,
  ): Promise<CreateMaintenancePlanResult> {
    if (!input.assetId === !input.assetCategoryId) {
      throw new BadRequestException(
        'A maintenance plan must target exactly one of assetId or assetCategoryId',
      );
    }
    await this.validateReferences(organisationId, input);

    return this.maintenancePlanRepository.create({
      organisationId,
      name: input.name,
      description: input.description,
      maintenanceTypeId: input.maintenanceTypeId,
      assetId: input.assetId,
      assetCategoryId: input.assetCategoryId,
      priority: input.priority,
      estimatedDurationMinutes: input.estimatedDurationMinutes,
      instructions: input.instructions,
      safetyNotes: input.safetyNotes,
      tasks: input.tasks.map((task) => ({
        title: task.title,
        description: task.description,
        mandatory: task.mandatory,
        estimatedDurationMinutes: task.estimatedDurationMinutes,
      })),
      idempotencyKey: input.idempotencyKey,
      createdById: actorUserId,
    });
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateMaintenancePlanInput,
  ): Promise<MaintenancePlanWithTasks> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.maintenancePlanRepository.update(organisationId, id, {
      name: input.name,
      description: input.description,
      priority: input.priority,
      estimatedDurationMinutes: input.estimatedDurationMinutes,
      instructions: input.instructions,
      safetyNotes: input.safetyNotes,
    });
    if (!updated) {
      throw new NotFoundException('Maintenance plan not found');
    }
    return this.getByIdOrThrow(organisationId, id);
  }

  async setStatus(
    organisationId: string,
    id: string,
    status: MaintenancePlanStatus,
  ): Promise<MaintenancePlanWithTasks> {
    await this.getByIdOrThrow(organisationId, id);
    const updated =
      status === 'ACTIVE'
        ? await this.maintenancePlanRepository.activate(organisationId, id)
        : await this.maintenancePlanRepository.deactivate(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Maintenance plan not found');
    }
    return this.getByIdOrThrow(organisationId, id);
  }

  private async validateReferences(
    organisationId: string,
    input: { maintenanceTypeId: string; assetId?: string; assetCategoryId?: string },
  ): Promise<void> {
    const maintenanceType = await this.maintenanceTypeRepository.findById(
      organisationId,
      input.maintenanceTypeId,
    );
    if (!maintenanceType) {
      throw new BadRequestException('Maintenance type not found');
    }
    if (input.assetId) {
      const asset = await this.assetRepository.findById(organisationId, input.assetId);
      if (!asset) {
        throw new BadRequestException('Asset not found');
      }
    }
    if (input.assetCategoryId) {
      const category = await this.assetCategoryRepository.findById(
        organisationId,
        input.assetCategoryId,
      );
      if (!category) {
        throw new BadRequestException('Asset category not found');
      }
    }
  }

  private async getByIdOrThrow(
    organisationId: string,
    id: string,
  ): Promise<MaintenancePlanWithTasks> {
    const maintenancePlan = await this.maintenancePlanRepository.findById(organisationId, id);
    if (!maintenancePlan) {
      throw new NotFoundException('Maintenance plan not found');
    }
    return maintenancePlan;
  }
}
