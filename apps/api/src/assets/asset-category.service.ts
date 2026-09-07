import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AssetCategory } from '@prisma/client';
import { CreateAssetCategoryInput, UpdateAssetCategoryInput } from '@zentuva/validation';

import { assertNoHierarchyCycle } from './hierarchy-guard';
import {
  AssetCategoryRepository,
  CreateAssetCategoryResult,
  ListAssetCategoriesParams,
} from './asset-category.repository';

/** Domain service for the `AssetCategory` aggregate (Sprint 20, docs/domains/assets.md). */
@Injectable()
export class AssetCategoryService {
  constructor(private readonly assetCategoryRepository: AssetCategoryRepository) {}

  getById(organisationId: string, id: string): Promise<AssetCategory> {
    return this.getByIdOrThrow(organisationId, id);
  }

  list(organisationId: string, params?: ListAssetCategoriesParams): Promise<AssetCategory[]> {
    return this.assetCategoryRepository.findManyByOrganisation(organisationId, params);
  }

  async create(
    organisationId: string,
    input: CreateAssetCategoryInput,
    actorUserId: string,
  ): Promise<CreateAssetCategoryResult> {
    if (input.parentCategoryId) {
      await this.assertParentBelongsToOrg(organisationId, input.parentCategoryId);
    }
    return this.assetCategoryRepository.create({
      organisationId,
      code: input.code,
      name: input.name,
      description: input.description,
      parentCategoryId: input.parentCategoryId,
      createdById: actorUserId,
    });
  }

  async update(
    organisationId: string,
    id: string,
    input: UpdateAssetCategoryInput,
  ): Promise<AssetCategory> {
    await this.getByIdOrThrow(organisationId, id);
    if (input.parentCategoryId) {
      await this.assertParentBelongsToOrg(organisationId, input.parentCategoryId);
      await assertNoHierarchyCycle('asset category', id, input.parentCategoryId, (candidateId) =>
        this.assetCategoryRepository.getParentId(candidateId),
      );
    }
    const updated = await this.assetCategoryRepository.update(organisationId, id, {
      name: input.name,
      description: input.description,
      parentCategoryId: input.parentCategoryId,
    });
    if (!updated) {
      throw new NotFoundException('Asset category not found');
    }
    return updated;
  }

  async deactivate(organisationId: string, id: string): Promise<AssetCategory> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.assetCategoryRepository.deactivate(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Asset category not found');
    }
    return updated;
  }

  async activate(organisationId: string, id: string): Promise<AssetCategory> {
    await this.getByIdOrThrow(organisationId, id);
    const updated = await this.assetCategoryRepository.activate(organisationId, id);
    if (!updated) {
      throw new NotFoundException('Asset category not found');
    }
    return updated;
  }

  private async assertParentBelongsToOrg(
    organisationId: string,
    parentCategoryId: string,
  ): Promise<void> {
    const parent = await this.assetCategoryRepository.findById(organisationId, parentCategoryId);
    if (!parent) {
      throw new BadRequestException('Parent asset category not found');
    }
  }

  private async getByIdOrThrow(organisationId: string, id: string): Promise<AssetCategory> {
    const assetCategory = await this.assetCategoryRepository.findById(organisationId, id);
    if (!assetCategory) {
      throw new NotFoundException('Asset category not found');
    }
    return assetCategory;
  }
}
