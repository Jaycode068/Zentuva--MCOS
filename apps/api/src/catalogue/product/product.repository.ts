import { Injectable } from '@nestjs/common';
import { Prisma, Product, ProductStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListProductsParams {
  status?: ProductStatus;
  /** Simple case-insensitive substring match against name or code (Sprint 4.1 brief:
   *  "Simple search... No pagination"). */
  search?: string;
}

/**
 * Thin Prisma access for the Product aggregate. No business logic — see ProductService and
 * docs/domains/catalogue.md.
 *
 * Tenant-safety convention (matches `UserRepository`, identity.md §7): every method that
 * reads or writes a specific product takes `organisationId` and includes it in the query,
 * even though `id` alone is a globally unique cuid — this defends against a request
 * authenticated for one organisation ever touching another organisation's row.
 */
@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.ProductCreateInput): Promise<Product> {
    return this.prisma.product.create({ data });
  }

  findById(organisationId: string, id: string): Promise<Product | null> {
    return this.prisma.product.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListProductsParams = {},
  ): Promise<Product[]> {
    return this.prisma.product.findMany({
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

  /** Globally unique (see `Product.code` schema comment) — checked without an
   *  `organisationId` filter, unlike every other lookup on this repository. */
  async existsByCode(code: string): Promise<boolean> {
    const count = await this.prisma.product.count({ where: { code } });
    return count > 0;
  }

  /** Unique per organisation only (`@@unique([organisationId, slug])`) — two different
   *  organisations may each have a product slugified to the same value. */
  async existsBySlug(organisationId: string, slug: string): Promise<boolean> {
    const count = await this.prisma.product.count({ where: { organisationId, slug } });
    return count > 0;
  }

  async update(
    organisationId: string,
    id: string,
    data: Prisma.ProductUpdateInput,
  ): Promise<Product | null> {
    const result = await this.prisma.product.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.product.findUniqueOrThrow({ where: { id } });
  }
}
