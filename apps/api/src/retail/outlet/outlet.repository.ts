import { Injectable } from '@nestjs/common';
import { Outlet, OutletPhoto, OutletStatus, OutletType, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListOutletsParams {
  status?: OutletStatus;
  outletType?: OutletType;
  customerId?: string;
  territoryId?: string;
  /** Simple case-insensitive substring match against name or code — same convention as
   *  `ProductRepository.findManyByOrganisation`. */
  search?: string;
}

export type OutletWithRelations = Outlet & {
  customer: { id: string; customerCode: string; customerName: string };
  territory: { id: string; name: string } | null;
  photos: OutletPhoto[];
};

const RELATIONS_INCLUDE = {
  customer: { select: { id: true, customerCode: true, customerName: true } },
  territory: { select: { id: true, name: true } },
  photos: { orderBy: { createdAt: 'asc' as const } },
};

/**
 * Thin Prisma access for the `Outlet` aggregate (Sprint 4.8, docs/domains/outlets.md). No
 * business logic — see `OutletService`. Photo access lives in the sibling
 * `OutletPhotoRepository`.
 *
 * Tenant-safety convention (matches every other repository in this codebase): every
 * method that reads or writes a specific outlet takes `organisationId` and includes it in
 * the query.
 */
@Injectable()
export class OutletRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.OutletCreateInput): Promise<OutletWithRelations> {
    return this.prisma.outlet.create({ data, include: RELATIONS_INCLUDE });
  }

  /** Plain lookup, no relations — used for internal validation (e.g. confirming an
   *  outlet's `customerId` from `SalesOrderService`) where the extra joins are unneeded. */
  findById(organisationId: string, id: string): Promise<Outlet | null> {
    return this.prisma.outlet.findFirst({ where: { id, organisationId } });
  }

  findByIdWithRelations(organisationId: string, id: string): Promise<OutletWithRelations | null> {
    return this.prisma.outlet.findFirst({
      where: { id, organisationId },
      include: RELATIONS_INCLUDE,
    });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListOutletsParams = {},
  ): Promise<OutletWithRelations[]> {
    return this.prisma.outlet.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.outletType ? { outletType: params.outletType } : {}),
        ...(params.customerId ? { customerId: params.customerId } : {}),
        ...(params.territoryId ? { territoryId: params.territoryId } : {}),
        ...(params.search
          ? {
              OR: [
                { name: { contains: params.search, mode: 'insensitive' } },
                { outletCode: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: RELATIONS_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Globally unique (see `Outlet.outletCode` schema comment) — checked without an
   *  `organisationId` filter, same convention as every other auto-numbered entity. */
  async existsByCode(outletCode: string): Promise<boolean> {
    const count = await this.prisma.outlet.count({ where: { outletCode } });
    return count > 0;
  }

  async update(
    organisationId: string,
    id: string,
    data: Prisma.OutletUpdateInput,
  ): Promise<OutletWithRelations | null> {
    const result = await this.prisma.outlet.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.outlet.findUniqueOrThrow({ where: { id }, include: RELATIONS_INCLUDE });
  }
}
