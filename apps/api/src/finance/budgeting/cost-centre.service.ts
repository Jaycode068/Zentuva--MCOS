import { Injectable, NotFoundException } from '@nestjs/common';
import { CostCentre } from '@prisma/client';
import { CreateCostCentreInput, UpdateCostCentreInput } from '@zentuva/validation';

import {
  CostCentreRepository,
  CreateCostCentreResult,
  ListCostCentresParams,
} from './cost-centre.repository';

/** Domain service for the `CostCentre` aggregate (Sprint 16, docs/domains/
 *  budgeting.md §10). */
@Injectable()
export class CostCentreService {
  constructor(private readonly costCentreRepository: CostCentreRepository) {}

  getById(organisationId: string, id: string): Promise<CostCentre> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListCostCentresParams): Promise<CostCentre[]> {
    return this.costCentreRepository.findManyByOrganisation(organisationId, params);
  }

  create(
    organisationId: string,
    input: CreateCostCentreInput,
    actorUserId: string,
  ): Promise<CreateCostCentreResult> {
    return this.costCentreRepository.create({
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
    input: UpdateCostCentreInput,
  ): Promise<CostCentre> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.costCentreRepository.update(organisationId, id, {
      name: input.name,
      description: input.description,
    });
    if (!updated) {
      throw new NotFoundException('Cost centre not found');
    }
    return updated;
  }

  async deactivate(organisationId: string, id: string): Promise<CostCentre> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.costCentreRepository.deactivate(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Cost centre not found');
    }
    return updated;
  }

  async activate(organisationId: string, id: string): Promise<CostCentre> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.costCentreRepository.activate(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Cost centre not found');
    }
    return updated;
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<CostCentre> {
    const costCentre = await this.costCentreRepository.findById(organisationId, id);
    if (!costCentre) {
      throw new NotFoundException('Cost centre not found');
    }
    return costCentre;
  }
}
