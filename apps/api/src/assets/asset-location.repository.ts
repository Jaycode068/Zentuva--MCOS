import { Injectable } from '@nestjs/common';
import { AssetLocation, AssetLocationStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

export interface ListAssetLocationsParams {
  status?: AssetLocationStatus;
}

export interface CreateAssetLocationData {
  organisationId: string;
  name: string;
  parentLocationId?: string;
  createdById: string;
}

export interface CreateAssetLocationResult {
  assetLocation: AssetLocation;
  wasCreated: boolean;
}

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Thin Prisma access for `AssetLocation` (Sprint 20, docs/domains/
 * assets.md) — a new, purpose-built physical-place model, deliberately not
 * a reuse of `InventoryLocation` (narrowly stock-holding-specific — see
 * docs/domains/assets.md "Why Not InventoryLocation"). No `idempotencyKey`
 * column — `create()` catches the `@@unique([organisationId, name])`
 * violation, the exact `CostCentreRepository.create()` pattern.
 */
@Injectable()
export class AssetLocationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(organisationId: string, id: string): Promise<AssetLocation | null> {
    return this.prisma.assetLocation.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListAssetLocationsParams = {},
  ): Promise<AssetLocation[]> {
    return this.prisma.assetLocation.findMany({
      where: { organisationId, ...(params.status ? { status: params.status } : {}) },
      orderBy: { name: 'asc' },
    });
  }

  async getParentId(id: string): Promise<string | null | undefined> {
    const row = await this.prisma.assetLocation.findUnique({
      where: { id },
      select: { parentLocationId: true },
    });
    return row?.parentLocationId;
  }

  async create(data: CreateAssetLocationData): Promise<CreateAssetLocationResult> {
    try {
      const assetLocation = await this.prisma.assetLocation.create({
        data: {
          organisationId: data.organisationId,
          name: data.name,
          parentLocationId: data.parentLocationId,
          createdById: data.createdById,
        },
      });
      return { assetLocation, wasCreated: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        const existing = await this.prisma.assetLocation.findFirst({
          where: { organisationId: data.organisationId, name: data.name },
        });
        if (existing) {
          return { assetLocation: existing, wasCreated: false };
        }
      }
      throw error;
    }
  }

  update(
    organisationId: string,
    id: string,
    data: Prisma.AssetLocationUncheckedUpdateInput,
  ): Promise<AssetLocation | null> {
    return this.updateMatching(organisationId, id, data);
  }

  deactivate(organisationId: string, id: string): Promise<AssetLocation | null> {
    return this.updateMatching(organisationId, id, { status: AssetLocationStatus.INACTIVE });
  }

  activate(organisationId: string, id: string): Promise<AssetLocation | null> {
    return this.updateMatching(organisationId, id, { status: AssetLocationStatus.ACTIVE });
  }

  private async updateMatching(
    organisationId: string,
    id: string,
    data: Prisma.AssetLocationUncheckedUpdateInput,
  ): Promise<AssetLocation | null> {
    const result = await this.prisma.assetLocation.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.assetLocation.findUniqueOrThrow({ where: { id } });
  }
}
