import { Injectable } from '@nestjs/common';
import { Prisma, ProductVariant, ProductVariantStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListProductVariantsParams {
  productFamilyId?: string;
  status?: ProductVariantStatus;
  /** Simple case-insensitive substring match against name or code — same convention as
   *  `ProductRepository.findManyByOrganisation`. */
  search?: string;
}

/**
 * Thin Prisma access for the `ProductVariant` aggregate (Sprint 4.7,
 * docs/domains/catalogue.md). No business logic — see `ProductVariantService`.
 *
 * Tenant-safety convention (matches `ProductRepository`/`ProductFamilyRepository`):
 * every method that reads or writes a specific variant takes `organisationId` and
 * includes it in the query.
 */
@Injectable()
export class ProductVariantRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.ProductVariantCreateInput): Promise<ProductVariant> {
    return this.prisma.productVariant.create({ data });
  }

  findById(organisationId: string, id: string): Promise<ProductVariant | null> {
    return this.prisma.productVariant.findFirst({ where: { id, organisationId } });
  }

  findManyByOrganisation(
    organisationId: string,
    params: ListProductVariantsParams = {},
  ): Promise<ProductVariant[]> {
    return this.prisma.productVariant.findMany({
      where: {
        organisationId,
        ...(params.productFamilyId ? { productFamilyId: params.productFamilyId } : {}),
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

  /** Globally unique (see `ProductVariant.code` schema comment) — checked without an
   *  `organisationId` filter, same convention as `Product.code`/`ProductFamily.code`. */
  async existsByCode(code: string): Promise<boolean> {
    const count = await this.prisma.productVariant.count({ where: { code } });
    return count > 0;
  }

  async update(
    organisationId: string,
    id: string,
    data: Prisma.ProductVariantUpdateInput,
  ): Promise<ProductVariant | null> {
    const result = await this.prisma.productVariant.updateMany({
      where: { id, organisationId },
      data,
    });
    if (result.count === 0) {
      return null;
    }
    return this.prisma.productVariant.findUniqueOrThrow({ where: { id } });
  }
}
