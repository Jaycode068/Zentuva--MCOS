import { Injectable } from '@nestjs/common';
import { AssetCategory, AssetCategoryStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListAssetCategoriesParams {
  status?: AssetCategoryStatus;
}

export interface CreateAssetCategoryData {
  organisationId: string;
  code: string;
  name: string;
  description?: string;
  parentCategoryId?: string;
  createdById: string;
}

export interface CreateAssetCategoryResult {
  assetCategory: AssetCategory;
  wasCreated: boolean;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Thin Prisma access for `AssetCategory` (Sprint 20, docs/domains/
 * assets.md) — a tenant-defined taxonomy, never hard-coded into
 * application logic. No `idempotencyKey` column — `create()` instead
 * catches the `@@unique([organisationId, code])` violation and returns
 * the existing row, the exact `CostCentreRepository.create()` pattern
 * (Sprint 16).
 */
@Injectable()
export class AssetCategoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<AssetCategory | null> {
    return this.prisma.assetCategory.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListAssetCategoriesParams = {},
  ): Promise<AssetCategory[]> {
    return this.prisma.assetCategory.findMany({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
      orderBy: { code: 'asc' },
    });
  }

  async getParentId(id: string): Promise<string | null | undefined> {
    const row = await this.prisma.assetCategory.findUnique({
      where: { id },
      select: { parentCategoryId: true },
    });
    return row?.parentCategoryId;
  }

  async create(data: CreateAssetCategoryData): Promise<CreateAssetCategoryResult> {
    try {
      const assetCategory = await this.prisma.assetCategory.create({
        data: {
          organisationId: data.organisationId,
          code: data.code,
          name: data.name,
          description: data.description,
          parentCategoryId: data.parentCategoryId,
          createdById: data.createdById,
        },
      });
      return { assetCategory, wasCreated: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const existing = await this.prisma.assetCategory.findFirst({
          where: { organisationId: data.organisationId, code: data.code },
        });
        if (existing) {
          return { assetCategory: existing, wasCreated: false };
        }
      }
      throw error;
    }
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.AssetCategoryUncheckedUpdateInput,
  ): Promise<AssetCategory | null> {
    return this.updateMatching(organisationId, id, data);
  }

  deactivate(organisationId: string, id: string): Promise<AssetCategory | null> {
    return this.updateMatching(organisationId, id, { status: AssetCategoryStatus.INACTIVE });
  }

  activate(organisationId: string, id: string): Promise<AssetCategory | null> {
    return this.updateMatching(organisationId, id, { status: AssetCategoryStatus.ACTIVE });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.AssetCategoryUncheckedUpdateInput,
  ): Promise<AssetCategory | null> {
    const result = await this.prisma.assetCategory.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.assetCategory.findUniqueOrThrow({ where: { id } });
  }
}
