import { Injectable } from '@nestjs/common';
import { Prisma, ProductFamily, ProductFamilyStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListProductFamiliesParams {
  status?: ProductFamilyStatus;
  /** Simple case-insensitive substring match against name or code — same convention as
   *  `ProductRepository.findManyByOrganisation`. */
  search?: string;
}

/**
 * Thin Prisma access for the `ProductFamily` aggregate (Sprint 4.7,
 * docs/domains/catalogue.md). No business logic — see `ProductFamilyService`.
 *
 * Tenant-safety convention (matches `ProductRepository`): every method that reads or
 * writes a specific family takes `organisationId` and includes it in the query.
 */
@Injectable()
export class ProductFamilyRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.ProductFamilyCreateInput): Promise<ProductFamily> {
    return this.prisma.productFamily.create({ data });
  }

  findById(organisationId: string, id: string): Promise<ProductFamily | null> {
    return this.prisma.productFamily.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListProductFamiliesParams = {},
  ): Promise<ProductFamily[]> {
    return this.prisma.productFamily.findMany({
      where: {
        organisationId,
        ...(params.status ? { status: params.status } : {}),
        ...(params.search
          ? {
              OR: [
                { name: { contains: params.search, mode: 'insensitive' } },
                { code: { contains: params.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Globally unique (see `ProductFamily.code` schema comment) — checked without an
   *  `organisationId` filter, same convention as `Product.code`. */
  async existsByCode(code: string): Promise<boolean> {
    const count = await this.prisma.productFamily.count({ where: { code } });
    return count > 0;
  }

  async update(
    organisationId: string,
    id: string,
    data: Prisma.ProductFamilyUpdateInput,
  ): Promise<ProductFamily | null> {
    const result = await this.prisma.productFamily.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.productFamily.findUniqueOrThrow({ where: { id } });
  }
}
