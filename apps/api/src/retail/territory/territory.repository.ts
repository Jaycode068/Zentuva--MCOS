import { Injectable } from '@nestjs/common';
import { Prisma, Territory, TerritoryStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListTerritoriesParams {
  status?: TerritoryStatus;
  parentTerritoryId?: string;
  /** Simple case-insensitive substring match against name or code — same convention as
   *  `ProductRepository.findManyByOrganisation`. */
  search?: string;
}

/**
 * Thin Prisma access for the `Territory` aggregate (Sprint 4.8, docs/domains/territories.md).
 * No business logic — see `TerritoryService`.
 *
 * Tenant-safety convention (matches every other repository in this codebase): every
 * method that reads or writes a specific territory takes `organisationId` and includes it
 * in the query.
 */
@Injectable()
export class TerritoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.TerritoryCreateInput): Promise<Territory> {
    return this.prisma.territory.create({ data });
  }

  findById(organisationId: string, id: string): Promise<Territory | null> {
    return this.prisma.territory.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListTerritoriesParams = {},
  ): Promise<Territory[]> {
    return this.prisma.territory.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.parentTerritoryId ? { parentTerritoryId: params.parentTerritoryId } : {}),
        ...(params.search
          ? {
              OR: [
                { name: { contains: params.search, mode: 'insensitive' } },
                { territoryCode: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  /** Globally unique (see `Territory.territoryCode` schema comment) — checked without an
   *  `organisationId` filter, same convention as `Product.code`/`ProductVariant.code`. */
  async existsByCode(territoryCode: string): Promise<boolean> {
    const count = await this.prisma.territory.count({ where: { territoryCode } });
    return count > 0;
  }

  async update(
    organisationId: string,
    id: string,
    data: Prisma.TerritoryUpdateInput,
  ): Promise<Territory | null> {
    const result = await this.prisma.territory.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.territory.findUniqueOrThrow({ where: { id } });
  }
}
