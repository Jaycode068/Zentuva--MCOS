import { Injectable, NotFoundException } from '@nestjs/common';
import { MaintenanceType } from '@prisma/client';
import { CreateMaintenanceTypeInput, UpdateMaintenanceTypeInput } from '@zentuva/validation';

import {
  CreateMaintenanceTypeResult,
  ListMaintenanceTypesParams,
  MaintenanceTypeRepository,
} from './maintenance-type.repository';

/** Domain service for the `MaintenanceType` aggregate (Sprint 21, docs/domains/maintenance.md). */
@Injectable()
export class MaintenanceTypeService {
  constructor(private readonly maintenanceTypeRepository: MaintenanceTypeRepository) {}

  getById(organisationId: string, id: string): Promise<MaintenanceType> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListMaintenanceTypesParams): Promise<MaintenanceType[]> {
    return this.maintenanceTypeRepository.findManyByOrganisation(organisationId, params);
  }

  async create(
    organisationId: string,
    input: CreateMaintenanceTypeInput,
    actorUserId: string,
  ): Promise<CreateMaintenanceTypeResult> {
    return this.maintenanceTypeRepository.create({
      organisationId,
      code: input.code,
      name: input.name,
      description: input.description,
      createdById: actorUserId,
    });
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateMaintenanceTypeInput,
  ): Promise<MaintenanceType> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.maintenanceTypeRepository.update(organisationId, id, {
      name: input.name,
      description: input.description,
    });
    if (!updated) {
      throw new NotFoundException('Maintenance type not found');
    }
    return updated;
  }

  async deactivate(organisationId: string, id: string): Promise<MaintenanceType> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.maintenanceTypeRepository.deactivate(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Maintenance type not found');
    }
    return updated;
  }

  async activate(organisationId: string, id: string): Promise<MaintenanceType> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.maintenanceTypeRepository.activate(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Maintenance type not found');
    }
    return updated;
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<MaintenanceType> {
    const maintenanceType = await this.maintenanceTypeRepository.findById(organisationId, id);
    if (!maintenanceType) {
      throw new NotFoundException('Maintenance type not found');
    }
    return maintenanceType;
  }
}
