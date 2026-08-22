import { Injectable } from '@nestjs/common';
import { Prisma, Product, ProductFamily, ProductStatus, ProductVariant } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface ListProductsParams {
  status?: ProductStatus;
  /** Simple case-insensitive substring match against name or code (Sprint 4.1 brief:
   *  "Simple search... No pagination"). */
  search?: string;
}

/** Added Sprint 4.7 — a `Product` joined with its optional `ProductVariant`/parent
 *  `ProductFamily` context. Only returned by {@link ProductRepository.findByIdWithHierarchy}/
 *  {@link ProductRepository.findManyByOrganisationWithHierarchy} — every other method on
 *  this repository (including the plain `findById`/`findManyByOrganisation` other
 *  domains consume directly, e.g. `BillOfMaterialService`) keeps returning a plain
 *  `Product` unchanged. */
export type ProductWithHierarchy = Product & {
  productVariant: (ProductVariant & { productFamily: ProductFamily }) | null;
};

const HIERARCHY_INCLUDE = {
  productVariant: { include: { productFamily: true } },
} as const;

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
      where: buildWhere(organisationId, params),
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Added Sprint 4.7 — same lookup as {@link findById}, plus the product's optional
   *  `ProductVariant`/parent `ProductFamily` context. Used only by `ProductController`'s
   *  own read endpoints — every cross-domain consumer (`BillOfMaterialService`, etc.)
   *  keeps calling the plain {@link findById}. */
  findByIdWithHierarchy(organisationId: string, id: string): Promise<ProductWithHierarchy | null> {
    return this.prisma.product.findFirst({
      where: { id, organisationId },
      include: HIERARCHY_INCLUDE,
    });
  }

  /** Added Sprint 4.7 — same lookup/filters as {@link findManyByOrganisation}, plus the
   *  hierarchy context. See {@link findByIdWithHierarchy}. */
  findManyByOrganisationWithHierarchy(
    organisationId: string,
    params: ListProductsParams = {},
  ): Promise<ProductWithHierarchy[]> {
    return this.prisma.product.findMany({
      where: buildWhere(organisationId, params),
      include: HIERARCHY_INCLUDE,
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

function buildWhere(organisationId: string, params: ListProductsParams): Prisma.ProductWhereInput {
  return {
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
  };
}
