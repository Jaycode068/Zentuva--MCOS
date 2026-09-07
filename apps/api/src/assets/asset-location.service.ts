import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AssetLocation } from '@prisma/client';
import { CreateAssetLocationInput, UpdateAssetLocationInput } from '@zentuva/validation';

import { assertNoHierarchyCycle } from './hierarchy-guard';
import {
  AssetLocationRepository,
  CreateAssetLocationResult,
  ListAssetLocationsParams,
} from './asset-location.repository';

/** Domain service for the `AssetLocation` aggregate (Sprint 20, docs/domains/assets.md). */
@Injectable()
export class AssetLocationService {
  constructor(private readonly assetLocationRepository: AssetLocationRepository) {}

  getById(organisationId: string, id: string): Promise<AssetLocation> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListAssetLocationsParams): Promise<AssetLocation[]> {
    return this.assetLocationRepository.findManyByOrganisation(organisationId, params);
  }

  async create(
    organisationId: string,
    input: CreateAssetLocationInput,
    actorUserId: string,
  ): Promise<CreateAssetLocationResult> {
    if (input.parentLocationId) {
      await this.assertParentBelongsToOrg(organisationId, input.parentLocationId);
    }
    return this.assetLocationRepository.create({
      organisationId,
      name: input.name,
      parentLocationId: input.parentLocationId,
      createdById: actorUserId,
    });
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateAssetLocationInput,
  ): Promise<AssetLocation> {
    await this.getByIdOrThrow(organisationId, id);
    if (input.parentLocationId) {
      await this.assertParentBelongsToOrg(organisationId, input.parentLocationId);
      await assertNoHierarchyCycle('asset location', id, input.parentLocationId, (candidateId) =>
        this.assetLocationRepository.getParentId(candidateId),
      );
    }
    const updated = await this.assetLocationRepository.update(organisationId, id, {
      name: input.name,
      parentLocationId: input.parentLocationId,
    });
    if (!updated) {
      throw new NotFoundException('Asset location not found');
    }
    return updated;
  }

  async deactivate(organisationId: string, id: string): Promise<AssetLocation> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.assetLocationRepository.deactivate(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Asset location not found');
    }
    return updated;
  }

  async activate(organisationId: string, id: string): Promise<AssetLocation> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.assetLocationRepository.activate(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Asset location not found');
    }
    return updated;
  }

  private async assertParentBelongsToOrg(
    organisationId: string,
    parentLocationId: string,
  ): Promise<void> {
    const parent = await this.assetLocationRepository.findById(organisationId, parentLocationId);
    if (!parent) {
      throw new BadRequestException('Parent asset location not found');
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<AssetLocation> {
    const assetLocation = await this.assetLocationRepository.findById(organisationId, id);
    if (!assetLocation) {
      throw new NotFoundException('Asset location not found');
    }
    return assetLocation;
  }
}
